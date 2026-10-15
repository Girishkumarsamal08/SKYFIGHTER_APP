# SKYFIGHTER Complete Build Guide

This document describes how to compile, test, and package all subsystems of SKYFIGHTER from source.

---

## 1. Environment & Toolchain Prerequisites

| Target Platform | Required Toolchain | Optional Dependencies |
| :--- | :--- | :--- |
| **Web / PWA** | Node.js 18+ (tested v24), npm | Any static web server |
| **Python Sim & AI** | Python 3.8+ (tested v3.10) | `pip install websockets` |
| **ESP32 Firmware** | Arduino IDE 2.x or PlatformIO | `WebSocketsServer`, `ArduinoJson`, `DHT sensor library` |
| **Native macOS App** | macOS 12+, `swiftc` (Xcode Command Line Tools) | None (uses native Cocoa & WebKit) |
| **Native iOS App** | macOS Sonoma / Sequoia, Xcode 15+ | Free Personal Apple ID |
| **Android APK** | JDK 17+, Android SDK (API 34) | Android Studio |

---

## 2. Building the Web Application (PWA)

```bash
# 1. Generate PWA and favicon icons from master artwork
mkdir -p dist/web/icons dist/web/sounds
sips -z 192 192 SkyFighter.png --out dist/web/icons/icon-192.png
sips -z 512 512 SkyFighter.png --out dist/web/icons/icon-512.png
sips -z 180 180 SkyFighter.png --out dist/web/icons/apple-touch-icon.png
sips -z 64 64 SkyFighter.png --out dist/web/icons/favicon.png

# 2. Copy source assets to distribution directory
cp web/index.html dist/web/
cp web/style.css dist/web/
cp web/app.js dist/web/
cp web/protocol.js dist/web/
cp web/sw.js dist/web/
cp web/manifest.webmanifest dist/web/

# 3. Test locally
python3 -m http.server 8080 --directory dist/web
```

---

## 3. Building Native macOS Application (`SKYFIGHTER.app`)

On macOS:
```bash
# Compile native Swift wrapper into .app bundle
APP="macos/SKYFIGHTER.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/web"

# Compile executable
swiftc macos/src/main.swift -O -framework Cocoa -framework WebKit -o "$APP/Contents/MacOS/SKYFIGHTER"

# Copy web bundle and icon
cp -R dist/web/* "$APP/Contents/Resources/web/"
cp macos/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"

# Package for distribution
cd macos && zip -r -q SKYFIGHTER_macOS.zip SKYFIGHTER.app && cd ..
```

---

## 4. Building Native iOS Application in Xcode (Free Personal Team)

1. Open `ios_source/SkyfighterApp.xcodeproj` in **Xcode**.
2. Connect your iPhone via USB or select any iOS Simulator.
3. Under the **Signing & Capabilities** tab:
   - Check **"Automatically manage signing"**.
   - Under **Team**, select your **Personal Team** (associated with your free Apple ID).
   - Change the Bundle Identifier slightly (e.g. `com.yourname.skyfighter`) to ensure uniqueness.
4. Press **Cmd + R** to compile and install onto your iPhone.
5. On your iPhone:
   - Go to **Settings > General > VPN & Device Management** and tap **Trust [Your Apple ID]**.
   - Go to **Settings > Privacy & Security > Developer Mode** and enable Developer Mode.

---

## 5. Flashing ESP32 Firmware

### A. ESP32 #2 (Communication Gateway)
1. Open `firmware/esp32_gateway/esp32_gateway.ino` in **Arduino IDE**.
2. Select Board: **ESP32 Dev Module**.
3. Install required libraries via Library Manager:
   - `WebSockets` by Markus Sattler
   - `ArduinoJson` by Benoît Blanchon
4. Connect ESP32 #2 via USB and click **Upload**.

### B. ESP32 #1 (Sensor Controller & Flight Bridge)
1. Open `firmware/esp32_sensor_controller/esp32_sensor_controller.ino`.
2. Select Board: **ESP32 Dev Module**.
3. Install required libraries:
   - `DHT sensor library` by Adafruit
   - `ArduinoJson` by Benoît Blanchon
4. Connect ESP32 #1 via USB and click **Upload**.

---

## 6. Running Automated Tests

```bash
# 1. Native Swift Model & Safety Tests
cd SkyfighterApp && swift test && cd ..

# 2. Shared Protocol Engine JS Tests
node shared/protocol/test_protocol.js

# 3. Python Protocol Tests
python3 shared/protocol/test_protocol.py

# 4. Flight Simulator Dynamics Tests
python3 simulation/test_flight_sim.py

# 5. Edge AI Detection Tests
python3 ai/test_ai_detector.py
```
All 39 unit tests should pass with 0 failures.
