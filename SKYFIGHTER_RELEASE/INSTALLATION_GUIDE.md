# SKYFIGHTER Installation & Platform Deployment Guide

This guide provides complete instructions for installing SKYFIGHTER on every major operating system without paying developer store fees.

---

## 1. iPhone and iPad (Safari PWA)

Apple does not permit direct double-click installation of `.ipa` or `.zip` files on iOS devices without developer provisioning. SKYFIGHTER uses the standard **Progressive Web App (PWA)** standard supported directly in Safari.

### Step-by-Step Instructions:
1. Connect your iPhone to the drone's Wi-Fi network:
   - **SSID**: `SKYFIGHTER_GATEWAY`
   - **Password**: `password123`
2. Open **Safari** on your iPhone or iPad.
3. In the address bar, enter the local gateway URL (e.g. `http://192.168.4.1` or your hosted URL).
4. Tap the **Share** button (the square with an upward pointing arrow) in the Safari toolbar.
5. Scroll down through the actions and select **"Add to Home Screen"**.
6. The app name will display as `SKYFIGHTER` with the custom ember drone icon. Tap **Add** in the top right corner.
7. Return to your Home Screen and tap the **SKYFIGHTER** icon.
8. The app launches in full-screen standalone mode with no browser URL bar or Safari tabs.

---

## 2. Android Phones and Tablets (Chrome PWA or Sideload APK)

### Method A: Chrome Progressive Web App (Instant / Zero-Install)
1. Connect your Android device to `SKYFIGHTER_GATEWAY`.
2. Open **Google Chrome**.
3. Navigate to the application URL.
4. Tap the Chrome menu button (three vertical dots `⋮`) in the top right corner.
5. Tap **"Install app"** or **"Add to Home screen"**.
6. Tap **Install** on the prompt. SKYFIGHTER will be added to your Android application drawer.

### Method B: Sideloading Native Android APK
1. Transfer the `skyfighter-v1.1.apk` file to your phone's storage.
2. Open your phone's **Settings > Security & Privacy > Install unknown apps**.
3. Select your File Manager or browser and toggle on **"Allow from this source"**.
4. Tap the APK file and tap **Install**.
5. When prompted by Google Play Protect ("Unrecognized app"), tap **"Install anyway"** (the app is self-signed).

---

## 3. Windows 10 and 11 Desktop / Laptop

### Running Portable Desktop Package:
1. Extract `SKYFIGHTER_Windows.zip`.
2. Open the extracted folder and navigate to `launchers\`.
3. Double-click `Start-SKYFIGHTER.bat`.
4. The application opens in its own standalone, frameless desktop window using Microsoft Edge / Chrome in `--app` mode.
5. You can right-click `Start-SKYFIGHTER.bat` > **Send to > Desktop (create shortcut)** to create a desktop shortcut.

---

## 4. macOS MacBooks & Desktops

### Installing Native Standalone macOS App:
1. Extract `SKYFIGHTER_macOS.zip`.
2. Drag `SKYFIGHTER.app` into your **Applications** folder.
3. **Bypassing macOS Gatekeeper for Self-Built Binaries**:
   Because SKYFIGHTER is an open-source tool built without an expensive Apple Developer Notarization subscription, macOS will show a warning on first launch.
   - **Option 1**: Right-click (or Control-click) `SKYFIGHTER.app` in Finder, choose **Open**, and click **Open** on the confirmation dialog.
   - **Option 2 (Terminal)**: Run:
     ```bash
     xattr -cr /Applications/SKYFIGHTER.app
     ```
4. Double-click `SKYFIGHTER.app` to launch in dedicated WKWebView desktop mode.

### Alternative Safari Web App on macOS Sonoma / Sequoia:
1. Open the application in **Safari**.
2. Click **File > Add to Dock...** in the top menu bar.
3. Click **Add**. The app will be pinned to your macOS Dock and run in its own window.

---

## 5. Offline Operation & Connectivity Matrix

| Feature | Offline (No Internet / Drone Wi-Fi Only) | Internet Connected |
| :--- | :--- | :--- |
| **GCS Interface & HUD** | **YES** (Cached by Service Worker) | **YES** |
| **Live Telemetry & Alerts** | **YES** (Via local ESP32 SoftAP) | **YES** |
| **Simulation Mode & Controls** | **YES** (Runs 100% locally on device) | **YES** |
| **Sensor Diagnostics** | **YES** (Direct hardware bus readings) | **YES** |
| **Tactical Map (Vector)** | **YES** (Local canvas vector grid) | **YES** |
| **Online Satellite Tiles** | Cached tiles only (Pre-caching recommended) | Full resolution live tiles |
