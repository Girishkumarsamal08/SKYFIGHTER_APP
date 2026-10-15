# SKYFIGHTER for Windows Desktop

This package provides direct, zero-install distribution for Windows 10 and 11 laptops and desktops.

## How to Run
1. Unzip `SKYFIGHTER_Windows.zip`.
2. Double-click `launchers\Start-SKYFIGHTER.bat`.
3. The application will launch in its own standalone, frameless desktop window using Microsoft Edge / WebView2.

## Connecting to Drone Hardware
1. On your Windows machine, open Wi-Fi settings.
2. Connect to the drone gateway SSID: `SKYFIGHTER_GATEWAY` (Password: `password123`).
3. In SKYFIGHTER, navigate to **Connection** and verify the WebSocket URL is set to:
   `ws://192.168.4.1:8080/telemetry`
4. Click **Connect to Gateway**.

## Native C# / C++ WebView2 Compilation
To compile a native standalone Windows PE binary (`SKYFIGHTER.exe`) using Visual Studio:
1. Open Visual Studio 2022 on a Windows machine.
2. Create a C# WPF (.NET 8.0) project with `Microsoft.Web.WebView2`.
3. Set the WebView2 `Source` to the bundled `web\index.html`.
4. Publish as single-file self-contained executable:
   ```cmd
   dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true
   ```
