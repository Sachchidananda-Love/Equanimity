import AVFoundation
import Capacitor

/// A delegate per playback prevents a late completion from an older/replaced
/// gong (including a cached player) from deactivating the new gong's session.
private final class GongPlaybackDelegate: NSObject, AVAudioPlayerDelegate {
    private let ended: () -> Void
    init(ended: @escaping () -> Void) { self.ended = ended }
    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) { ended() }
    func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) { ended() }
}

@objc(EquanimityGongPlugin)
final class EquanimityGongPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "EquanimityGongPlugin"
    let jsName = "EquanimityGong"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "play", returnType: CAPPluginReturnPromise),
    ]

    @objc func play(_ call: CAPPluginCall) {
        guard let file = call.getString("file") else { call.reject("Unknown bundled gong."); return }
        EquanimityGongPlayer.shared.play(file: file) { played in
            call.resolve(["played": played])
        }
    }
}

/// Both immediate JS previews and foreground scheduled notifications use the
/// same off-main audio path. Never initialize WebKit audio to play a gong.
final class EquanimityGongPlayer {
    static let shared = EquanimityGongPlayer()

    // AVAudioPlayer construction, session activation and decoding must never
    // run on the UI thread or in WKWebView. All player state belongs to this queue.
    private let audioQueue = DispatchQueue(label: "equanimity.gong", qos: .userInitiated)
    private let files: Set<String> = ["gong-1.wav", "gong-2.wav", "gong-3.wav", "tripple-gong.wav"]
    private var players: [String: AVAudioPlayer] = [:]
    private var activePlayer: AVAudioPlayer?
    private var sessionConfigured = false
    private var sessionActive = false
    private var playbackID: UUID?
    private var playbackDelegate: GongPlaybackDelegate?
    private var interruptionObserver: NSObjectProtocol?
    #if DEBUG
    private var diagnostics = 0
    #endif

    private init() {
        interruptionObserver = NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification,
            object: nil, queue: nil) { [weak self] notification in
            guard let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  AVAudioSession.InterruptionType(rawValue: raw) == .began else { return }
            self?.audioQueue.async { [weak self] in self?.finishPlayback() }
        }
    }

    /// Called only on audioQueue. No automatic resume/replay after an interruption.
    private func finishPlayback() {
        activePlayer?.stop()
        activePlayer?.delegate = nil
        activePlayer = nil
        playbackDelegate = nil
        playbackID = nil
        guard sessionActive else { return }
        do {
            try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            sessionActive = false
            #if DEBUG
            print("[Equanimity native diag] gong finished; audio session deactivated")
            #endif
        } catch {
            // No retry loop or background keepalive. A later playback may retry
            // activation/deactivation; report no private content or error payload.
            #if DEBUG
            print("[Equanimity native diag] gong stopped; audio session deactivation failed")
            #endif
        }
    }

    func play(file: String, completion: @escaping (Bool) -> Void = { _ in }) {
        guard files.contains(file) else {
            completion(false)
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
                activePlayer?.stop()
                activePlayer?.delegate = nil
                playbackID = nil
                playbackDelegate = nil
                activePlayer = nil
                if !sessionConfigured {
                    try AVAudioSession.sharedInstance().setCategory(.playback, options: .mixWithOthers)
                    sessionConfigured = true
                }
                try AVAudioSession.sharedInstance().setActive(true)
                sessionActive = true
                let player: AVAudioPlayer
                if let cached = players[file] {
                    player = cached
                } else {
                    guard let url = Bundle.main.url(forResource: file, withExtension: nil, subdirectory: "public/gong-sounds") else {
                        #if DEBUG
                        if log { print("[Equanimity native diag] gong initialization failed: bundled asset unavailable") }
                        #endif
                        finishPlayback()
                        completion(false)
                        return
                    }
                    player = try AVAudioPlayer(contentsOf: url)
                    players[file] = player
                }
                player.currentTime = 0
                player.volume = 0.82
                player.numberOfLoops = 0
                let id = UUID()
                playbackID = id
                playbackDelegate = GongPlaybackDelegate { [weak self] in
                    self?.audioQueue.async { [weak self] in
                        guard let self, self.playbackID == id else { return }
                        self.finishPlayback()
                    }
                }
                player.delegate = playbackDelegate
                activePlayer = player
                let played = player.play()
                if !played { finishPlayback() }
                #if DEBUG
                if log { print("[Equanimity native diag] gong initialization end +\(Int((ProcessInfo.processInfo.systemUptime - started) * 1000))ms played=\(played)") }
                #endif
                completion(played)
            } catch {
                finishPlayback()
                #if DEBUG
                if log { print("[Equanimity native diag] gong initialization failed +\(Int((ProcessInfo.processInfo.systemUptime - started) * 1000))ms") }
                #endif
                completion(false)
            }
        }
    }
}
