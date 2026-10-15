# SKYFIGHTER Drone Telemetry & Command Protocol (v1.1)

This specification defines the cross-platform communication protocol between Ground Control Stations (iPhone, Android, macOS, Windows, Laptop Browser PWA) and the Drone Gateway.

---

## 1. Network Topology & Trust Boundaries

```
+---------------------------------------------------------------------------------+
|                         Ground Control Stations (GCS)                           |
|       PWA (Web / iOS Safari / Android Chrome / Windows / Mac Desktop)           |
|                 Native iOS App (SwiftUI / Personal Team Build)                  |
+---------------------------------------------------------------------------------+
                                       |
                                       | Wi-Fi (WebSocket `ws://192.168.4.1:8080/telemetry`)
                                       | Max packet size: 4096 bytes
                                       v
+---------------------------------------------------------------------------------+
|                    ESP32 #2: Communication Gateway Module                       |
|         - SoftAP / Local Wi-Fi (SSID: SKYFIGHTER_GATEWAY, 192.168.4.1)          |
|         - WebSocket Server (Port 8080)                                          |
|         - Client Control Lease Manager (single active pilot lease token)        |
|         - Schema validation & Rate-Limiting enforcement (20 Hz commands)        |
|         - Packet framing & checksum over UART                                   |
+---------------------------------------------------------------------------------+
                                       |
                                       | Hardware UART (115200 Baud, Non-blocking)
                                       v
+---------------------------------------------------------------------------------+
|                    ESP32 #1: Flight & Sensor Controller                         |
|         - Environmental Sensors: DHT11 (GPIO4), MQ-2 (GPIO34), Flame (GPIO27)   |
|         - Navigation: NEO-6M GPS (UART2 GPIO16/17), MPU6050 IMU (I2C 0x68)      |
|         - Emergency Buzzer (GPIO26)                                             |
|         - Independent Hardware Failsafe (triggers if UART quiet >500 ms)        |
|         - 4x ESC Outputs (GPIO 25, 26, 27, 32) -> [LOCKED IN INITIAL RELEASE]   |
+---------------------------------------------------------------------------------+
```

---

## 2. Telemetry Packet Schema (Drone -> GCS)

- **Transport**: WebSocket / TCP (`ws://192.168.4.1:8080/telemetry`)
- **Cadence**: 2 Hz to 5 Hz (default 2 Hz for low bandwidth)
- **Max Packet Size**: 4096 bytes
- **Null Safety**: Any uncalibrated, disconnected, or unwired sensor value **MUST be `null`**, never `0` or `0.0`. `0.0` represents a true measured zero (e.g., 0°C or level roll).

### Schema (JSON Example)
```json
{
  "version": 1,
  "type": "telemetry",
  "sequence": 420,
  "timestamp_ms": 1718000000120,
  "connection": "connected",
  "flight": {
    "mode": "disarmed",
    "armed": false,
    "capabilities": {
      "manual_control": false,
      "autonomous_navigation": false,
      "return_to_home": false,
      "thermal_camera": false,
      "rgb_camera": true,
      "buzzer": true,
      "simulation_mode": true
    }
  },
  "sensors": {
    "temperature_c": 27.8,
    "humidity_pct": 53.4,
    "mq2_adc": 480,
    "flame_detected": false,
    "mpu_connected": true,
    "mpu_temperature_c": 31.5
  },
  "gps": {
    "valid": true,
    "latitude": 12.971598,
    "longitude": 77.594562,
    "satellites": 9,
    "altitude_m": 24.3
  },
  "battery": {
    "voltage_v": null,
    "percentage": null
  },
  "alerts": [
    {
      "code": "BASELINE_OK",
      "severity": "info",
      "source": "MQ-2",
      "message": "Smoke baseline sensor calibrated.",
      "timestamp_ms": 1718000000000
    }
  ],
  "ai_detections": []
}
```

---

## 3. Command Packets (GCS -> Gateway)

All commands require:
1. `version`: `1`
2. `sequence`: Strictly incrementing positive integer.
3. `timestamp_ms`: Current epoch timestamp in milliseconds.
4. `client_id`: Unique GCS identifier holding active control lease.

### 3.1 Control Lease Claim & Heartbeat
Only one GCS can command the drone at any time:
```json
{
  "version": 1,
  "type": "control_claim",
  "sequence": 1,
  "client_id": "gcs-macbook-pro-01",
  "action": "request_lease",
  "timestamp_ms": 1718000000000
}
```
- **Lease Timeout**: 3000 ms. GCS must send heartbeat at least once every 1000 ms to retain lease.

### 3.2 Manual Flight Control Command
Sent at up to **20 Hz** during pilot interaction:
```json
{
  "version": 1,
  "type": "manual_command",
  "sequence": 105,
  "client_id": "gcs-macbook-pro-01",
  "timestamp_ms": 1718000000250,
  "roll": 0.0,
  "pitch": 0.0,
  "yaw": 0.0,
  "throttle": 0.0
}
```
- `roll`, `pitch`, `yaw`: Clamped between `-1.0` and `1.0`. Deadzone default `0.05`.
- `throttle`: Clamped between `0.0` and `1.0`. **Forced to `0.0` whenever drone is disarmed**.

### 3.3 Arm / Disarm Command
Requires explicit security confirmation token:
```json
{
  "version": 1,
  "type": "arm_command",
  "sequence": 106,
  "client_id": "gcs-macbook-pro-01",
  "timestamp_ms": 1718000000300,
  "arm": true,
  "confirmation_token": "PILOT-ARM-CONFIRM-9821"
}
```

### 3.4 Emergency Stop Command
Prioritized motor shutdown directive:
```json
{
  "version": 1,
  "type": "emergency_stop",
  "sequence": 107,
  "client_id": "gcs-macbook-pro-01",
  "timestamp_ms": 1718000000350
}
```

---

## 4. Command Acknowledgements (`ack`)

The Gateway responds to commands with an explicit acknowledgment packet:
```json
{
  "version": 1,
  "type": "ack",
  "sequence": 105,
  "status": "accepted",
  "code": "OK",
  "message": "Manual command routed to flight controller.",
  "timestamp_ms": 1718000000255
}
```
Status values:
- `accepted`: Command validated and forwarded over UART to ESP32 #1.
- `rejected`: Command rejected (reasons: `NOT_LEASE_OWNER`, `DISARMED_THROTTLE_LOCK`, `RATE_LIMIT_EXCEEDED`, `OUT_OF_ORDER_SEQUENCE`).
- `executed`: Verified completed by flight controller.

---

## 5. Security & Safety Rules

1. **Independent Onboard Failsafe**:
   - ESP32 #1 must never rely on continuous Wi-Fi. If UART commands cease for >500 ms while armed, ESP32 #1 must autonomously land or cut motors.
2. **Stale Telemetry Classification**:
   - `> 2500 ms`: Flagged `STALE_DATA` warning in UI.
   - `> 5000 ms`: Transitioned to `COMMUNICATION_LOST` critical alert state.
3. **No Fabricated Telemetry**:
   - If GPS fix is invalid, `latitude` and `longitude` are null and UI displays "NO GPS FIX".
   - Battery voltage displays "UNAVAILABLE" until hardware voltage divider is connected.
4. **Simulation Mode Transparency**:
   - Any simulated data is marked `flight.capabilities.simulation_mode = true` and clearly labeled "SIMULATION" across all UI screens.
