# SKYFIGHTER Privacy Policy & Data Handling

**Last Updated:** October 15, 2026

SKYFIGHTER is designed for emergency search, rescue, and wildfire monitoring by first responders and volunteer organizations. We believe in absolute telemetry privacy and data sovereignty.

---

## 1. Zero Cloud Exfiltration
- **No Remote Telemetry Transmission**: SKYFIGHTER does not transmit drone GPS coordinates, sensor telemetry, video frames, thermal imaging, or device identifiers to any external cloud server or third-party tracking service.
- **Local Network Only**: All communication between the Ground Control Station (GCS) and the drone operates solely over the local Wi-Fi link (`SKYFIGHTER_GATEWAY`) or local simulation loop.
- **No Analytics / No Telemetry SDKs**: The application contains zero third-party analytics trackers, cookies, advertising SDKs, or behavioral profiling tools.

---

## 2. On-Device Storage
- **Mission Event Logs**: Logs exported from the Event History screen are generated locally as standard CSV or JSON files and saved directly onto your device storage.
- **PWA Caching**: Application code and static assets are cached locally on your device via standard browser Cache Storage API to enable offline operation. No personal data is stored in the cache.

---

## 3. Location & Camera Permissions
- **GPS Location**: On-device GPS location is used solely to calculate distance and bearing to the drone and to establish the pilot's "Home Base" coordinate. It is never transmitted outside your local device.
- **Camera Stream**: Video streams from the drone payload are rendered directly to HTML5 canvas memory. Screenshots are saved only when you click "Capture Snapshot".

---

## 4. Open-Source Transparency
The entire SKYFIGHTER codebase across firmware, web frontend, Python simulation, and native apps is open-source. You can inspect all networking and transport calls in `shared/protocol/protocol.js` and `web/app.js`.
