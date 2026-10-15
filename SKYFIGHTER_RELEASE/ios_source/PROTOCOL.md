# SKYFIGHTER Drone Telemetry & Command Protocol (v1.0)

This document specifies the bidirectional communication protocol between the **SKYFIGHTER iPhone Ground Control Station (GCS)** and the **ESP32 #2 Communication Gateway**.

---

## 1. Physical & Network Topology

```
+-----------------------------------------------------------+
|                   iPhone Application                      |
|                (SwiftUI / SkyfighterApp)                  |
+-----------------------------------------------------------+
                             |
                             | Wi-Fi (WebSocket or TCP Socket)
                             v
+-----------------------------------------------------------+
|              ESP32 #Dev Module #2 (Gateway)               |
|      - SoftAP / Local Wi-Fi (Default IP: 192.168.4.1)     |
|      - JSON validation & command rate enforcement         |
+-----------------------------------------------------------+
                             |
                             | Hardware UART (TX/RX, 115200 Baud)
                             v
+-----------------------------------------------------------+
|           ESP32 #Dev Module #1 (Flight & Sensors)         |
|      - Environmental Sensing (MQ-2, DHT11, Flame)         |
|      - Navigation (NEO-6M GPS, MPU6050 IMU)               |
|      - Safety: Autonomous failsafe, buzzer trigger        |
|      - Motor outputs: 4x ESCs / A2212 1000KV (Planned)    |
+-----------------------------------------------------------+
```

---

## 2. Telemetry Packet Schema (ESP32 -> iPhone)

Telemetry is streamed periodically (recommended: 2 Hz to 5 Hz).

> **Rule on Values**: All absent or unmeasured numeric properties **MUST be sent as `null`**, never `0` or `0.0`. `0.0` represents a true zero reading (e.g., 0°C or zero throttle), whereas `null` informs the application that the sensor is offline or uncalibrated.

### Example Telemetry Packet (JSON):

```json
{
  "version": 1,
  "type": "telemetry",
  "timestamp_ms": 1718000000120,
  "connection": "connected",
  "flight": {
    "mode": "disarmed",
    "armed": false,
    "capabilities": {
      "manual_control": false,
      "autonomous_navigation": false,
      "return_to_home": false
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
  ]
}
```

### Capability Flags
The iPhone app checks the `capabilities` dictionary before enabling controls:
- `manual_control`: Set `true` only when ESP32 #1 has verified motor mixing and accepts pitch/roll/yaw/throttle commands.
- `autonomous_navigation`: Set `true` only when onboard autopilot waypoints can be navigated safely. If `false`, the app locks out autonomous mission launches.
- `return_to_home`: Set `true` only when home coordinates are recorded and autonomous RTH trajectory generation is available.

---

## 3. Command Packet Schemas (iPhone -> ESP32)

All commands include:
1. `version`: Protocol version (`1`).
2. `sequence`: Strictly incrementing unsigned 64-bit counter to detect lost or out-of-order packets.
3. `timestamp_ms`: Timestamp generated at transmission for latency and freshness auditing.

### 3.1 Manual Flight Command
Sent at up to **20 Hz** during active pilot stick input:

```json
{
  "version": 1,
  "type": "manual_command",
  "sequence": 1042,
  "timestamp_ms": 1718000000250,
  "roll": 0.0,
  "pitch": 0.0,
  "yaw": 0.0,
  "throttle": 0.0
}
```

- `roll`: `-1.0` (full left roll) to `1.0` (full right roll). `0.0` = neutral level.
- `pitch`: `-1.0` (full pitch down / forward) to `1.0` (full pitch up / back). `0.0` = neutral level.
- `yaw`: `-1.0` (full counter-clockwise) to `1.0` (full clockwise). `0.0` = neutral.
- `throttle`: `0.0` (idle / motors off) to `1.0` (maximum thrust).

### 3.2 Arm / Disarm Command
Requires explicit confirmation token to prevent accidental triggering:

```json
{
  "version": 1,
  "type": "arm_command",
  "sequence": 1043,
  "timestamp_ms": 1718000000500,
  "arm": true,
  "confirmation_token": "a1b2c3d4-e5f6-7890"
}
```

### 3.3 Emergency Stop Command
Prioritized command instructing immediate motor shutdown:

```json
{
  "version": 1,
  "type": "emergency_stop",
  "sequence": 1044,
  "timestamp_ms": 1718000000550
}
```

---

## 4. Connection & Safety Rules

1. **Heartbeat & Telemetry Freshness**:
   - The iPhone app marks telemetry **stale** if no update is received for **>2.5 seconds**.
   - If telemetry is not received for **>5.0 seconds**, the app transitions to `Connection Lost`.
2. **Onboard Failsafe Autonomy**:
   - ESP32 #1 **MUST NOT** rely on the iPhone staying connected to keep the aircraft safe.
   - If UART link from ESP32 #2 stops sending commands for >500 ms while armed, ESP32 #1 must independently enter onboard failsafe (hover, return, or controlled descent).
3. **Disarm Throttle Lock**:
   - While disarmed, `throttle` is strictly enforced to `0.0` by the application validator.
