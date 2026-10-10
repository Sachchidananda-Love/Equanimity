import ActivityKit
import Foundation

@available(iOS 16.2, *)
struct PracticeActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var startedAt: Date
        var endAt: Date
    }
    let sessionId: String
    let title: String
}
