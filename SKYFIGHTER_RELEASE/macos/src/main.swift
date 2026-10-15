import Cocoa
import WebKit

class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    var window: NSWindow!
    var webView: WKWebView!

    func applicationDidFinishLaunching(_ notification: Notification) {
        let screenSize = NSScreen.main?.visibleFrame.size ?? CGSize(width: 1280, height: 800)
        let width = min(1280, screenSize.width * 0.9)
        let height = min(820, screenSize.height * 0.9)
        let rect = NSRect(x: (screenSize.width - width) / 2, y: (screenSize.height - height) / 2, width: width, height: height)

        window = NSWindow(
            contentRect: rect,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "SKYFIGHTER Tactical Ground Control Station"
        window.titlebarAppearsTransparent = true
        window.backgroundColor = NSColor(red: 0.03, green: 0.04, blue: 0.06, alpha: 1.0)
        window.isReleasedWhenClosed = false
        window.delegate = self

        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        webView = WKWebView(frame: rect, configuration: config)
        window.contentView = webView

        // Load bundled web app
        let bundle = Bundle.main
        if let resourcePath = bundle.resourcePath {
            let webDir = URL(fileURLWithPath: "\(resourcePath)/web")
            let indexUrl = webDir.appendingPathComponent("index.html")
            if FileManager.default.fileExists(atPath: indexUrl.path) {
                webView.loadFileURL(indexUrl, allowingReadAccessTo: webDir)
            } else {
                // Fallback to local path during dev
                let cwd = FileManager.default.currentDirectoryPath
                let devUrl = URL(fileURLWithPath: "\(cwd)/dist/web/index.html")
                webView.loadFileURL(devUrl, allowingReadAccessTo: URL(fileURLWithPath: "\(cwd)/dist/web"))
            }
        }

        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = AppDelegate()
app.delegate = delegate
app.run()
