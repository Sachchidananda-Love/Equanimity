import Foundation

struct PracticePlan: Codable, Equatable {
    struct Gong: Codable, Equatable {
        let id: String
        let at: Double // canonical JS epoch milliseconds
        let file: String
        let final: Bool
    }
    let sessionId: String
    let startedAt: Double
    let endAt: Double
    let title: String
    let events: [Gong]

    static let prefix = "equanimity.practice."
    static let notificationSounds = [
        "gong-1.wav": "equanimity-gong-1.wav",
        "gong-2.wav": "equanimity-gong-2.wav",
        "gong-3.wav": "equanimity-gong-3.wav",
        "tripple-gong.wav": "equanimity-tripple-gong.wav",
    ]
    var endDate: Date { Date(timeIntervalSince1970: endAt / 1000) }
    var startDate: Date { Date(timeIntervalSince1970: startedAt / 1000) }

    func validate() throws {
        guard !sessionId.isEmpty, sessionId.count <= 128,
              sessionId.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-") }),
              startedAt.isFinite, endAt.isFinite, endAt > startedAt,
              endAt - startedAt <= 86_400_000, title == "Practice", events.count <= 3000,
              Set(events.map(\.id)).count == events.count,
              events.filter({ $0.final }).count == 1,
              events.allSatisfy({ $0.at.isFinite && $0.at > startedAt && $0.at <= endAt
                  && $0.id.hasPrefix("\(Self.prefix)\(sessionId).gong.")
                  && Self.notificationSounds[$0.file] != nil && (!$0.final || $0.at == endAt) }) else {
            throw NSError(domain: "EquanimityPractice", code: 1)
        }
    }

    /// Preserve every event in the projection. Only the OS pending queue is
    /// bounded; reserve the final gong, then refill on next foreground/sync.
    func upcoming(now: Date, capacity: Int) -> [Gong] {
        let future = events.filter { $0.at / 1000 > now.timeIntervalSince1970 }.sorted { $0.at < $1.at }
        guard future.count > capacity else { return future }
        guard capacity > 0, let final = future.last(where: { $0.final }) else { return [] }
        return Array(future.filter { !$0.final }.prefix(capacity - 1)) + [final]
    }
}
