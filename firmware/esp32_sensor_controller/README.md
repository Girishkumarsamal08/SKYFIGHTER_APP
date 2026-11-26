# FIRE GUARDIAN — ESP32 DevKit V1 Environmental Unit Firmware

## 1. Hardware Pin Connections

| Component | ESP32 DevKit Pin | Function / Logic Level |
|---|---|---|
| **MQ-2 Smoke Sensor** | **GPIO 34** (ADC1_CH6) | Analog voltage output (0 - 3.3V) |
| **Optical Flame Sensor** | **GPIO 27** | Digital output (Active LOW with pullup) |
| **Emergency Buzzer** | **GPIO 25** | Digital output (Active HIGH alarm) |
| **NEO-7M GPS TX** | **GPIO 16** (RX2) | 9600 Baud NMEA serial input |
| **NEO-7M GPS RX** | **GPIO 17** (TX2) | 9600 Baud NMEA serial output |
| **16x2 I2C LCD SDA** | **GPIO 21** | I2C Data line (Address 0x27 or 0x3F) |
| **16x2 I2C LCD SCL** | **GPIO 22** | I2C Clock line |

---

## 2. Thresholds & Logic
* **Smoke Threshold**: `MQ2_THRESHOLD = 1800`. Readings at or above 1800 trigger a smoke alarm.
* **Flame Detection**: Flame sensor pulls GPIO 27 LOW upon infrared emission from a flame.
* **Autonomous Buzzer**: Triggered directly and immediately in the hardware loop whenever smoke or flame is detected.
* **Autonomous LCD**: Refreshes at 2 Hz showing live MQ-2 ADC reading, fire status, and GPS fix state.
* **Zero Internet Dependency**: The buzzer sounds and LCD warns even if Wi-Fi or backend server is disconnected.

---

## 3. How to Flash via Arduino IDE
1. Open Arduino IDE.
2. Install libraries from Library Manager:
   - `TinyGPSPlus` (by Mikal Hart)
   - `LiquidCrystal_I2C` (by Frank de Brabander or Marco Schwartz)
   - `ArduinoJson` (v6 or v7)
3. Select Board: **ESP32 Dev Module**.
4. Configure your network credentials in `config.h`:
   ```c
   #define WIFI_SSID "YOUR_WIFI_SSID"
   #define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"
   #define BACKEND_URL "http://YOUR_SERVER_IP:4000/api/telemetry/environment"
   ```
5. Connect ESP32 DevKit via micro-USB and click **Upload**.
