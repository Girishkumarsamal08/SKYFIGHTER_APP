# SKYFIGHTER Hardware Implementation Status Matrix

This matrix documents the verification state of each physical and software subsystem in the SKYFIGHTER project.

---

## 1. Subsystem Verification Matrix

| Subsystem / Component | Hardware Target | Status in Firmware (`sketch.ino`) | Status in iPhone App | Safety Action / Guard |
| :--- | :--- | :--- | :--- | :--- |
| **DHT11 Temp & Humidity** | ESP32 #1 (GPIO 4) | **Verified Implemented** | Live Display & High-Temp Alert | Flags `DHT READ ERROR` if unplugged. |
| **Digital Flame Sensor** | ESP32 #1 (GPIO 27) | **Verified Implemented** | Live Status & Incident Logger | Active-low optical detection. |
| **MQ-2 Gas / Smoke Sensor** | ESP32 #1 (GPIO 34) | **Verified Implemented** | Live ADC & Threshold Alarm | Requires baseline calibration before alerting. |
| **MPU6050 6-DoF IMU** | ESP32 #1 (I2C 0x68) | **Verified Implemented** | Orientation & Diagnostics | Alerts if chip unresponsive over I2C. |
| **NEO-6M GPS Module** | ESP32 #1 (UART2 GPIO 16/17) | **Verified Implemented** | Live Tactical Map & Coordinates | Coordinate display blocked until 3D fix valid. |
| **Local Alert Buzzer** | ESP32 #1 (GPIO 26) | **Verified Implemented** | Triggered Onboard Directly | Fires autonomously on fire/smoke without phone. |
| **ESP32 #2 Wi-Fi Gateway** | ESP32 Dev Module #2 | **Bridge in Progress** | WebSocket & TCP Transports Ready | SoftAP connection management & diagnostics. |
| **4x Brushless Motors + ESCs** | A2212 1000KV + 30A ESCs | **Planned / Unimplemented** | UI Control Ready (Simulation Available) | **Lockout Active**: Manual flight rejected if capability false. |
| **Autonomous Navigation** | ESP32 #1 Firmware Algorithm | **Planned / Unimplemented** | Mission Planner UI Ready | **Lockout Active**: App enforces "Capability not verified" banner. |
| **Return to Home (RTH)** | ESP32 #1 Firmware Algorithm | **Planned / Unimplemented** | RTH Action Button | Disabled until reported by firmware. |
| **3S LiPo Battery Monitor** | Voltage Divider Resistor | **Hardware Unwired** | Explicitly Displays "Unavailable" | Never displays fabricated or guessed voltage. |

---

## 2. Firmware Capabilities vs App Behavior

1. **Environmental Monitoring**:
   - The sensors connected to ESP32 #1 (DHT11, MQ-2, Flame sensor, MPU6050, GPS) are fully configured and functional in `sketch.ino`.
   - The iPhone app parses these real-time values, evaluates composite hazard states (`NORMAL`, `POSSIBLE SMOKE`, `FLAME DETECTED`, `MULTI-SENSOR ALERT`), and triggers iOS alerts.

2. **Flight Control Protections**:
   - `sketch.ino` explicitly states: *"This is sensor-monitoring code, NOT flight-control software."*
   - Therefore, the iPhone app **strictly enforces safety guards**:
     - It will **not** attempt to drive motors or claim that flight control works until ESP32 #1 reports `capabilities.manual_control = true`.
     - It provides a dedicated **UI Simulation Mode** so the pilot can safely test touchscreen joysticks, sliders, and physical game controllers without sending dangerous commands to incomplete firmware.

3. **Game Controller Input**:
   - Supported via Apple's native `GameController` framework.
   - Tested and mapped for dual-analog thumbsticks, triggers, and face buttons.
   - Requires explicit pilot authorization toggle (`Authorize Controller for Flight Control`) before stick inputs can drive flight values.
