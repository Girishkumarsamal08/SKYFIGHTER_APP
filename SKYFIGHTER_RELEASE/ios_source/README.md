# SKYFIGHTER - iPhone Ground Control Station (GCS)
### AI Forest Fire Detection & Response Drone System

**SKYFIGHTER** is a native, iPhone-first UAV ground control station designed for real-time forest fire detection, environmental sensor telemetry, manual flight control, and autonomous mission monitoring.

---

## 1. System Architecture

The drone is built around a **dual-ESP32 architecture**:

```
+-----------------------------------------------------------+
|                      iPhone GCS App                       |
|        SwiftUI • GameController • MapKit • Network        |
+-----------------------------------------------------------+
                             |
                             | Wi-Fi (WebSocket or TCP Socket)
                             v
+-----------------------------------------------------------+
|          ESP32 #2: Communication Gateway Module           |
|      - SoftAP / Local Wi-Fi (SSID: SKYFIGHTER_GATEWAY)    |
|      - JSON packet validation & rate enforcement          |
+-----------------------------------------------------------+
                             |
                             | Hardware UART (115200 Baud)
                             v
+-----------------------------------------------------------+
|          ESP32 #1: Flight & Sensor Controller             |
|      - MQ-2 Smoke Sensor (GPIO 34 ADC)                    |
|      - DHT11 Temp & Humidity (GPIO 4)                     |
|      - Digital Flame Sensor (GPIO 27 Active-Low)          |
|      - NEO-6M GPS (UART2 GPIO 16/17)                      |
|      - MPU6050 6-DoF IMU (I2C 0x68)                       |
|      - Audible Alert Buzzer (GPIO 26)                     |
|      - 4x A2212 1000KV Brushless Motors (Planned)         |
+-----------------------------------------------------------+
```

---

## 2. Key Features

1. **Live Dashboard**:
   - Drone connection health, transport mode, latency, and packet counters.
   - Flight status (Armed, Disarmed, Modes) and verified capability indicators.
   - Real-time environmental metrics (DHT11 Temperature, Humidity, MQ-2 Smoke ADC, Flame sensor status).
   - NEO-6M GPS satellite count, 3D fix status, and live coordinates.
   - Honest battery telemetry reporting (*"Unavailable"* until voltage divider is physically wired).
   - Real-time hardware alerts and warning banners.

2. **Manual Flight Control**:
   - **Virtual Joystick**: Touch drag cyclic stick for Roll & Pitch with spring-loaded return to center.
   - **Throttle Slider**: Vertical safety slider starting at 0% with armed-state interlocks.
   - **Yaw Controls**: Fast-action left/right rotation controls.
   - **Safety Arming Flow**: Two-step preflight checklist with slide-to-arm gesture.
   - **Emergency Stop Button**: Prioritized one-tap motor shutdown command.
   - **Safe UI Simulation Mode**: Pilot can test controls without transmitting to real hardware.

3. **Physical Game Controller Support**:
   - Built on Apple's native `GameController` framework (`GCController`).
   - Supports Bluetooth (DualSense, Xbox, MFi) and USB-C wired controllers.
   - Live stick position crosshair gauges and button diagnostic tests.
   - Dead-zone and exponential curve sensitivity sliders.
   - Support for Mode 1 and Mode 2 stick mapping.
   - **Safety Gate**: Explicit pilot confirmation required before thumbsticks can command motors.

4. **Autonomous Mission Screen**:
   - Mission planner for Environmental Surveys, Forest Fire Observation, and GPS Waypoint transit.
   - **Firmware Capability Gating**: Strictly verifies `capabilities.autonomous_navigation`. If unverified, displays *"Autonomous navigation unavailable — onboard capability not verified"* and prevents launch.
   - Live mission event timeline and preflight audit checklist.

5. **Tactical GPS Map (MapKit)**:
   - High-resolution satellite imagery plotting live drone position when GPS fix is valid.
   - Clear *"No GPS Fix"* fallback screen when satellites are not acquired (never invents coordinates).
   - Fire alert pins marked at the exact GPS coordinates where flame was detected.
   - Pilot home coordinate marker.

6. **Fire Hazard Monitoring & Alert Engine**:
   - Evaluates composite hazard states: `NORMAL`, `POSSIBLE SMOKE`, `FLAME DETECTED`, `HIGH TEMPERATURE`, `MULTI-SENSOR ALERT`, `SENSOR ERROR`, and `COMMUNICATION LOST`.
   - Audio alert notifications and historical incident log with timestamps and coordinates.

7. **Wi-Fi Connection Manager**:
   - Configurable SSID, Password, Gateway IP (default `192.168.4.1`), and Port (`8080`).
   - Transport selection: WebSocket (`ws://`), Raw TCP, or Mock Simulation.
   - Detailed firmware capability manifest matrix.

---

## 3. Building and Running

### Prerequisites
- macOS Sonoma (14.0+) or macOS Sequoia (15.0+) with Xcode 15+ / 16+ / 27+.
- Target: iPhone running iOS 17.0+.

### Running Unit Tests (Terminal)
Navigate to the `SkyfighterApp` directory and execute:

```bash
cd SkyfighterApp
swift test
```

All 14 unit tests will run and validate:
- Telemetry packet JSON parsing (including null field handling).
- Command input sanitization, deadzones, and throttle safety interlocks.
- Fire hazard multi-sensor evaluation algorithms.
- Mission capability gating and GPS requirement enforcement.
- Stale telemetry detection.

### Building for iOS Simulator (Terminal)
```bash
swift build --triple arm64-apple-ios17.0-simulator
```

### Opening and Installing in Xcode
1. Double-click `Open_In_Xcode.command` or run:
   ```bash
   open SkyfighterApp.xcodeproj
   ```
2. Select your connected **iPhone** (or any iOS Simulator) as the run destination.
3. **Configure Signing**: Under project target **SkyfighterApp** > **Signing & Capabilities**, select your **Personal Team** (free Apple ID).
4. Press **Cmd + R** to install and run the app on your iPhone.
5. On your iPhone, enable **Developer Mode** (`Settings > Privacy & Security > Developer Mode`) and trust your developer certificate (`Settings > General > VPN & Device Management`).

---

## 4. ESP32 Gateway Integration Guide

The companion ESP32 firmware should host a WebSocket endpoint at `ws://192.168.4.1:8080/telemetry`:

1. ESP32 #2 configures a SoftAP:
   ```cpp
   WiFi.softAP("SKYFIGHTER_GATEWAY", "password123");
   ```
2. Accepts incoming WebSocket connections on port `8080`.
3. Streams JSON telemetry packets matching the schema in `PROTOCOL.md` at 2–5 Hz.
4. Forwards validated incoming commands to ESP32 #1 over UART.

---

## 5. Safety & Disclaimers

> [!WARNING]
> This application is ground control software for an experimental aircraft. Software safety interlocks instruct the drone over Wi-Fi, but physical motor shutdown, PID stabilization, and emergency failsafes **must be implemented onboard the flight controller (ESP32 #1)**. Never arm the aircraft indoors or near personnel.
