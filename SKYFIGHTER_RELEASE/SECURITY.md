# SKYFIGHTER Security & Failsafe Architecture

This document specifies the security principles, cryptographic boundaries, and safety interlocks governing SKYFIGHTER.

---

## 1. Safety Interlocks & Hardware Guardrails

### 1.1 Disarmed Throttle Lockout
- Whenever the drone is in `disarmed` mode, the software validator strictly forces `throttle = 0.0`.
- Cyclic stick inputs (roll, pitch, yaw) are accepted for bench diagnostics, but collective throttle commands cannot be transmitted until the slide-to-arm security flow is completed.

### 1.2 Two-Step Slide-to-Arm Gesture & Verification Token
- Arming commands require an explicit confirmation token generated at arm time (e.g. `PILOT-ARM-CONFIRM-XXXX`).
- Accidental taps or background browser events cannot arm the aircraft without explicit pilot gesture confirmation.

### 1.3 Exclusive Client Control Lease
- To prevent competing pilots or multiple connected browsers from commanding the drone simultaneously, ESP32 #2 enforces an exclusive control lease:
  - Only the client holding the active lease token can issue manual flight commands.
  - The lease expires after 3.0 seconds if heartbeat packets cease.
  - Secondary clients are restricted to read-only telemetry monitoring.

### 1.4 Rate Limiting & Sequence Monotonicity
- Manual flight commands are rate-limited to a maximum of **20 Hz**.
- Packets arriving with out-of-order or duplicate sequence numbers are rejected (`OUT_OF_ORDER_SEQUENCE`).
- Maximum incoming packet size is capped at **4096 bytes** to prevent memory exhaustion on embedded microcontrollers.

### 1.5 Independent Flight Controller Failsafe
- The flight controller (ESP32 #1) **MUST NOT** rely on the GCS or Wi-Fi staying connected.
- If the UART serial link stops receiving commands for **> 500 ms while armed**, ESP32 #1 autonomously executes failsafe motor shutdown.

---

## 2. Credential & Secret Management

- **Zero Hardcoded Secrets**: No private API keys, developer signing certificates, private SSH keys, or production Wi-Fi passwords are stored in this repository.
- **Default SoftAP Credentials**: The default gateway SSID is `SKYFIGHTER_GATEWAY` with default password `password123`. Pilots operating in sensitive environments should change these in `firmware/esp32_gateway/esp32_gateway.ino`.

---

## 3. Reporting a Vulnerability

If you discover a security vulnerability or flight-safety bug in SKYFIGHTER:
1. Please do not open a public issue with exploit instructions.
2. Submit your technical report with reproduction steps to the project maintainers.
3. Vulnerabilities affecting motor shutdown or failsafes are triaged with highest priority.
