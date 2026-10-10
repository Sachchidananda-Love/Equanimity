import Foundation
import UserNotifications

let start = Date(timeIntervalSince1970: 1_800_000_000)
let events: [PracticePlan.Gong] = (1...100).map { index in
    let at = (start.timeIntervalSince1970 + Double(index * 60)) * 1000
    let isFinal = index == 100
    return PracticePlan.Gong(id: "equanimity.practice.test.gong.\(index)", at: at,
                             file: isFinal ? "tripple-gong.wav" : "gong-2.wav", final: isFinal)
}
let plan = PracticePlan(sessionId: "test", startedAt: start.timeIntervalSince1970 * 1000,
                        endAt: events.last!.at, title: "Practice", events: events)
try plan.validate()
let decoded = try JSONDecoder().decode(PracticePlan.self, from: JSONEncoder().encode(plan))
assert(decoded == plan)
let bounded = plan.upcoming(now: start, capacity: 64)
assert(bounded.count == 64)
assert(bounded.first?.id == events.first?.id)
assert(bounded.last?.final == true)
assert(bounded.last?.file == "tripple-gong.wav")
assert(plan.upcoming(now: start, capacity: 0).isEmpty)
assert(plan.upcoming(now: start.addingTimeInterval(64 * 60), capacity: 64).count == 36)
assert(plan.upcoming(now: plan.endDate, capacity: 64).isEmpty)
let invalid = PracticePlan(sessionId: "foreign/invalid", startedAt: plan.startedAt, endAt: plan.endAt, title: "Practice", events: events)
assert((try? invalid.validate()) == nil)
assert(PracticePlan.notificationSounds["gong-2.wav"] == "equanimity-gong-2.wav")
print("Native Practice projection: validation, durable decode, full schedule, capacity/final priority and expired filtering passed.")

let requests = try plan.events.map { try PracticeNotificationRequest.make($0, sessionId: plan.sessionId) }
assert(Set(requests.map(\.identifier)).count == 100)
assert(requests.last!.content.userInfo["soundFilename"] as? String == "equanimity-tripple-gong.wav")
assert(requests.first!.content.userInfo["soundFilename"] as? String == "equanimity-gong-2.wav")
for (gong, request) in zip(plan.events, requests) {
    assert(PracticeNotificationRequest.canReuse(request, for: gong))
    let passive = request.content.mutableCopy() as! UNMutableNotificationContent
    passive.interruptionLevel = .passive
    assert(!PracticeNotificationRequest.canReuse(UNNotificationRequest(identifier: request.identifier, content: passive, trigger: request.trigger), for: gong))
    assert(request.content.sound != nil)
    assert(request.trigger is UNCalendarNotificationTrigger)
    assert(PracticeNotificationRequest.nextTriggerDate(for: request.trigger)!.timeIntervalSince1970 == ceil(gong.at / 1000))
    assert(PracticeNotificationRequest.belongs(request.identifier, to: "test"))
    assert(!PracticeNotificationRequest.belongs(request.identifier, to: "test-other"))
}
for (file, filename) in PracticePlan.notificationSounds {
    let gong = PracticePlan.Gong(id: "equanimity.practice.sound-test.gong.1", at: testAtForSounds(), file: file, final: true)
    let request = try PracticeNotificationRequest.make(gong, sessionId: "sound-test")
    assert(request.content.sound != nil)
    assert(request.content.userInfo["soundFilename"] as? String == filename)
    assert(request.content.categoryIdentifier.isEmpty)
    assert(request.content.threadIdentifier == "equanimity.practice")
    assert(request.content.interruptionLevel == .active && request.content.relevanceScore == 0)
    assert(PracticeNotificationRequest.canReuse(request, for: gong))
    let missing = request.content.mutableCopy() as! UNMutableNotificationContent
    missing.sound = nil
    assert(!PracticeNotificationRequest.canReuse(UNNotificationRequest(identifier: request.identifier, content: missing, trigger: request.trigger), for: gong))
    let mismatch = request.content.mutableCopy() as! UNMutableNotificationContent
    mismatch.userInfo["soundFilename"] = "wrong.wav"
    assert(!PracticeNotificationRequest.canReuse(UNNotificationRequest(identifier: request.identifier, content: mismatch, trigger: request.trigger), for: gong))
    let restored = try PracticeNotificationRequest.make(gong, sessionId: "sound-test")
    assert(restored.identifier == request.identifier)
    assert(PracticeNotificationRequest.nextTriggerDate(for: restored.trigger) == PracticeNotificationRequest.nextTriggerDate(for: request.trigger))
    assert(restored.content.sound != nil)
}
func testAtForSounds() -> Double { (Date().timeIntervalSince1970 + 60) * 1000 }
let testAt = (Date().timeIntervalSince1970 + 10) * 1000
let testGong = PracticePlan.Gong(id: PracticeNotificationRequest.testPrefix + "synthetic", at: testAt, file: "gong-3.wav", final: false)
let testRequest = try PracticeNotificationRequest.make(testGong, sessionId: "synthetic", test: true)
assert(!PracticeNotificationRequest.belongs(testRequest.identifier, to: "test"))
assert(testRequest.content.sound != nil && testRequest.content.userInfo["debugTest"] as? Bool == true)
assert(abs(PracticeNotificationRequest.nextTriggerDate(for: testRequest.trigger)!.timeIntervalSince1970 - testAt / 1000) < 1)
assert(PracticeNotificationRequest.nextTriggerDate(for: nil) == nil)
let beforeInterval = Date()
let intervalTrigger = UNTimeIntervalNotificationTrigger(timeInterval: 10, repeats: false)
let intervalDate = PracticeNotificationRequest.nextTriggerDate(for: intervalTrigger)!
assert(intervalDate >= beforeInterval.addingTimeInterval(10))
assert(intervalDate <= Date().addingTimeInterval(10))
assert(PracticeNotificationRequest.deferCompletion(completed: true, foreground: false))
assert(!PracticeNotificationRequest.deferCompletion(completed: false, foreground: false))
assert(!PracticeNotificationRequest.deferCompletion(completed: true, foreground: true))
for name in PracticePlan.notificationSounds.values {
    let data = try Data(contentsOf: URL(fileURLWithPath: "ios/App/NotificationSounds/" + name))
    let asset = PracticeSoundAsset.inspect(filename: name, data: data)
    assert(asset.exists && asset.valid && asset.duration < 30)
}
assert(!PracticeSoundAsset.inspect(filename: "missing.wav", data: nil).exists)
assert(!PracticeSoundAsset.inspect(filename: "invalid.wav", data: Data([0, 1, 2])).valid)
print("Real UserNotifications request builder: trigger dates, sound content, unique IDs, session cleanup, Debug test and WAV headers passed.")
