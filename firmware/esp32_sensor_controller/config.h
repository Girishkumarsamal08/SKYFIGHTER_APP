#ifndef FIRE_GUARDIAN_CONFIG_H
#define FIRE_GUARDIAN_CONFIG_H

// ==============================================================================
// FIRE GUARDIAN — ESP32 DevKit V1 Environmental Unit Configuration
// ==============================================================================

// Wi-Fi Station Credentials (connects to ground station router or mobile hotspot)
#ifndef WIFI_SSID
#define WIFI_SSID "FIRE-GUARDIAN-NET"
#endif

#ifndef WIFI_PASSWORD
#define WIFI_PASSWORD "fireguard2026"
#endif

// Backend Telemetry Endpoint (e.g., http://192.168.1.100:4000 or your remote server)
#ifndef BACKEND_URL
#define BACKEND_URL "http://192.168.1.100:4000/api/telemetry/environment"
#endif

// Device Identity & Security
#define DEVICE_ID "esp32_devkit"
#define DEVICE_AUTH_TOKEN "fire-guardian-device-secret-2026"

// ==============================================================================
// HARDWARE PIN DEFINITIONS (PRESERVED SPECIFICATION)
// ==============================================================================
#define PIN_MQ2_ANALOG      34   // ADC1_CH6 - Smoke / Combustible gas sensor
#define PIN_FLAME_DIGITAL   27   // DO - Optical flame detector (Active LOW)
#define PIN_BUZZER          25   // Emergency acoustic alarm (Active HIGH)
#define PIN_GPS_RX          16   // ESP32 RX2 <- GPS TX
#define PIN_GPS_TX          17   // ESP32 TX2 -> GPS RX

// ==============================================================================
// SENSOR THRESHOLDS & TIMINGS
// ==============================================================================
#define MQ2_THRESHOLD       1800   // Analog reading >= 1800 triggers SMOKE alert
#define FLAME_ACTIVE_LEVEL  LOW    // Active LOW trigger for optical flame sensor
#define GPS_BAUD_RATE       9600   // NEO-7M default NMEA baud rate

#define TELEMETRY_INTERVAL_MS 1000 // Send telemetry to backend at 1 Hz

#endif // FIRE_GUARDIAN_CONFIG_H
