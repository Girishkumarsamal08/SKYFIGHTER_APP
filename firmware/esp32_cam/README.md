# SKYFIGHTER DRONE VISION — ESP32-CAM (AI-THINKER) FIRMWARE

## 1. Hardware Architecture & Isolation Mandate

```
+------------------------------------+           +---------------------------------+
|  DRONE POWER DISTRIBUTION (PDB)    |           |  ESP32-S3 FLIGHT CONTROLLER     |
|  3S LiPo -> 5V 2A BEC Buck Conv.   |           |  Runs ESP-FC Firmware (v0.2.1)  |
+-----------------+------------------+           |  Attitude Loop / Motor Mixing   |
                  | 5V Power Only                +---------------------------------+
                  v                                      | (Isolated - NO wires)
+------------------------------------+                   v
|  AI-THINKER ESP32-CAM (OV2640 2MP) |          [NO DIRECT WIRES TO FC]
|  - Streams 640x480 VGA @ 25-30 FPS |                   |
|  - 2.4 GHz Wi-Fi MJPEG Protocol    |                   |
+-----------------+------------------+                   |
                  |                                      |
                  | Wireless 2.4 GHz Wi-Fi Stream        |
                  v                                      v
+----------------------------------------------------------------------------------+
|  GROUND CONTROL STATION (LAPTOP)                                                 |
|  - Python FastAPI Backend (YOLO Detection Engine)                                |
|  - SKYFIGHTER Web Dashboard (PWA)                                                |
+----------------------------------------------------------------------------------+
```

> [!IMPORTANT]
> **CRITICAL HARDWARE ISOLATION RULE:**
> Do **NOT** connect the ESP32-CAM or OV2640 pins to the ESP32-S3 flight controller.
> - The flight controller runs ESP-FC firmware to stabilize the drone.
> - The ESP32-CAM is powered independently via 5V and streams video wirelessly over Wi-Fi.

---

## 2. FTDI Flashing Wiring Diagram

To flash the ESP32-CAM using a USB-to-UART FTDI programmer:

| FTDI Adapter Pin | ESP32-CAM Pin | Purpose |
| :--- | :--- | :--- |
| **VCC (5V)** | **5V** | Power (ESP32-CAM needs clean 5V, not 3.3V) |
| **GND** | **GND** | Common Ground |
| **TXD** | **U0R (GPIO 3)** | Serial RX |
| **RXD** | **U0T (GPIO 1)** | Serial TX |
| **GND** | **GPIO 0** | **Jumpered during flashing only** |

*Note: Bridge GPIO 0 to GND while pressing the Reset button to put ESP32 into bootloader mode. Disconnect GPIO 0 from GND after flashing and press Reset once to boot.*

---

## 3. Arduino IDE Board Configuration

1. Install ESP32 board definitions in Arduino IDE: `esp32 by Espressif Systems` (v2.0.x or v3.0.x).
2. Go to **Tools** and select:
   - **Board**: `AI Thinker ESP32-CAM`
   - **CPU Frequency**: `240MHz (WiFi/BT)`
   - **Flash Frequency**: `80MHz`
   - **Flash Mode**: `QIO`
   - **Partition Scheme**: `Huge APP (3MB No OTA/1MB SPIFFS)`
   - **Core Debug Level**: `None`
   - **PSRAM**: `Enabled` (Crucial for dual frame buffers)
3. Open `esp32_cam.ino`.
4. Update `WIFI_SSID` and `WIFI_PASS` with your router or mobile hotspot credentials.
5. Click **Upload**.

---

## 4. API Endpoints Provided by ESP32-CAM

| Endpoint | Method | Format | Description |
| :--- | :--- | :--- | :--- |
| `/stream` | GET | `multipart/x-mixed-replace` | Real-time low-latency MJPEG video feed |
| `/status` | GET | `application/json` | Hardware diagnostics (heap, RSSI, framesize, uptime) |
| `/capture`| GET | `image/jpeg` | High-resolution single still image capture |
| `/control`| GET | Plain Text / OK | Adjust `framesize` (e.g. 7=VGA, 5=QVGA), `quality`, `flash` |
| `/` | GET | `text/html` | Onboard status and diagnostics page |
