import AVFoundation
import Capacitor

@objc(EquanimityGongPlugin)
final class EquanimityGongPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "EquanimityGongPlugin"
    let jsName = "EquanimityGong"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "play", returnType: CAPPluginReturnPromise),
    ]

    // AVAudioPlayer construction, session activation and decoding must never
    // run on the UI thread or in WKWebView. All player state belongs to this queue.
    private let audioQueue = DispatchQueue(label: "equanimity.gong", qos: .userInitiated)
    private let files: Set<String> = ["gong-1.wav", "gong-2.wav", "gong-3.wav", "tripple-gong.wav"]
    private var players: [String: AVAudioPlayer] = [:]
    private var activePlayer: AVAudioPlayer?
    private var sessionConfigured = false
    #if DEBUG
    private var diagnostics = 0
    #endif

    @objc func play(_ call: CAPPluginCall) {
        guard let file = call.getString("file"), files.contains(file) else {
            call.reject("Unknown bundled gong.", "GONG_UNAVAILABLE")
            return
        }
        audioQueue.async { [self] in
            #if DEBUG
            let started = ProcessInfo.processInfo.systemUptime
            diagnostics += 1
            let log = diagnostics <= 8 || (diagnostics <= 1024 && (diagnostics & (diagnostics - 1)) == 0)
            if log { print("[Equanimity native diag] gong initialization start #\(diagnostics)") }
            #endif
            do {
                if !sessionConfigured {
                    try AVAudioSession.sharedInstance().setCategory(.playback, options: .mixWithOthers)
                    sessionConfigured = true
                }
                try AVAudioSession.sharedInstance().setActive(true)
                activePlayer?.stop()
                let player: AVAudioPlayer
                if let cached = players[file] {
                    player = cached
                } else {
                    guard let url = Bundle.main.url(forResource: file, withExtension: nil, subdirectory: "public/gong-sounds") else {
                        #if DEBUG
                        if log { print("[Equanimity native diag] gong initialization failed: bundled asset unavailable") }
                        #endif
                        call.reject("Bundled gong is unavailable.", "GONG_UNAVAILABLE")
                        return
                    }
                    player = try AVAudioPlayer(contentsOf: url)
                    players[file] = player
                }
                player.currentTime = 0
                player.volume = 0.82
                activePlayer = player
                let played = player.play()
                #if DEBUG
                if log { print("[Equanimity native diag] gong initialization end +\(Int((ProcessInfo.processInfo.systemUptime - started) * 1000))ms played=\(played)") }
                #endif
                call.resolve(["played": played])
            } catch {
                #if DEBUG
                if log { print("[Equanimity native diag] gong initialization failed +\(Int((ProcessInfo.processInfo.systemUptime - started) * 1000))ms") }
                #endif
                call.reject("Gong playback is unavailable.", "GONG_UNAVAILABLE")
            }
        }
    }
}
