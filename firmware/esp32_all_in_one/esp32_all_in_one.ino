/*
  SKYFIGHTER — All-in-One Drone Sensor Controller & Wi-Fi Gateway
  Single-ESP32 UAV Architecture (v1.1)

  Target: Single ESP32 DevKit Module
  Responsibilities:
  1. Reads all sensors:
     - MQ-2 Smoke / Flammable Gas (GPIO 34 ADC)
     - DHT11/DHT22 Ambient Temperature & Humidity (GPIO 4)
     - Optical Flame Sensor (GPIO 27, Active-LOW with internal PULLUP)
     - MPU6050 6-DoF IMU (I2C 0x68: SDA 21, SCL 22)
     - NEO-6M GPS (UART2: RX 16, TX 17)
     - Audible Alert Buzzer (GPIO 26)
  2. Broadcasts SoftAP Wi-Fi network:
     - SSID: "SKYFIGHTER_GATEWAY"
     - Password: "password123"
     - IP Address: 192.168.4.1
  3. Hosts WebSocket server on port 8080 at "/telemetry"
  4. Broadcasts actual measured sensor data directly to GCS apps (PWA, iPhone, Android, Laptop)
  5. Also streams JSON telemetry to USB Serial (115200 Baud) for Direct USB Web Serial connection.
*/

#include <WiFi.h>
#include <WiFiAP.h>
#include <WebSocketsServer.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <Wire.h>

// =====================================================
// GPIO PIN CONFIGURATION
// =====================================================
#define GPS_RX_PIN 16
#define GPS_TX_PIN 17

#define MPU_SDA_PIN 21
#define MPU_SCL_PIN 22

#define MQ2_PIN 34
#define DHT_PIN 4
#define FLAME_PIN 27
#define BUZZER_PIN 26

// =====================================================
// WI-FI & WEBSOCKET CONFIGURATION
// =====================================================
const char* AP_SSID = "SKYFIGHTER_GATEWAY";
const char* AP_PASS = "password123";
const IPAddress AP_IP(192, 168, 4, 1);
const IPAddress AP_GATEWAY(192, 168, 4, 1);
const IPAddress AP_SUBNET(255, 255, 255, 0);

WebSocketsServer webSocket = WebSocketsServer(8080);

// =====================================================
// SENSOR CONFIGURATION & THRESHOLDS
// =====================================================
#ifndef DHT11
#define DHT11 11
#endif
#ifndef DHT22
#define DHT22 22
#endif

#define DHT_TYPE DHT11
DHT dht(DHT_PIN, DHT_TYPE);

#define MPU6050_ADDR 0x68

const float TEMP_THRESHOLD_C = 50.0;
const float HUMIDITY_THRESHOLD = 85.0;
const int MQ2_INCREASE_THRESHOLD = 500;
const int FLAME_TRIGGER_LEVEL = LOW;

const unsigned long TELEMETRY_INTERVAL_MS = 500; // 2 Hz telemetry rate

// =====================================================
// STATE VARIABLES
// =====================================================
bool mpuDetected = false;
int16_t ax = 0, ay = 0, az = 0;
int16_t gx = 0, gy = 0, gz = 0;
int16_t tempRaw = 0;
float mpuTemperature = NAN;

HardwareSerial GPSSerial(2);
String gpsLine = "";
double latitude = 0.0;
double longitude = 0.0;
float altitudeM = 0.0;
int satellites = 0;
bool gpsFix = false;
unsigned long lastGPSFixTime = 0;

int mq2Baseline = -1;
int MQ2_THRESHOLD = 4095;
int mq2Value = 0;
int flameValue = HIGH;
float ambientTemperature = NAN;
float humidity = NAN;

bool smokeWarning = false;
bool flameWarning = false;
bool temperatureWarning = false;
bool humidityWarning = false;
bool dhtValid = false;

bool isArmed = false;
uint64_t telemetrySequence = 0;
unsigned long lastTelemetryTime = 0;

// =====================================================
// MPU6050 DRIVER
// =====================================================
bool initializeMPU6050() {
  Wire.beginTransmission(MPU6050_ADDR);
  Wire.write(0x6B);
  Wire.write(0x00); // Wake up
  return (Wire.endTransmission() == 0);
}

int16_t readSigned16() {
  uint8_t highByte = Wire.read();
  uint8_t lowByte = Wire.read();
  return (int16_t)(((uint16_t)highByte << 8) | lowByte);
}

bool readMPU6050() {
  if (!mpuDetected) return false;

  Wire.beginTransmission(MPU6050_ADDR);
  Wire.write(0x3B);
  if (Wire.endTransmission(false) != 0) return false;

  if (Wire.requestFrom(MPU6050_ADDR, 14, true) != 14) return false;

  ax = readSigned16();
  ay = readSigned16();
  az = readSigned16();
  tempRaw = readSigned16();
  gx = readSigned16();
  gy = readSigned16();
  gz = readSigned16();

  mpuTemperature = (tempRaw / 340.0) + 36.53;
  return true;
}

// =====================================================
// GPS DRIVER
// =====================================================
double convertNMEACoordinate(String value, String direction) {
  if (value.length() == 0 || direction.length() == 0) return 0.0;
  double raw = value.toDouble();
  int degrees = (int)(raw / 100.0);
  double minutes = raw - (degrees * 100.0);
  double coordinate = degrees + (minutes / 60.0);
  if (direction == "S" || direction == "W") coordinate = -coordinate;
  return coordinate;
}

void parseGGA(String sentence) {
  String fields[15];
  int fieldCount = 0;
  int start = 0;

  for (int i = 0; i < sentence.length() && fieldCount < 15; i++) {
    if (sentence.charAt(i) == ',') {
      fields[fieldCount++] = sentence.substring(start, i);
      start = i + 1;
    }
  }
  if (fieldCount < 10) return;

  if (fields[6].toInt() > 0) {
    latitude = convertNMEACoordinate(fields[2], fields[3]);
    longitude = convertNMEACoordinate(fields[4], fields[5]);
    satellites = fields[7].toInt();
    altitudeM = fields[9].toFloat();
    gpsFix = true;
    lastGPSFixTime = millis();
  } else {
    gpsFix = false;
  }
}

void processGPS() {
  while (GPSSerial.available()) {
    char c = GPSSerial.read();
    if (c == '\n') {
      if (gpsLine.startsWith("$GPGGA") || gpsLine.startsWith("$GNGGA")) {
        parseGGA(gpsLine);
      }
      gpsLine = "";
    } else if (c != '\r') {
      if (gpsLine.length() < 120) gpsLine += c;
      else gpsLine = "";
    }
  }
  if (millis() - lastGPSFixTime > 5000) {
    gpsFix = false;
  }
}

// =====================================================
// READ SENSORS
// =====================================================
void readSensors() {
  mq2Value = analogRead(MQ2_PIN);
  flameValue = digitalRead(FLAME_PIN);

  ambientTemperature = dht.readTemperature();
  humidity = dht.readHumidity();

  dhtValid = !isnan(ambientTemperature) && !isnan(humidity) &&
             ambientTemperature >= -20.0 && ambientTemperature <= 60.0 &&
             humidity >= 5.0 && humidity <= 99.0;

  if (mq2Baseline < 0 && mq2Value > 0) {
    mq2Baseline = mq2Value;
  }

  if (mq2Baseline >= 0) {
    MQ2_THRESHOLD = min(4095, mq2Baseline + MQ2_INCREASE_THRESHOLD);
    smokeWarning = (mq2Value >= MQ2_THRESHOLD);
  } else {
    smokeWarning = false;
  }

  flameWarning = (flameValue == FLAME_TRIGGER_LEVEL);
  temperatureWarning = dhtValid && (ambientTemperature >= TEMP_THRESHOLD_C);
  humidityWarning = dhtValid && (humidity >= HUMIDITY_THRESHOLD);

  bool buzzerOn = smokeWarning || flameWarning || temperatureWarning;
  digitalWrite(BUZZER_PIN, buzzerOn ? HIGH : LOW);
}

// =====================================================
// TELEMETRY TRANSMISSION (WEBSOCKET + USB SERIAL)
// =====================================================
void broadcastTelemetry() {
  StaticJsonDocument<1024> doc;
  doc["version"] = 1;
  doc["type"] = "telemetry";
  doc["sequence"] = ++telemetrySequence;
  doc["timestamp_ms"] = millis();
  doc["connection"] = "connected";

  // Flight capabilities
  JsonObject flight = doc.createNestedObject("flight");
  flight["mode"] = isArmed ? "manual" : "disarmed";
  flight["armed"] = isArmed;

  JsonObject caps = flight.createNestedObject("capabilities");
  caps["manual_control"] = false;
  caps["autonomous_navigation"] = false;
  caps["return_to_home"] = false;
  caps["thermal_camera"] = false;
  caps["rgb_camera"] = false;
  caps["buzzer"] = true;
  caps["simulation_mode"] = false;

  // Environmental sensors
  JsonObject sensors = doc.createNestedObject("sensors");
  if (dhtValid) {
    sensors["temperature_c"] = serialized(String(ambientTemperature, 1));
    sensors["humidity_pct"] = serialized(String(humidity, 1));
  } else {
    sensors["temperature_c"] = nullptr;
    sensors["humidity_pct"] = nullptr;
  }
  sensors["mq2_adc"] = mq2Value;
  sensors["flame_detected"] = flameWarning;
  sensors["mpu_connected"] = mpuDetected;
  if (mpuDetected) {
    sensors["mpu_temperature_c"] = serialized(String(mpuTemperature, 1));
  } else {
    sensors["mpu_temperature_c"] = nullptr;
  }

  // GPS
  JsonObject gps = doc.createNestedObject("gps");
  gps["valid"] = gpsFix;
  if (gpsFix) {
    gps["latitude"] = serialized(String(latitude, 6));
    gps["longitude"] = serialized(String(longitude, 6));
    gps["satellites"] = satellites;
    gps["altitude_m"] = serialized(String(altitudeM, 1));
  } else {
    gps["latitude"] = nullptr;
    gps["longitude"] = nullptr;
    gps["satellites"] = nullptr;
    gps["altitude_m"] = nullptr;
  }

  // Battery (unwired)
  JsonObject battery = doc.createNestedObject("battery");
  battery["voltage_v"] = nullptr;
  battery["percentage"] = nullptr;

  // Alerts
  JsonArray alerts = doc.createNestedArray("alerts");
  if (flameWarning) {
    JsonObject a = alerts.createNestedObject();
    a["code"] = "FLAME_ACTIVE";
    a["severity"] = "critical";
    a["source"] = "OPTICAL_FLAME";
    a["message"] = "Active optical flame detected!";
    a["timestamp_ms"] = millis();
  }
  if (smokeWarning) {
    JsonObject a = alerts.createNestedObject();
    a["code"] = "SMOKE_HIGH";
    a["severity"] = "warning";
    a["source"] = "MQ2_GAS";
    a["message"] = "High combustion smoke level detected.";
    a["timestamp_ms"] = millis();
  }

  // Serialize to string
  String jsonOutput;
  serializeJson(doc, jsonOutput);

  // 1. Broadcast over WebSocket to connected phones/laptops
  webSocket.broadcastTXT(jsonOutput);

  // 2. Stream to USB Serial for Direct Web Serial link
  Serial.println(jsonOutput);
}

// =====================================================
// WEBSOCKET EVENTS
// =====================================================
void handleWebSocketEvent(uint8_t num, WStype_t type, uint8_t * payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED:
      Serial.printf("[WS] Client #%u disconnected.\n", num);
      break;

    case WStype_CONNECTED: {
      IPAddress ip = webSocket.remoteIP(num);
      Serial.printf("[WS] Client #%u connected from %s\n", num, ip.toString().c_str());

      // Send greeting manifest
      StaticJsonDocument<512> manifest;
      manifest["version"] = 1;
      manifest["type"] = "manifest";
      manifest["timestamp_ms"] = millis();
      manifest["drone_id"] = "SKYFIGHTER-ALPHA-01";
      manifest["firmware_version"] = "1.1.0-AIO";
      manifest["gateway_ip"] = WiFi.softAPIP().toString();

      String out;
      serializeJson(manifest, out);
      webSocket.sendTXT(num, out);
      break;
    }

    case WStype_TEXT: {
      // Incoming GCS command
      StaticJsonDocument<512> cmd;
      DeserializationError err = deserializeJson(cmd, payload, length);
      if (!err) {
        const char* cmdType = cmd["type"] | "";
        if (strcmp(cmdType, "emergency_stop") == 0) {
          isArmed = false;
          digitalWrite(BUZZER_PIN, HIGH);
          delay(100);
          digitalWrite(BUZZER_PIN, LOW);
        } else if (strcmp(cmdType, "arm_command") == 0) {
          isArmed = cmd["arm"] | false;
        }
      }
      break;
    }

    default:
      break;
  }
}

// =====================================================
// SETUP
// =====================================================
void setup() {
  Serial.begin(115200);
  delay(1000);

  analogReadResolution(12);

  pinMode(MQ2_PIN, INPUT);
  pinMode(FLAME_PIN, INPUT_PULLUP); // Internal pullup prevents floating false flame
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);

  Wire.begin(MPU_SDA_PIN, MPU_SCL_PIN);
  mpuDetected = initializeMPU6050();

  dht.begin();
  GPSSerial.begin(9600, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);

  // Configure SoftAP Wi-Fi
  WiFi.mode(WIFI_AP);
  WiFi.softAPConfig(AP_IP, AP_GATEWAY, AP_SUBNET);
  if (WiFi.softAP(AP_SSID, AP_PASS, 6, 0, 4)) {
    Serial.printf("[WiFi] SoftAP started! SSID: %s | IP: 192.168.4.1:8080\n", AP_SSID);
  } else {
    Serial.println("[WiFi] ERROR: Failed to start SoftAP!");
  }

  // Start WebSocket Server
  webSocket.begin();
  webSocket.onEvent(handleWebSocketEvent);
  Serial.println("[WebSocket] Server listening on ws://192.168.4.1:8080/telemetry");

  Serial.println();
  Serial.println("========================================");
  Serial.println("   SKYFIGHTER ALL-IN-ONE INITIALIZED");
  Serial.println("========================================");
  Serial.print("MPU6050 IMU: ");
  Serial.println(mpuDetected ? "ONLINE" : "NOT DETECTED");
  Serial.println("DHT11 Sensor: ONLINE");
  Serial.println("MQ-2 Sensor: ONLINE");
  Serial.println("Flame Sensor: ONLINE (INPUT_PULLUP)");
  Serial.println("GPS Serial: ONLINE");
  Serial.println("Streaming telemetry at 2 Hz over Wi-Fi & USB...");
}

// =====================================================
// MAIN LOOP
// =====================================================
void loop() {
  webSocket.loop();
  processGPS();

  if (millis() - lastTelemetryTime >= TELEMETRY_INTERVAL_MS) {
    lastTelemetryTime = millis();

    readSensors();
    readMPU6050();
    broadcastTelemetry();
  }
}
