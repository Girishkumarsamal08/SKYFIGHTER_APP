# SKYFIGHTER Changelog

All notable changes to this project will be documented in this file.

## [1.1.0] - 2026-10-15
### Added
- **Cross-Platform Progressive Web App (PWA)**:
  - 10 full-featured screens: Dashboard, RGB Live Cam, Thermal Radiometric Cam, Tactical Wildfire GPS Map, Fire Alerts & Incident Triage, Simulation Flight Controls, Sensor Diagnostics, Connection & Gateway Settings, Event History Audit Log, and About & Installation Help.
  - Offline Service Worker caching (`sw.js`) and PWA webmanifest (`manifest.webmanifest`).
  - High-resolution brand icons (16x16 up to 512x512) and Apple Touch Icon generated from `SkyFighter.png`.
- **Dual-ESP32 Gateway Architecture (v1.1)**:
  - ESP32 #2 Communication Gateway firmware (`firmware/esp32_gateway/esp32_gateway.ino`) hosting SoftAP and WebSockets server on port 8080.
  - Exclusive pilot control lease manager to prevent multi-client commanding contention.
  - 20 Hz command rate limiting and packet-size limits (4096 bytes).
- **Sensor Controller Integration**:
  - ESP32 #1 sensor firmware (`firmware/esp32_sensor_controller/esp32_sensor_controller.ino`) streaming structured JSON telemetry matching Protocol v1.1.
  - Independent hardware failsafe that autonomously disarms and sounds alert buzzer if commands cease for >500 ms while armed.
- **Python 6-DOF Flight Simulation**:
  - Realistic quadcopter physics simulator with altitude, velocity, and attitude equations (`simulation/flight_sim.py`).
  - WebSocket gateway simulation server (`simulation/server.py`).
- **Edge AI Fire & Smoke Detection**:
  - Multi-frame confirmation state machine (`potential` -> `repeated` -> `human_verified`).
  - Radiometric thermal pyrometry and false-color canvas simulation.
- **Platform Packaging**:
  - Native macOS standalone app bundle (`macos/SKYFIGHTER.app` and `macos/SKYFIGHTER_macOS.zip`).
  - Standalone Windows desktop launcher package (`windows/SKYFIGHTER_Windows.zip`).
  - Complete Android Gradle project (`android/`) with self-signing documentation.
  - Native SwiftUI iOS source code (`ios_source/`) with 14 passing unit tests.

### Changed
- Refactored `PROTOCOL.md` to specification v1.1 with explicit schemas for telemetry, commands, acknowledgments, and control leases.
- Sensor absent values strictly enforced as `null` instead of `0.0`.
- Battery voltage honestly reported as unavailable until physical voltage divider is installed.

### Security
- Disarmed throttle safety interlock: throttle is forced to 0.0 whenever drone is disarmed.
- Preflight arming checklist and slide-to-arm gesture with verification token generation.
- Universal Emergency Stop motor cut directives.
