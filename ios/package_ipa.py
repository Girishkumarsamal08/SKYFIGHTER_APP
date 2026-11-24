#!/usr/bin/env python3
import os
import shutil
import zipfile

def build_ipa():
    ios_dir = os.path.dirname(os.path.abspath(__file__))
    app_root = os.path.dirname(ios_dir)
    web_dir = os.path.join(app_root, "dist", "web")
    build_dir = os.path.join(ios_dir, "build")
    payload_dir = os.path.join(build_dir, "Payload")
    app_bundle = os.path.join(payload_dir, "SKYFIGHTER.app")

    if os.path.exists(build_dir):
        shutil.rmtree(build_dir)
    os.makedirs(app_bundle, exist_ok=True)

    # 1. Info.plist
    info_plist_content = """<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDevelopmentRegion</key>
    <string>en</string>
    <key>CFBundleDisplayName</key>
    <string>SKYFIGHTER</string>
    <key>CFBundleExecutable</key>
    <string>SKYFIGHTER</string>
    <key>CFBundleIdentifier</key>
    <string>com.skyfighter.gcs</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleName</key>
    <string>SKYFIGHTER</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>2.0.0</string>
    <key>CFBundleVersion</key>
    <string>2</string>
    <key>LSRequiresIPhoneOS</key>
    <true/>
    <key>UIDeviceFamily</key>
    <array>
        <integer>1</integer>
        <integer>2</integer>
    </array>
    <key>UIRequiredDeviceCapabilities</key>
    <array>
        <string>arm64</string>
        <string>wifi</string>
    </array>
    <key>UISupportedInterfaceOrientations</key>
    <array>
        <string>UIInterfaceOrientationPortrait</string>
        <string>UIInterfaceOrientationLandscapeLeft</string>
        <string>UIInterfaceOrientationLandscapeRight</string>
    </array>
    <key>UISupportedInterfaceOrientations~ipad</key>
    <array>
        <string>UIInterfaceOrientationPortrait</string>
        <string>UIInterfaceOrientationPortraitUpsideDown</string>
        <string>UIInterfaceOrientationLandscapeLeft</string>
        <string>UIInterfaceOrientationLandscapeRight</string>
    </array>
    <key>UIRequiresFullScreen</key>
    <true/>
    <key>NSAppTransportSecurity</key>
    <dict>
        <key>NSAllowsArbitraryLoads</key>
        <true/>
    </dict>
    <key>NSCameraUsageDescription</key>
    <string>Live drone streaming and optical AI verification</string>
    <key>NSLocationWhenInUseUsageDescription</key>
    <string>Displaying pilot ground station coordinates on the tactical fire map</string>
</dict>
</plist>
"""
    with open(os.path.join(app_bundle, "Info.plist"), "w") as f:
        f.write(info_plist_content)

    # 2. Executable launcher stub
    executable_path = os.path.join(app_bundle, "SKYFIGHTER")
    with open(executable_path, "wb") as f:
        # Standard iOS Mach-O header stub
        f.write(b"\xcf\xfa\xed\xfe\x0c\x00\x00\x01\x00\x00\x00\x00\x02\x00\x00\x00")
        f.write(b"SKYFIGHTER_IOS_NATIVE_PWA_WRAPPER_V2\x00" * 64)
    os.chmod(executable_path, 0o755)

    # 3. Mobile Provision placeholder
    with open(os.path.join(app_bundle, "embedded.mobileprovision"), "w") as f:
        f.write("SKYFIGHTER_OPEN_DISTRIBUTION_FREE_DEVELOPER_PROVISIONING_PROFILE")

    # 4. Copy Web Assets
    web_dest = os.path.join(app_bundle, "web")
    os.makedirs(web_dest, exist_ok=True)
    for fname in ["index.html", "app.js", "style.css", "protocol.js", "sw.js", "manifest.webmanifest"]:
        src = os.path.join(web_dir, fname)
        if os.path.exists(src):
            shutil.copy2(src, os.path.join(web_dest, fname))

    icons_src = os.path.join(web_dir, "icons")
    if os.path.exists(icons_src):
        icons_dest = os.path.join(web_dest, "icons")
        shutil.copytree(icons_src, icons_dest, dirs_exist_ok=True)
        # Copy root icons for iOS springboard
        icon_512 = os.path.join(icons_src, "icon-512.png")
        if os.path.exists(icon_512):
            shutil.copy2(icon_512, os.path.join(app_bundle, "AppIcon.png"))
            shutil.copy2(icon_512, os.path.join(app_bundle, "AppIcon60x60@2x.png"))
            shutil.copy2(icon_512, os.path.join(app_bundle, "AppIcon76x76@2x.png"))
            shutil.copy2(icon_512, os.path.join(build_dir, "iTunesArtwork"))

    # 5. iTunesMetadata.plist
    metadata_plist = """<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>bundleDisplayName</key>
    <string>SKYFIGHTER</string>
    <key>bundleIdentifier</key>
    <string>com.skyfighter.gcs</string>
    <key>itemName</key>
    <string>SKYFIGHTER Tactical UAV GCS</string>
    <key>kind</key>
    <string>software</string>
    <key>softwareVersionBundleId</key>
    <string>com.skyfighter.gcs</string>
    <key>softwareVersionExternalIdentifier</key>
    <integer>85029103</integer>
</dict>
</plist>
"""
    with open(os.path.join(build_dir, "iTunesMetadata.plist"), "w") as f:
        f.write(metadata_plist)

    # 6. Zip into skyfighter.ipa
    ipa_out = os.path.join(ios_dir, "skyfighter.ipa")
    with zipfile.ZipFile(ipa_out, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(payload_dir):
            for file in files:
                full_path = os.path.join(root, file)
                rel_path = os.path.relpath(full_path, build_dir)
                zf.write(full_path, rel_path)
        if os.path.exists(os.path.join(build_dir, "iTunesMetadata.plist")):
            zf.write(os.path.join(build_dir, "iTunesMetadata.plist"), "iTunesMetadata.plist")
        if os.path.exists(os.path.join(build_dir, "iTunesArtwork")):
            zf.write(os.path.join(build_dir, "iTunesArtwork"), "iTunesArtwork")

    print(f"[SUCCESS] skyfighter.ipa created: {ipa_out} ({os.path.getsize(ipa_out)} bytes)")
    return ipa_out

if __name__ == "__main__":
    build_ipa()
