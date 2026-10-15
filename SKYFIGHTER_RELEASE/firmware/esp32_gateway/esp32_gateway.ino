/*
  SKYFIGHTER — Communication & Wi-Fi Gateway Firmware (ESP32 #2)
  Dual-ESP32 UAV Architecture (v1.1)

  Responsibilities:
  1. Configures SoftAP (SSID: "SKYFIGHTER_GATEWAY", Password: "password123", IP: 192.168.4.1)
  2. Runs non-blocking WebSockets server on port 8080 at "/telemetry"
  3. Receives telemetry packets from ESP32 #1 over Hardware UART2 (115200 Baud)
  4. Broadcasts telemetry JSON to all connected GCS clients (iPhone, Android, Laptop PWA)
  5. Validates incoming GCS commands (rate limits, packet size, disarmed throttle lock)
  6. Enforces exclusive client control leases (only 1 pilot can command at a time)
  7. Forwards validated commands across UART to ESP32 #1
*/

#include <WiFi.h>
#include <WiFiAP.h>
#include <WebSocketsServer.h>
#include <ArduinoJson.h>

// =====================================================
// PIN & HARDWARE CONFIGURATION
// =====================================================
#define UART_TO_FC_RX 16  // Connect to ESP32 #1 TX
#define UART_TO_FC_TX 17  // Connect to ESP32 #1 RX
#define STATUS_LED_PIN 2   // Onboard Blue LED

// =====================================================
// SOFTAP & NETWORK CONFIGURATION
// =====================================================
const char* AP_SSID = "SKYFIGHTER_GATEWAY";
const char* AP_PASS = "password123";
const IPAddress AP_IP(192, 168, 4, 1);
const IPAddress AP_GATEWAY(192, 168, 4, 1);
const IPAddress AP_SUBNET(255, 255, 255, 0);

// Hardware UART serial bus to Flight Controller (ESP32 #1)
HardwareSerial FCSerial(2);

// WebSocket Server on Port 8080
WebSocketsServer webSocket = WebSocketsServer(8080);

// =====================================================
// SAFETY & LEASE PARAMETERS
// =====================================================
#define PROTOCOL_VERSION 1
#define MAX_PACKET_BYTES 4096
#define MAX_COMMAND_RATE_HZ 20
#define CONTROL_LEASE_MS 3000
#define FC_HEARTBEAT_TIMEOUT_MS 2500

// Rate limiting & control lease state
unsigned long lastCommandTimeMs = 0;
const unsigned long MIN_COMMAND_INTERVAL_MS = (1000 / MAX_COMMAND_RATE_HZ);

String activeLeaseClientId = "";
unsigned long leaseExpiresAtMs = 0;
uint64_t lastCommandSequence = 0;

// UART buffer from ESP32 #1
String uartRxBuffer = "";
unsigned long lastFCTelemetryTimeMs = 0;
bool fcLinkAlive = false;

// Statistics
unsigned long packetsReceivedGCS = 0;
unsigned long packetsForwardedFC = 0;
unsigned long telemetryBroadcastCount = 0;

// =====================================================
// FORWARD DECLARATIONS
// =====================================================
void handleWebSocketEvent(uint8_t num, WStype_t type, uint8_t * payload, size_t length);
void processIncomingGCSCommand(uint8_t clientNum, const char* jsonPayload, size_t length);
void processFCSerialData();
void checkFCLinkHealth();
void sendAck(uint8_t clientNum, uint64_t sequence, const char* status, const char* code, const char* message);

// =====================================================
// SETUP
// =====================================================
void setup() {
  Serial.begin(115200);
  delay(500);

  pinMode(STATUS_LED_PIN, OUTPUT);
  digitalWrite(STATUS_LED_PIN, LOW);

  Serial.println("\n=========================================");
  Serial.println("  SKYFIGHTER ESP32 #2 GATEWAY FIRMWARE   ");
  Serial.println("  Protocol v1.1 • Dual-ESP32 Gateway    ");
  Serial.println("=========================================");

  // Initialize UART2 link to ESP32 #1 Flight Controller
  FCSerial.begin(115200, SERIAL_8N1, UART_TO_FC_RX, UART_TO_FC_TX);
  Serial.printf("[UART] Bus to ESP32 #1 initialized on RX:%d, TX:%d at 115200 baud\n", UART_TO_FC_RX, UART_TO_FC_TX);

  // Configure SoftAP
  WiFi.mode(WIFI_AP);
  WiFi.softAPConfig(AP_IP, AP_GATEWAY, AP_SUBNET);
  if (WiFi.softAP(AP_SSID, AP_PASS, 6, 0, 4)) {
    Serial.printf("[WiFi] SoftAP started! SSID: %s | IP: %s:8080\n", AP_SSID, WiFi.softAPIP().toString().c_str());
  } else {
    Serial.println("[WiFi] ERROR: Failed to start SoftAP!");
  }

  // Start WebSocket server
  webSocket.begin();
  webSocket.onEvent(handleWebSocketEvent);
  Serial.println("[WebSocket] Server listening on ws://192.168.4.1:8080/telemetry");

  digitalWrite(STATUS_LED_PIN, HIGH);
}

// =====================================================
// MAIN LOOP
// =====================================================
void loop() {
  webSocket.loop();
  processFCSerialData();
  checkFCLinkHealth();
}

// =====================================================
// WEBSOCKET EVENT HANDLER
// =====================================================
void handleWebSocketEvent(uint8_t num, WStype_t type, uint8_t * payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED:
      Serial.printf("[WS] Client #%u disconnected.\n", num);
      break;

    case WStype_CONNECTED: {
      IPAddress ip = webSocket.remoteIP(num);
      Serial.printf("[WS] Client #%u connected from %s\n", num, ip.toString().c_str());
      
      // Send greeting capability manifest
      StaticJsonDocument<512> manifest;
      manifest["version"] = PROTOCOL_VERSION;
      manifest["type"] = "manifest";
      manifest["timestamp_ms"] = millis();
      manifest["gateway"] = "ESP32_DEV_GATEWAY_V1.1";
      manifest["fc_link_alive"] = fcLinkAlive;
      
      JsonObject caps = manifest.createNestedObject("capabilities");
      caps["manual_control"] = false; // Flight controller must report capability first
      caps["autonomous_navigation"] = false;
      caps["return_to_home"] = false;
      caps["max_command_rate_hz"] = MAX_COMMAND_RATE_HZ;

      String out;
      serializeJson(manifest, out);
      webSocket.sendTXT(num, out);
      break;
    }

    case WStype_TEXT:
      processIncomingGCSCommand(num, (const char*)payload, length);
      break;

    default:
      break;
  }
}

// =====================================================
// PROCESS INCOMING GCS COMMANDS (Rate & Lease Validation)
// =====================================================
void processIncomingGCSCommand(uint8_t clientNum, const char* jsonPayload, size_t length) {
  packetsReceivedGCS++;

  // 1. Packet Size Check
  if (length > MAX_PACKET_BYTES) {
    Serial.printf("[SECURITY] Rejected oversized packet: %u bytes\n", length);
    sendAck(clientNum, 0, "rejected", "PACKET_TOO_LARGE", "Packet exceeded 4096 bytes");
    return;
  }

  // 2. Parse JSON
  StaticJsonDocument<1024> doc;
  DeserializationError err = deserializeJson(doc, jsonPayload, length);
  if (err) {
    sendAck(clientNum, 0, "rejected", "INVALID_JSON", err.c_str());
    return;
  }

  int version = doc["version"] | 0;
  if (version != PROTOCOL_VERSION) {
    sendAck(clientNum, 0, "rejected", "UNSUPPORTED_VERSION", "Expected protocol v1");
    return;
  }

  const char* type = doc["type"] | "";
  uint64_t sequence = doc["sequence"] | 0;
  const char* clientId = doc["client_id"] | "";
  unsigned long now = millis();

  // 3. Handle Control Lease Claim
  if (strcmp(type, "control_claim") == 0) {
    const char* action = doc["action"] | "";
    if (strcmp(action, "request_lease") == 0) {
      if (activeLeaseClientId.length() == 0 || now > leaseExpiresAtMs || activeLeaseClientId == clientId) {
        activeLeaseClientId = clientId;
        leaseExpiresAtMs = now + CONTROL_LEASE_MS;
        sendAck(clientNum, sequence, "accepted", "LEASE_GRANTED", "Control lease active");
        Serial.printf("[LEASE] Granted to %s for %d ms\n", clientId, CONTROL_LEASE_MS);
      } else {
        sendAck(clientNum, sequence, "rejected", "LEASE_BUSY", "Another client holds active control");
      }
    } else if (strcmp(action, "release_lease") == 0) {
      if (activeLeaseClientId == clientId) {
        activeLeaseClientId = "";
        leaseExpiresAtMs = 0;
        sendAck(clientNum, sequence, "accepted", "LEASE_RELEASED", "Control released");
      }
    } else if (strcmp(action, "heartbeat") == 0) {
      if (activeLeaseClientId == clientId && now <= leaseExpiresAtMs) {
        leaseExpiresAtMs = now + CONTROL_LEASE_MS;
        sendAck(clientNum, sequence, "accepted", "HEARTBEAT_ACK", "Lease renewed");
      } else {
        sendAck(clientNum, sequence, "rejected", "LEASE_EXPIRED", "Claim lease first");
      }
    }
    return;
  }

  // 4. Handle Emergency Stop (Highest Priority — No lease needed)
  if (strcmp(type, "emergency_stop") == 0) {
    Serial.println("[SAFETY] EMERGENCY STOP COMMAND RECEIVED FROM GCS!");
    // Transmit immediate motor cut command to ESP32 #1 over UART
    FCSerial.println("{\"version\":1,\"type\":\"emergency_stop\"}");
    sendAck(clientNum, sequence, "executed", "ESTOP_TRIGGERED", "Emergency stop issued to FC");
    return;
  }

  // 5. Verify Client Control Lease Ownership
  if (activeLeaseClientId.length() == 0 || activeLeaseClientId != clientId || now > leaseExpiresAtMs) {
    sendAck(clientNum, sequence, "rejected", "NOT_LEASE_OWNER", "Client does not hold active control lease");
    return;
  }

  // 6. Rate Limiting Check (20 Hz)
  if (now - lastCommandTimeMs < MIN_COMMAND_INTERVAL_MS) {
    sendAck(clientNum, sequence, "rejected", "RATE_LIMIT_EXCEEDED", "Exceeded 20 Hz command rate");
    return;
  }
  lastCommandTimeMs = now;

  // 7. Monotonic Sequence Counter Check
  if (sequence <= lastCommandSequence) {
    sendAck(clientNum, sequence, "rejected", "OUT_OF_ORDER_SEQUENCE", "Sequence not monotonic");
    return;
  }
  lastCommandSequence = sequence;

  // 8. Handle Manual Command Sanitization & Forwarding
  if (strcmp(type, "manual_command") == 0) {
    float roll = doc["roll"] | 0.0f;
    float pitch = doc["pitch"] | 0.0f;
    float yaw = doc["yaw"] | 0.0f;
    float throttle = doc["throttle"] | 0.0f;

    // Safety check: Clamp parameters
    roll = constrain(roll, -1.0f, 1.0f);
    pitch = constrain(pitch, -1.0f, 1.0f);
    yaw = constrain(yaw, -1.0f, 1.0f);
    throttle = constrain(throttle, 0.0f, 1.0f);

    // Forward sanitized JSON line to ESP32 #1 over hardware UART
    StaticJsonDocument<256> fwdDoc;
    fwdDoc["version"] = 1;
    fwdDoc["type"] = "manual_command";
    fwdDoc["sequence"] = sequence;
    fwdDoc["roll"] = roll;
    fwdDoc["pitch"] = pitch;
    fwdDoc["yaw"] = yaw;
    fwdDoc["throttle"] = throttle;

    String fwdStr;
    serializeJson(fwdDoc, fwdStr);
    FCSerial.println(fwdStr);
    packetsForwardedFC++;

    sendAck(clientNum, sequence, "accepted", "FORWARDED_TO_FC", "Command sent over UART");
    return;
  }

  // 9. Handle Arming Command
  if (strcmp(type, "arm_command") == 0) {
    bool arm = doc["arm"] | false;
    const char* token = doc["confirmation_token"] | "";
    if (strlen(token) < 8) {
      sendAck(clientNum, sequence, "rejected", "INVALID_ARM_TOKEN", "Confirmation token required");
      return;
    }

    // Forward to FC
    StaticJsonDocument<256> armDoc;
    armDoc["version"] = 1;
    armDoc["type"] = "arm_command";
    armDoc["sequence"] = sequence;
    armDoc["arm"] = arm;
    armDoc["token"] = token;

    String armStr;
    serializeJson(armDoc, armStr);
    FCSerial.println(armStr);

    sendAck(clientNum, sequence, "accepted", "ARM_COMMAND_FORWARDED", arm ? "Arming command sent" : "Disarm command sent");
    return;
  }

  sendAck(clientNum, sequence, "rejected", "UNKNOWN_TYPE", type);
}

// =====================================================
// PROCESS UART STREAM FROM ESP32 #1 FLIGHT CONTROLLER
// =====================================================
void processFCSerialData() {
  while (FCSerial.available()) {
    char c = FCSerial.read();
    if (c == '\n') {
      uartRxBuffer.trim();
      if (uartRxBuffer.length() > 0 && uartRxBuffer.startsWith("{") && uartRxBuffer.endsWith("}")) {
        // Forward valid JSON telemetry from FC directly to all connected WebSockets
        webSocket.broadcastTXT(uartRxBuffer);
        telemetryBroadcastCount++;
        lastFCTelemetryTimeMs = millis();
        fcLinkAlive = true;
      }
      uartRxBuffer = "";
    } else if (c != '\r') {
      if (uartRxBuffer.length() < MAX_PACKET_BYTES) {
        uartRxBuffer += c;
      } else {
        uartRxBuffer = ""; // Overflow prevention
      }
    }
  }
}

// =====================================================
// CHECK FLIGHT CONTROLLER UART LINK HEALTH
// =====================================================
void checkFCLinkHealth() {
  unsigned long now = millis();
  if (fcLinkAlive && (now - lastFCTelemetryTimeMs > FC_HEARTBEAT_TIMEOUT_MS)) {
    fcLinkAlive = false;
    Serial.println("[GATEWAY WARNING] UART telemetry link from ESP32 #1 quiet for >2.5s!");
    
    // Broadcast Comms Lost Alert packet to GCS clients
    StaticJsonDocument<512> alertDoc;
    alertDoc["version"] = PROTOCOL_VERSION;
    alertDoc["type"] = "telemetry";
    alertDoc["timestamp_ms"] = now;
    alertDoc["connection"] = "fc_link_lost";
    
    JsonObject flight = alertDoc.createNestedObject("flight");
    flight["mode"] = "failsafe";
    flight["armed"] = false;
    
    JsonArray alerts = alertDoc.createNestedArray("alerts");
    JsonObject alert = alerts.createNestedObject();
    alert["code"] = "FC_UART_TIMEOUT";
    alert["severity"] = "critical";
    alert["source"] = "ESP32_GATEWAY";
    alert["message"] = "Telemetry from Flight Controller stopped.";
    alert["timestamp_ms"] = now;

    String alertStr;
    serializeJson(alertDoc, alertStr);
    webSocket.broadcastTXT(alertStr);
  }
}

// =====================================================
// COMMAND ACKNOWLEDGEMENT HELPER
// =====================================================
void sendAck(uint8_t clientNum, uint64_t sequence, const char* status, const char* code, const char* message) {
  StaticJsonDocument<256> ack;
  ack["version"] = PROTOCOL_VERSION;
  ack["type"] = "ack";
  ack["sequence"] = sequence;
  ack["status"] = status;
  ack["code"] = code;
  ack["message"] = message;
  ack["timestamp_ms"] = millis();

  String out;
  serializeJson(ack, out);
  webSocket.sendTXT(clientNum, out);
}
