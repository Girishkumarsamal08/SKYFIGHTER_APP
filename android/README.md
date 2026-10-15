# SKYFIGHTER Android Application Project

This folder contains the complete, standalone Android native wrapper project for the SKYFIGHTER UAV Ground Control Station.

## Package Metadata
- **Application ID**: `com.skyfighter.gcs`
- **Version**: 1.1.0 (VersionCode 2)
- **Min SDK**: API 26 (Android 8.0 Oreo)
- **Target SDK**: API 34 (Android 14)
- **Permissions**: `INTERNET`, `ACCESS_FINE_LOCATION`, `ACCESS_WIFI_STATE`, `CHANGE_WIFI_STATE`

## Toolchain Status on Build System
> [!NOTE]
> The current host machine running macOS does not have a Java Runtime Environment (JDK) or Android SDK installed. Therefore, a compiled `.apk` binary was not pre-generated in this workspace directory. The complete source tree and assets are fully provided here.

## How to Build the Signed APK (Zero Developer Fee)
On any computer with Java 17+ and the Android SDK / Android Studio installed:

1. Open this `android/` directory in **Android Studio** or terminal.
2. Build unsigned release APK:
   ```bash
   ./gradlew assembleRelease
   ```
3. Generate a free personal self-signing keystore (valid for 25 years):
   ```bash
   keytool -genkey -v -keystore skyfighter-release.keystore -alias skyfighter -keyalg RSA -keysize 2048 -validity 10000
   ```
4. Sign the APK using `apksigner`:
   ```bash
   apksigner sign --ks skyfighter-release.keystore --out skyfighter-v1.1.apk app/build/outputs/apk/release/app-release-unsigned.apk
   ```

## Sideloading onto Android Devices
1. Transfer `skyfighter-v1.1.apk` to your Android device via USB, email, or Google Drive.
2. In Android Settings, navigate to **Apps > Special app access > Install unknown apps** and enable permission for your file manager or browser.
3. Tap `skyfighter-v1.1.apk` and tap **Install**.
4. Launch **SKYFIGHTER** from your app drawer.

## Zero-Install Alternative: Progressive Web App (PWA)
You do NOT even need to build or sideload an APK to use SKYFIGHTER on Android!
1. Open the hosted or local SKYFIGHTER URL in **Google Chrome** on your Android phone.
2. Tap the Chrome menu (three dots) > **"Install app"** or **"Add to Home screen"**.
3. It installs immediately with the exact same capabilities, offline caching, and fullscreen HUD!
