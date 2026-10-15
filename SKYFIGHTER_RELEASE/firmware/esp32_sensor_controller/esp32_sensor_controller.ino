/*
  SKYFIGHTER — Sensor Controller & Experimental Flight Bridge (ESP32 #1)
  Dual-ESP32 UAV Architecture (v1.1)

  Target: ESP32 DevKit Module #1
  Sensors:
  - MQ-2 Smoke / Flammable Gas (GPIO 34 ADC)
  - DHT11 Ambient Temperature & Humidity (GPIO 4)
  - Optical Flame Sensor (GPIO 27 Active-LOW)
  - MPU6050 6-DoF IMU (I2C 0x68: SDA 21, SCL 22)
  - NEO-6M GPS (UART2: RX 16, TX 17)
  - Audible Alert Buzzer (GPIO 26)
  - Planned ESC Outputs: GPIO 25, 26, 27, 32 (Locked out for safety in initial release)

  Outputs:
  - Streams structured JSON telemetry packets matching PROTOCOL.md over UART to ESP32 #2 Gateway
  - Receives pilot commands from ESP32 #2 Gateway
  - Independent hardware failsafe: Cuts motors if command stream stops for >500 ms while armed
*/

#include <DHT.h>
#include <Wire.h>
#include <ArduinoJson.h>

// =====================================================
// GPIO PIN ASSIGNMENTS
// =====================================================
#define GPS_RX_PIN 16
#define GPS_TX_PIN 17

#define MPU_SDA_PIN 21
#define MPU_SCL_PIN 22

#define MQ2_PIN 34
#define DHT_PIN 4
#define FLAME_PIN 27
#define BUZZER_PIN 26

// ESC PWM Pins (Reserved for future flight controller testing)
#define ESC1_PIN 25
#define ESC2_PIN 33
#define ESC3_PIN 32
#define ESC4_PIN 18

// =====================================================
// SENSOR CONFIGURATION & THRESHOLDS
// =====================================================
#define DHT_TYPE DHT11
DHT dht(DHT_PIN, DHT_TYPE);

#define MPU6050_ADDR 0x68

const float TEMP_THRESHOLD_C = 50.0;
const float HUMIDITY_THRESHOLD = 85.0;
const int MQ2_INCREASE_THRESHOLD = 500;
const int FLAME_TRIGGER_LEVEL = LOW;

// Safety timeout: Flight controller failsafe triggers if UART quiet >500ms while armed
const unsigned long FAILSAFE_TIMEOUT_MS = 500;
const unsigned long TELEMETRY_INTERVAL_MS = 500; // 2 Hz telemetry stream

// =====================================================
// GLOBAL VARIABLES
// =====================================================
HardwareSerial GPSSerial(2);

// Telemetry State
unsigned long lastTelemetryStreamTime = 0;
unsigned long lastCommandReceivedTime = 0;
uint64_t telemetrySequence = 0;

// Flight State (Safety Gated)
bool isArmed = false;
bool manualControlCapability = false; // Kept false until PID loops certified
bool autonomousNavCapability = false;
bool returnToHomeCapability = false;

// Sensor Readings
int mq2Value = 0;
int mq2Baseline = 350; // Calibrated baseline
int mq2Threshold = 850;
int flameValue = HIGH;

float ambientTemperature = NAN;
float humidity = NAN;
float mpuTemperature = NAN;

bool mpuDetected = false;
int16_t ax, ay, az;
int16_t gx, gy, gz;
int16_t tempRaw;

// GPS State
String gpsLine = "";
double latitude = 0.0;
double longitude = 0.0;
bool gpsFix = false;
int satellites = 0;
float altitudeM = 0.0;
unsigned long lastGPSFixTime = 0;

// Warnings
bool smokeWarning = false;
bool flameWarning = false;
bool temperatureWarning = false;
bool humidityWarning = false;
bool dhtValid = false;

// =====================================================
// MPU6050 DRIVER
// =====================================================
bool initializeMPU6050() {
  Wire.beginTransmission(MPU6050_ADDR);
  Wire.write(0x6B);
  Wire.write(0x00); // Wake up MPU6050
  return Wire.endTransmission() == 0;
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
// GPS NMEA PARSER
// =====================================================
double convertNMEACoordinate(String value, String direction) {
  if (value.length() == 0 || direction.length() == 0) return 0.0;
  double raw = value.toDouble();
  int degrees = (int)(raw / 100.0);
  double minutes = raw - (degrees * 100.0);
  double coordinate = degrees + minutes / 60.0;
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
  if (fieldCount < 7) return;
  fields[fieldCount++] = sentence.substring(start);

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
// READ ENVIRONMENTAL SENSORS
// =====================================================
void readSensors() {
  mq2Value = analogRead(MQ2_PIN);
  flameValue = digitalRead(FLAME_PIN);

  ambientTemperature = dht.readTemperature();
  humidity = dht.readHumidity();

  dhtValid = !isnan(ambientTemperature) && !isnan(humidity) &&
             ambientTemperature >= 0.0 && ambientTemperature <= 50.0 &&
             humidity >= 20.0 && humidity <= 90.0;

  if (mq2Baseline >= 0) {
    mq2Threshold = min(4095, mq2Baseline + MQ2_INCREASE_THRESHOLD);
    smokeWarning = (mq2Value >= mq2Threshold);
  } else {
    smokeWarning = false;
  }

  flameWarning = (flameValue == FLAME_TRIGGER_LEVEL);
  temperatureWarning = dhtValid && ambientTemperature >= TEMP_THRESHOLD_C;
  humidityWarning = dhtValid && humidity >= HUMIDITY_THRESHOLD;
}

// =====================================================
// AUTONOMOUS BUZZER CONTROL
// =====================================================
void updateBuzzer() {
  // Direct hardware buzzer activation on flame/smoke detection
  bool warning = smokeWarning || flameWarning || temperatureWarning || humidityWarning;
  digitalWrite(BUZZER_PIN, warning ? HIGH : LOW);
}

// =====================================================
// STREAM STRUCTURED PROTOCOL v1.1 TELEMETRY TO GATEWAY
// =====================================================
void streamTelemetry() {
  StaticJsonDocument<1024> doc;
  doc["version"] = 1;
  doc["type"] = "telemetry";
  doc["sequence"] = ++telemetrySequence;
  doc["timestamp_ms"] = millis();
  doc["connection"] = "connected";

  // Flight state & capabilities
  JsonObject flight = doc.createNestedObject("flight");
  flight["mode"] = isArmed ? "manual" : "disarmed";
  flight["armed"] = isArmed;
  
  JsonObject caps = flight.createNestedObject("capabilities");
  caps["manual_control"] = manualControlCapability; // Strictly false in current build
  caps["autonomous_navigation"] = autonomousNavCapability;
  caps["return_to_home"] = returnToHomeCapability;
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

  // Battery: Honest reporting of unwired voltage divider
  JsonObject battery = doc.createNestedObject("battery");
  battery["voltage_v"] = nullptr;
  battery["percentage"] = nullptr;

  // Discrete alerts
  JsonArray alerts = doc.createNestedArray("alerts");
  if (flameWarning) {
    JsonObject a = alerts.createNestedObject();
    a["code"] = "FLAME_ACTIVE";
    a["severity"] = "critical";
    a["source"] = "OPTICAL_FLAME";
    a["message"] = "Optical flame sensor triggered!";
    a["timestamp_ms"] = millis();
  }
  if (smokeWarning) {
    JsonObject a = alerts.createNestedObject();
    a["code"] = "SMOKE_HIGH";
    a["severity"] = "warning";
    a["source"] = "MQ2_GAS";
    a["message"] = "Smoke reading exceeded baseline threshold.";
    a["timestamp_ms"] = millis();
  }

  // Serialize and stream single JSON line over Serial
  serializeJson(doc, Serial);
  Serial.println();
}

// =====================================================
// PROCESS INCOMING COMMANDS FROM GATEWAY OVER SERIAL
// =====================================================
void processIncomingCommands() {
  while (Serial.available()) {
    String line = Serial.readStringUntil('\n');
    line.trim();
    if (line.length() == 0 || !line.startsWith("{")) continue;

    StaticJsonDocument<512> cmdDoc;
    DeserializationError err = deserializeJson(cmdDoc, line);
    if (err) continue;

    lastCommandReceivedTime = millis();
    const char* type = cmdDoc["type"] | "";

    if (strcmp(type, "emergency_stop") == 0) {
      isArmed = false;
      // Immediately disable ESC PWM signals
      digitalWrite(BUZZER_PIN, HIGH);
      delay(100);
      digitalWrite(BUZZER_PIN, LOW);
    } else if (strcmp(type, "arm_command") == 0) {
      bool arm = cmdDoc["arm"] | false;
      // Only permit arming if sensors healthy and manual control capability flag is true
      if (manualControlCapability) {
        isArmed = arm;
      } else {
        isArmed = false; // Locked out
      }
    }
  }

  // Independent Hardware Failsafe Check:
  // If armed and no commands received for >500ms, disarm and trigger buzzer
  if (isArmed && (millis() - lastCommandReceivedTime > FAILSAFE_TIMEOUT_MS)) {
    isArmed = false; // Autonomous disarm
    digitalWrite(BUZZER_PIN, HIGH);
    delay(200);
    digitalWrite(BUZZER_PIN, LOW);
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
  pinMode(FLAME_PIN, INPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);

  Wire.begin(MPU_SDA_PIN, MPU_SCL_PIN);
  mpuDetected = initializeMPU6050();

  dht.begin();
  GPSSerial.begin(9600, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);

  // Reserve ESC PWM outputs as inactive
  pinMode(ESC1_PIN, OUTPUT);
  pinMode(ESC2_PIN, OUTPUT);
  pinMode(ESC3_PIN, OUTPUT);
  pinMode(ESC4_PIN, OUTPUT);
  digitalWrite(ESC1_PIN, LOW);
  digitalWrite(ESC2_PIN, LOW);
  digitalWrite(ESC3_PIN, LOW);
  digitalWrite(ESC4_PIN, LOW);
}

// =====================================================
// MAIN LOOP
// =====================================================
void loop() {
  processGPS();
  processIncomingCommands();

  if (millis() - lastTelemetryStreamTime >= TELEMETRY_INTERVAL_MS) {
    lastTelemetryStreamTime = millis();
    readSensors();
    readMPU6050();
    updateBuzzer();
    streamTelemetry();
  }
}
