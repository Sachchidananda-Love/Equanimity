import Foundation
import UserNotifications

/// The same content/trigger builder is used by real gongs and the Debug test.
enum PracticeNotificationRequest {
    static let testPrefix = "equanimity.practice-test."
    /// Shared by the physically verified minimal control and real Practice.
    /// The filename includes the extension and refers to a main-bundle asset.
    static func customSound(filename: String) -> UNNotificationSound {
        UNNotificationSound(named: UNNotificationSoundName(filename))
    }
    static func canReuse(_ request: UNNotificationRequest, for gong: PracticePlan.Gong) -> Bool {
        request.identifier == gong.id
            && (request.content.userInfo["at"] as? Double) == gong.at
            && (request.content.userInfo["file"] as? String) == gong.file
            && request.content.sound != nil
            && request.content.interruptionLevel == .active
            && (request.content.userInfo["soundFilename"] as? String) == PracticePlan.notificationSounds[gong.file]
    }
    /// The abstract UNNotificationTrigger has no nextTriggerDate API. Keep
    /// diagnostics read-only and query only the supported concrete subclasses.
    static func nextTriggerDate(for trigger: UNNotificationTrigger?) -> Date? {
        switch trigger {
        case let calendar as UNCalendarNotificationTrigger:
            return calendar.nextTriggerDate()
        case let interval as UNTimeIntervalNotificationTrigger:
            return interval.nextTriggerDate()
        default:
            return nil // nil, push, location or future unsupported trigger types
        }
    }
    static func belongs(_ id: String, to sessionId: String) -> Bool {
        id.hasPrefix("\(PracticePlan.prefix)\(sessionId).gong.")
    }
    static func deferCompletion(completed: Bool, foreground: Bool) -> Bool { completed && !foreground }
    static func make(_ gong: PracticePlan.Gong, sessionId: String, now: Date = Date(), test: Bool = false) throws -> UNNotificationRequest {
        guard let filename = PracticePlan.notificationSounds[gong.file], gong.at / 1000 > now.timeIntervalSince1970 else {
            throw NSError(domain: "EquanimityPractice", code: 2)
        }
        let content = UNMutableNotificationContent()
        content.interruptionLevel = .active
        content.title = "Equanimity · Practice"
        content.body = test ? "Lock Screen gong test." : gong.final ? "Your practice has finished." : "Practice gong."
        content.sound = customSound(filename: filename)
        content.threadIdentifier = "equanimity.practice"
        content.userInfo = ["sessionId": sessionId, "file": gong.file, "soundFilename": filename,
                            "at": gong.at, "final": gong.final, "debugTest": test]
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let date = Date(timeIntervalSince1970: ceil(gong.at / 1000))
        var components = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: date)
        components.calendar = calendar
        components.timeZone = calendar.timeZone
        return UNNotificationRequest(identifier: gong.id, content: content,
            trigger: UNCalendarNotificationTrigger(dateMatching: components, repeats: false))
    }
}

/// Read headers only; no audio decode/session initialization on the UI thread.
struct PracticeSoundAsset {
    let filename: String
    let exists: Bool
    let duration: Double
    let valid: Bool
    static func inspect(filename: String, data: Data?) -> Self {
        guard let data, data.count >= 12,
              String(data: data.prefix(4), encoding: .ascii) == "RIFF",
              String(data: data[8..<12], encoding: .ascii) == "WAVE" else {
            return Self(filename: filename, exists: data != nil, duration: 0, valid: false)
        }
        func number(_ offset: Int, _ length: Int) -> Int {
            (0..<length).reduce(0) { $0 | (Int(data[offset + $1]) << (8 * $1)) }
        }
        var offset = 12, rate = 0, align = 0, bytes = 0, pcm = false
        while offset + 8 <= data.count {
            let size = number(offset + 4, 4), begin = offset + 8
            guard size <= data.count - begin else { break }
            let tag = String(data: data[offset..<(offset + 4)], encoding: .ascii)
            if tag == "fmt ", size >= 16 {
                rate = number(begin + 4, 4); align = number(begin + 12, 2)
                pcm = number(begin, 2) == 1 && number(begin + 14, 2) == 16
                    && number(begin + 2, 2) > 0 && align == number(begin + 2, 2) * 2
            }
            if tag == "data" { bytes = size }
            offset = begin + size + size % 2
        }
        let duration = rate > 0 && align > 0 ? Double(bytes) / Double(rate * align) : 0
        return Self(filename: filename, exists: true, duration: duration,
                    valid: pcm && duration > 0 && duration < 30)
    }
}
