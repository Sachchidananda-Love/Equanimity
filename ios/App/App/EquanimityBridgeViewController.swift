import Capacitor
import WebKit

final class EquanimityBridgeViewController: CAPBridgeViewController {
    #if DEBUG
    private var diagnosticTimer: Timer?
    #endif

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        #if DEBUG
        diagnosticTimer?.invalidate()
        // Installed before loadWebView(): diagnostics are independent of Vite's
        // build mode and never require changing Firebase/HealthKit configuration.
        webView?.configuration.userContentController.addUserScript(WKUserScript(
            source: "window.__EQUANIMITY_DEVELOPMENT_TOOLS__ = true; window.__EQUANIMITY_LIFECYCLE_DEBUG__ = true; window.__EQUANIMITY_LIFECYCLE_START__ = performance.now();",
            injectionTime: .atDocumentStart, forMainFrameOnly: true
        ))
        let started = ProcessInfo.processInfo.systemUptime
        var beats = 0
        print("[Equanimity native diag] +0ms bridge ready")
        diagnosticTimer = Timer(timeInterval: 1, repeats: true) { [weak self] timer in
            guard self != nil else { timer.invalidate(); return }
            beats += 1
            let elapsed = Int((ProcessInfo.processInfo.systemUptime - started) * 1000)
            print("[Equanimity native diag] +\(elapsed)ms native heartbeat #\(beats)")
            if beats == 60 { timer.invalidate() }
        }
        if let diagnosticTimer { RunLoop.main.add(diagnosticTimer, forMode: .common) }
        #endif
        bridge?.registerPluginInstance(EquanimityHealthKitPlugin())
        bridge?.registerPluginInstance(EquanimityGongPlugin())
    }

    deinit {
        #if DEBUG
        diagnosticTimer?.invalidate()
        #endif
    }
}
