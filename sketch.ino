/*
  SKYFIGHTER
  AI Forest Fire Detection & Response Drone
  Sensor Monitoring Prototype

  Hardware:
  ESP32 Dev Module
  MQ-2, DHT11/DHT22, digital flame sensor,
  MPU6050, NEO-6M GPS and buzzer

  This is sensor-monitoring code, NOT flight-control software.
*/

#include <DHT.h>
#include <Wire.h>

// =====================================================
// GPIO CONFIGURATION
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
// TEMPERATURE SENSOR CONFIGURATION
// Choose ONE according to your actual sensor.
// =====================================================

#define DHT_TYPE DHT11
// For a DHT11, change the line above to:
// #define DHT_TYPE DHT11

DHT dht(DHT_PIN, DHT_TYPE);

// =====================================================
// MPU6050
// =====================================================

#define MPU6050_ADDR 0x68

bool mpuDetected = false;

int16_t ax, ay, az;
int16_t gx, gy, gz;
int16_t tempRaw;

// =====================================================
// GPS
// =====================================================

HardwareSerial GPSSerial(2);

String gpsLine = "";

double latitude = 0.0;
double longitude = 0.0;

bool gpsFix = false;
bool newGPSData = false;

unsigned long lastGPSFixTime = 0;

// =====================================================
// PROTOTYPE WARNING THRESHOLDS
// =====================================================

const float TEMP_THRESHOLD_C = 50.0;
const float HUMIDITY_THRESHOLD = 85.0;

// MQ-2: baseline must be measured before enabling alerts.
const int MQ2_INCREASE_THRESHOLD = 500;

int mq2Baseline = -1;
int MQ2_THRESHOLD = 4095;

// Flame sensor polarity: verify against your module.
const int FLAME_TRIGGER_LEVEL = LOW;

// =====================================================
// SENSOR VALUES AND WARNINGS
// =====================================================

int mq2Value = 0;
int flameValue = HIGH;

float ambientTemperature = NAN;
float humidity = NAN;
float mpuTemperature = NAN;

bool smokeWarning = false;
bool flameWarning = false;
bool temperatureWarning = false;
bool humidityWarning = false;

bool dhtValid = false;

unsigned long lastReportTime = 0;

const unsigned long REPORT_INTERVAL_MS = 2000;

// =====================================================
// MPU6050 INITIALIZATION
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
  if (!mpuDetected) {
    return false;
  }

  Wire.beginTransmission(MPU6050_ADDR);
  Wire.write(0x3B);

  if (Wire.endTransmission(false) != 0) {
    return false;
  }

  if (Wire.requestFrom(MPU6050_ADDR, 14, true) != 14) {
    return false;
  }

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
// GPS COORDINATE CONVERSION
// =====================================================

double convertNMEACoordinate(String value, String direction) {
  if (value.length() == 0 || direction.length() == 0) {
    return 0.0;
  }

  double raw = value.toDouble();

  int degrees = (int)(raw / 100.0);
  double minutes = raw - (degrees * 100.0);

  double coordinate = degrees + minutes / 60.0;

  if (direction == "S" || direction == "W") {
    coordinate = -coordinate;
  }

  return coordinate;
}

// Parse GGA sentence for valid position fix.
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

  if (fieldCount < 7) {
    return;
  }

  fields[fieldCount++] = sentence.substring(start);

  // GGA field 2 = latitude
  // GGA field 3 = N/S
  // GGA field 4 = longitude
  // GGA field 5 = E/W
  // GGA field 6 = fix quality

  if (fields[6].toInt() > 0) {
    latitude = convertNMEACoordinate(fields[2], fields[3]);
    longitude = convertNMEACoordinate(fields[4], fields[5]);

    gpsFix = true;
    lastGPSFixTime = millis();
    newGPSData = true;
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
      if (gpsLine.length() < 120) {
        gpsLine += c;
      } else {
        gpsLine = "";
      }
    }
  }

  // Treat a GPS fix as stale if updates stop.
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

  // Validate DHT11 readings before using them.
  dhtValid = !isnan(ambientTemperature) && !isnan(humidity) &&
             ambientTemperature >= 0.0 && ambientTemperature <= 50.0 &&
             humidity >= 20.0 && humidity <= 90.0;

  // MQ-2 warning is disabled until a baseline is configured.
  if (mq2Baseline >= 0) {
    MQ2_THRESHOLD = min(4095, mq2Baseline + MQ2_INCREASE_THRESHOLD);

    smokeWarning = (mq2Value >= MQ2_THRESHOLD);
  } else {
    smokeWarning = false;
  }

  // Flame sensor warning.
  flameWarning = (flameValue == FLAME_TRIGGER_LEVEL);

  // DHT11 warnings.
  temperatureWarning = dhtValid && ambientTemperature >= TEMP_THRESHOLD_C;

  humidityWarning = dhtValid && humidity >= HUMIDITY_THRESHOLD;
}

// =====================================================
// BUZZER
// =====================================================

void updateBuzzer() {
  bool warning =
      smokeWarning || flameWarning || temperatureWarning || humidityWarning;

  digitalWrite(BUZZER_PIN, warning ? HIGH : LOW);
}

// =====================================================
// PRINT REPORT
// =====================================================

void printReport() {
  Serial.println();
  Serial.println("========================================");
  Serial.println("       SKYFIGHTER SENSOR REPORT");
  Serial.println("========================================");

  Serial.print("MQ-2 raw reading: ");
  Serial.println(mq2Value);

  Serial.print("Smoke threshold warning: ");
  Serial.println(smokeWarning ? "YES" : "NO");

  Serial.print("Flame sensor DO: ");
  Serial.println(flameValue == LOW ? "LOW" : "HIGH");

  Serial.print("Flame warning: ");
  Serial.println(flameWarning ? "YES" : "NO");

  Serial.print("Ambient temperature: ");

  if (isnan(ambientTemperature)) {
    Serial.println("DHT READ ERROR");
  } else {
    Serial.print(ambientTemperature, 1);
    Serial.println(" C");
  }

  Serial.print("Humidity: ");

  if (isnan(humidity)) {
    Serial.println("DHT READ ERROR");
  } else {
    Serial.print(humidity, 1);
    Serial.println(" %");
  }

  Serial.print("Temperature warning: ");
  Serial.println(temperatureWarning ? "YES" : "NO");

  Serial.println("\n--- MPU6050 ---");

  if (readMPU6050()) {
    Serial.print("Acceleration X: ");
    Serial.print(ax / 16384.0, 2);

    Serial.print(" | Y: ");
    Serial.print(ay / 16384.0, 2);

    Serial.print(" | Z: ");
    Serial.print(az / 16384.0, 2);
    Serial.println(" g");

    Serial.print("Gyroscope X: ");
    Serial.print(gx / 131.0, 2);

    Serial.print(" | Y: ");
    Serial.print(gy / 131.0, 2);

    Serial.print(" | Z: ");
    Serial.print(gz / 131.0, 2);
    Serial.println(" deg/s");

    Serial.print("MPU6050 chip temperature: ");
    Serial.print(mpuTemperature, 1);
    Serial.println(" C");
  } else {
    Serial.println("MPU6050 NOT RESPONDING");
  }

  Serial.println("\n--- GPS ---");

  if (gpsFix) {
    Serial.print("Latitude: ");
    Serial.println(latitude, 6);

    Serial.print("Longitude: ");
    Serial.println(longitude, 6);

    Serial.print("Map coordinates: ");
    Serial.print(latitude, 6);
    Serial.print(",");
    Serial.println(longitude, 6);
  } else {
    Serial.println("No current valid GPS fix.");
    Serial.println("Move antenna outdoors with clear sky view.");
  }

  Serial.println("\n--- ALERT STATUS ---");

  Serial.print("Smoke warning: ");
  Serial.println(smokeWarning ? "YES" : "NO");

  Serial.print("Flame warning: ");
  Serial.println(flameWarning ? "YES" : "NO");

  Serial.print("Temperature warning: ");
  Serial.println(temperatureWarning ? "YES" : "NO");

  Serial.print("Humidity warning: ");
  Serial.println(humidityWarning ? "YES" : "NO");

  if (smokeWarning || flameWarning || temperatureWarning || humidityWarning) {
    Serial.println("WARNING: SENSOR THRESHOLD TRIGGERED");
  } else {
    Serial.println("System normal.");
  }

  Serial.println("========================================");
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

  Serial.println();
  Serial.println("SKYFIGHTER INITIALIZATION");
  Serial.println("-------------------------");

  Serial.print("MPU6050: ");
  Serial.println(mpuDetected ? "DETECTED" : "NOT DETECTED");

  Serial.println("DHT sensor initialized.");
  Serial.println("GPS serial initialized.");
  Serial.println("MQ-2 analog input initialized.");
  Serial.println("Flame sensor input initialized.");
  Serial.println("Buzzer output initialized.");

  Serial.println();
  Serial.println("Waiting for sensor readings...");
}

// =====================================================
// MAIN LOOP
// =====================================================

void loop() {
  processGPS();

  if (millis() - lastReportTime >= REPORT_INTERVAL_MS) {
    lastReportTime = millis();

    readSensors();
    updateBuzzer();
    printReport();
  }
}
