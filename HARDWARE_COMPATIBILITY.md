# SKYFIGHTER Hardware Compatibility & Pinout Specification

This document details supported microcontrollers, sensors, communication modules, and wiring schematics.

---

## 1. System Hardware Block Architecture

```
                                  +------------------------------------+
                                  | 3S LiPo Battery (11.1V, 2200mAh)   |
                                  +------------------------------------+
                                           |                      |
                        5V Buck Converter  |                      | Raw 11.1V
                                           v                      v
                       +-----------------------+     +-----------------------+
                       | 5V / 3.3V Power Rail  |     | 4x 30A ESCs + Motors  |
                       +-----------------------+     | (A2212 1000KV)        |
                          |                 |        +-----------------------+
                          v                 v                    ^
               +----------------+    +----------------+          |
               | ESP32 DevKit #1|    | ESP32 DevKit #2|          | PWM
               | (Sensors & FC) |    | (Comms Gateway)|----------+
               +----------------+    +----------------+
                 |   |   |   |               |
                 v   v   v   v               v
             DHT11  MQ2 MPU GPS        Wi-Fi SoftAP
```

---

## 2. Microcontroller & Module Specifications

### ESP32 DevKit Module #1 (Flight & Sensor Controller)
- **Processor**: Dual-core Tensilica Xtensa LX6 @ 240 MHz
- **Operating Voltage**: 3.3V Logic (5V tolerant via dev board regulator)
- **Sensors Connected**:
  - **DHT11 / DHT22** (GPIO 4): Ambient temperature and relative humidity. Sampling interval: 2000 ms.
  - **MQ-2 Gas & Smoke** (GPIO 34): 12-bit analog reading on ADC1. Warning threshold: Baseline + 500.
  - **Optical Flame Sensor** (GPIO 27): Digital infrared photodiode (760nm - 1100nm). Active-LOW trigger.
  - **MPU6050 6-DoF IMU** (I2C 0x68): SDA on GPIO 21, SCL on GPIO 22. 3-axis accelerometer (±2g) and 3-axis gyroscope (±250°/s).
  - **NEO-6M GPS** (UART2): RX on GPIO 16, TX on GPIO 17. Baud rate: 9600 bps. NMEA $GPGGA sentences.
  - **Piezo Buzzer** (GPIO 26): Active 5V / 3.3V audible alarm. Autonomous onboard trigger.
  - **ESC Outputs**: GPIO 25, 33, 32, 18 (Locked out in initial release for flight safety).

### ESP32 DevKit Module #2 (Wi-Fi & Communication Gateway)
- **Wi-Fi Mode**: 802.11 b/g/n SoftAP (SSID: `SKYFIGHTER_GATEWAY`, Pass: `password123`)
- **WebSocket Server**: Port 8080 (`ws://192.168.4.1:8080/telemetry`)
- **Inter-Board UART Link**: RX on GPIO 16, TX on GPIO 17 at 115200 baud.
- **Onboard Status LED**: GPIO 2

---

## 3. Recommended Flight Hardware Components

| Subsystem | Recommended Hardware Component | Notes |
| :--- | :--- | :--- |
| **Airframe** | F450 Quadcopter Frame (450mm wheelbase) | Durable glass fiber and nylon arms |
| **Motors** | 4x A2212 1000KV Brushless Motors | Standard 1045 propellers |
| **ESCs** | 4x 30A SimonK / BLHeli Brushless ESCs | With 5V 2A BEC |
| **Battery** | 3S 2200mAh 11.1V 35C LiPo Battery | XT60 connector |
| **Power Distribution** | PDB with 5V 3A BEC Buck Converter | Must power ESP32 and sensors cleanly |
| **GPS Antenna** | Ceramic patch active antenna | Mount on elevated mast away from ESC noise |
| **Thermal Camera (Planned)** | MLX90640 32x24 Far-Infrared Array | I2C communication at 400 kHz |
| **RGB Camera (Planned)** | ESP32-CAM (OV2640 2MP) | Direct RTSP/MJPEG stream |

---

## 4. Power Supply & Grounding Guidelines
1. **Common Ground**: All microcontrollers, sensors, ESCs, and buck converters must share a common ground (GND) to avoid floating logic levels and I2C bus lockups.
2. **MQ-2 Heater Current**: The MQ-2 internal heater draws up to 150 mA at 5V. Power the MQ-2 sensor from the 5V buck converter output, NOT directly from the ESP32 3.3V pin.
3. **Brownout Prevention**: ESP32 Wi-Fi transmission peaks can draw up to 350 mA. Ensure a 100 µF capacitor is placed across the ESP32 #2 power pins.
