/**
 * ==============================================================================
 * FIRE GUARDIAN — ESP32 DevKit V1 Environmental Monitoring Unit Firmware
 * ==============================================================================
 * Hardware Peripherals:
 *   - ESP32 DevKit V1
 *   - MQ-2 Smoke / Combustible Gas Sensor on GPIO 34 (AO)
 *   - Optical Flame Sensor on GPIO 27 (DO, Active-LOW)
 *   - Emergency Buzzer Siren on GPIO 25 (Active-HIGH)
 *   - NEO-7M GPS on GPIO 16 (RX) / GPIO 17 (TX) at 9600 Baud
 *
 * SAFETY MANDATE:
 *   - The emergency buzzer and fire detection operate 100% locally and autonomously.
 *   - Zero blocking delay() calls in the main control loop.
 *   - If Wi-Fi, backend, or internet is lost, the local buzzer continues to function.
 * ==============================================================================
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <TinyGPSPlus.h>
#include <ArduinoJson.h>
#include "config.h"

// ------------------------------------------------------------------------------
// HARDWARE PERIPHERALS
// ------------------------------------------------------------------------------
TinyGPSPlus gps;
HardwareSerial GPSSerial(2); // UART2

// ------------------------------------------------------------------------------
// SENSOR & SYSTEM STATE
// ------------------------------------------------------------------------------
int rawSmokeAdc = 0;
bool smokeDetected = false;
bool flameDetected = false;
bool buzzerActive = false;

double latitude = 0.0;
double longitude = 0.0;
bool gpsFixed = false;
int satelliteCount = 0;
float altitudeM = 0.0;

unsigned long lastTelemetryMs = 0;
unsigned long lastWifiCheckMs = 0;

// ------------------------------------------------------------------------------
// AUTONOMOUS LOCAL SENSOR LOOP (ZERO BLOCKING DELAY)
// ------------------------------------------------------------------------------
void pollSensors() {
  // Read MQ-2 Analog Smoke Sensor (12-bit ADC: 0 - 4095)
  rawSmokeAdc = analogRead(PIN_MQ2_ANALOG);
  smokeDetected = (rawSmokeAdc >= MQ2_THRESHOLD);

  // Read Flame Sensor Digital Output (Active-LOW: 0V = Flame detected)
  flameDetected = (digitalRead(PIN_FLAME_DIGITAL) == FLAME_ACTIVE_LEVEL);

  // Autonomous Hardware Interlock: Sound emergency buzzer immediately on hazard
  buzzerActive = (smokeDetected || flameDetected);
  digitalWrite(PIN_BUZZER, buzzerActive ? HIGH : LOW);
}

// ------------------------------------------------------------------------------
// GPS NMEA PARSER (STREAMED VIA UART2)
// ------------------------------------------------------------------------------
void processGPS() {
  while (GPSSerial.available() > 0) {
    char c = GPSSerial.read();
    gps.encode(c);
  }

  if (gps.location.isValid() && gps.location.age() < 5000) {
    latitude = gps.location.lat();
    longitude = gps.location.lng();
    gpsFixed = true;
    satelliteCount = gps.satellites.isValid() ? gps.satellites.value() : 0;
    altitudeM = gps.altitude.isValid() ? (float)gps.altitude.meters() : 0.0;
  } else {
    gpsFixed = false;
    satelliteCount = gps.satellites.isValid() ? gps.satellites.value() : 0;
  }
}

// ------------------------------------------------------------------------------
// TELEMETRY TRANSMISSION TO BACKEND VIA HTTP POST
// ------------------------------------------------------------------------------
void sendTelemetryToBackend() {
  if (WiFi.status() != WL_CONNECTED) {
    return; // Wi-Fi offline; local detection remains active
  }

  HTTPClient http;
  http.begin(BACKEND_URL);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Token", DEVICE_AUTH_TOKEN);
  http.setTimeout(1200); // Strict timeout to prevent blocking main loop

  StaticJsonDocument<512> doc;
  doc["device_id"] = DEVICE_ID;
  doc["smoke_adc"] = rawSmokeAdc;
  doc["smoke_detected"] = smokeDetected;
  doc["flame_detected"] = flameDetected;

  if (gpsFixed) {
    doc["latitude"] = latitude;
    doc["longitude"] = longitude;
    doc["gps_fixed"] = true;
    doc["satellites"] = satelliteCount;
    doc["altitude_m"] = altitudeM;
  } else {
    doc["latitude"] = nullptr;
    doc["longitude"] = nullptr;
    doc["gps_fixed"] = false;
    doc["satellites"] = satelliteCount;
    doc["altitude_m"] = nullptr;
  }

  doc["buzzer"] = buzzerActive;
  doc["uptime"] = (uint32_t)(millis() / 1000);
  doc["timestamp"] = (uint64_t)millis();

  String payload;
  serializeJson(doc, payload);

  int httpCode = http.POST(payload);
  if (httpCode > 0) {
    // Successfully delivered telemetry
  }
  http.end();
}

// ------------------------------------------------------------------------------
// NON-BLOCKING WI-FI MANAGEMENT
// ------------------------------------------------------------------------------
void maintainWiFiConnection() {
  if (WiFi.status() != WL_CONNECTED) {
    unsigned long now = millis();
    if (now - lastWifiCheckMs > 10000) { // Retry every 10 seconds
      lastWifiCheckMs = now;
      WiFi.reconnect();
    }
  }
}

// ------------------------------------------------------------------------------
// SETUP
// ------------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(100);

  Serial.println("\n========================================================");
  Serial.println("  FIRE GUARDIAN — ESP32 DevKit V1 Environmental Unit   ");
  Serial.println("========================================================");

  // Configure GPIO Pins
  pinMode(PIN_MQ2_ANALOG, INPUT);
  pinMode(PIN_FLAME_DIGITAL, INPUT_PULLUP);
  pinMode(PIN_BUZZER, OUTPUT);
  digitalWrite(PIN_BUZZER, LOW);

  // Initialize NEO-7M GPS UART
  GPSSerial.begin(GPS_BAUD_RATE, SERIAL_8N1, PIN_GPS_RX, PIN_GPS_TX);
  Serial.printf("[GPS] Initialized UART2 on RX:%d TX:%d at %d baud\n", PIN_GPS_RX, PIN_GPS_TX, GPS_BAUD_RATE);

  // Initialize Wi-Fi in Station Mode (Non-blocking)
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.printf("[WiFi] Connecting to %s...\n", WIFI_SSID);

  // Initial sensor read
  pollSensors();
}

// ------------------------------------------------------------------------------
// MAIN CONTROL LOOP (NON-BLOCKING)
// ------------------------------------------------------------------------------
void loop() {
  unsigned long now = millis();

  // 1. Continuous, non-blocking sensor acquisition & emergency buzzer interlock
  pollSensors();

  // 2. Stream GPS NMEA characters from hardware UART buffer
  processGPS();

  // 3. Periodic Telemetry Transmission to Backend (every 1000 ms)
  if (now - lastTelemetryMs >= TELEMETRY_INTERVAL_MS) {
    lastTelemetryMs = now;
    sendTelemetryToBackend();
  }

  // 4. Non-blocking Wi-Fi auto-reconnect check
  maintainWiFiConnection();
}
