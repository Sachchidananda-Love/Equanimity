import ActivityKit
import Capacitor
import UIKit
import UserNotifications

@objc(EquanimityPracticePlugin)
final class EquanimityPracticePlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "EquanimityPracticePlugin"
    let jsName = "EquanimityPractice"
    var pluginMethods: [CAPPluginMethod] {
        var methods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sync", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "playDue", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
        ]
        #if DEBUG
        methods += [CAPPluginMethod(name: "diagnostics", returnType: CAPPluginReturnPromise),
                    CAPPluginMethod(name: "testGong", returnType: CAPPluginReturnPromise),
                    CAPPluginMethod(name: "testNotificationControl", returnType: CAPPluginReturnPromise)]
        #endif
        return methods
    }
    #if DEBUG
    @objc func diagnostics(_ call: CAPPluginCall) {
        Task { @MainActor in await PracticeNativeService.shared.enqueue {
            call.resolve(await PracticeNativeService.shared.diagnostics())
        } }
    }
    @objc func testGong(_ call: CAPPluginCall) {
        guard let file = call.getString("file"), PracticePlan.notificationSounds[file] != nil else { call.reject("Unknown gong."); return }
        Task { @MainActor in await PracticeNativeService.shared.enqueue {
            do { call.resolve(try await PracticeNativeService.shared.testGong(file: file)) }
            catch { call.reject(error.localizedDescription) }
        } }
    }
    @objc func testNotificationControl(_ call: CAPPluginCall) {
        let custom = call.getBool("custom") ?? false
        Task { @MainActor in await PracticeNativeService.shared.enqueue {
            do { call.resolve(try await PracticeNativeService.shared.testNotificationControl(custom: custom)) }
            catch { call.reject(error.localizedDescription) }
        } }
    }
    #endif
    @objc func status(_ call: CAPPluginCall) {
        Task { @MainActor in call.resolve(await PracticeNativeService.shared.status()) }
    }
    @objc func requestPermission(_ call: CAPPluginCall) {
        Task { @MainActor in
            do {
                _ = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])
                call.resolve(await PracticeNativeService.shared.status())
            } catch { call.reject("Notification permission could not be requested.") }
        }
    }
    @objc func sync(_ call: CAPPluginCall) {
        guard let value = call.getObject("plan"),
              let data = try? JSONSerialization.data(withJSONObject: value),
              let plan = try? JSONDecoder().decode(PracticePlan.self, from: data),
              (try? plan.validate()) != nil else { call.reject("Invalid Practice schedule."); return }
        Task { @MainActor in
            await PracticeNativeService.shared.enqueue {
                do { call.resolve(try await PracticeNativeService.shared.sync(plan)) }
                catch { call.reject("Practice notifications could not be scheduled.") }
            }
        }
    }
    @objc func cancel(_ call: CAPPluginCall) {
        let completed = call.getBool("completed") ?? false
        let sessionId = call.getString("sessionId")
        Task { @MainActor in
            await PracticeNativeService.shared.enqueue {
                await PracticeNativeService.shared.cancel(completed: completed, sessionId: sessionId)
                call.resolve()
            }
        }
    }
    @objc func playDue(_ call: CAPPluginCall) {
        guard let sessionId = call.getString("sessionId"), let at = call.getDouble("at") else { call.reject("Invalid gong event."); return }
        Task { @MainActor in await PracticeNativeService.shared.enqueue {
            PracticeNativeService.shared.playDue(sessionId: sessionId, at: at)
            call.resolve()
        } }
    }
}

/// Native projection only: the web checkpoint remains the canonical timer.
/// UserNotifications owns delivery while suspended; no polling/background audio.
@MainActor
final class PracticeNativeService: NSObject, UNUserNotificationCenterDelegate {
    static let shared = PracticeNativeService()
    private let center = UNUserNotificationCenter.current()
    private let projectionKey = "equanimity.practice.native-projection.v1"
    private var plan: PracticePlan?
    private var played: Set<String> = []
    private var previousDelegate: UNUserNotificationCenterDelegate?
    private var operation: Task<Void, Never>?
    private var assets: [String: PracticeSoundAsset]?
    #if DEBUG
    private var backgroundEvidence: JSObject?
    private var foregroundEvidence: JSObject?
    nonisolated private static let controlPrefix = "equanimity.notification-control."
    private var controls: [String: String] = [:]
    private var notificationTrace: [JSObject] = []
    private func trace(_ event: String, id: String, reason: String, options: UNNotificationPresentationOptions? = nil) {
        var row: JSObject = ["at": Date().timeIntervalSince1970 * 1000, "event": event, "id": id,
                             "reason": reason, "applicationState": UIApplication.shared.applicationState.rawValue]
        if let options {
            row["banner"] = options.contains(.banner); row["list"] = options.contains(.list); row["sound"] = options.contains(.sound)
        }
        notificationTrace.append(row)
        if notificationTrace.count > 100 { notificationTrace.removeFirst(notificationTrace.count - 100) }
        print("[Equanimity Practice diag] notification \(row)")
    }
    #endif

    private func removePending(_ ids: [String], reason: String) {
        #if DEBUG
        for id in ids { trace("removePending", id: id, reason: reason) }
        #endif
        center.removePendingNotificationRequests(withIdentifiers: ids)
    }
    private func removeDelivered(_ ids: [String], reason: String) {
        #if DEBUG
        for id in ids { trace("removeDelivered", id: id, reason: reason) }
        #endif
        center.removeDeliveredNotifications(withIdentifiers: ids)
    }

    private func soundAssets() async -> [String: PracticeSoundAsset] {
        if let assets { return assets }
        let result = await Task.detached(priority: .utility) {
            Dictionary(uniqueKeysWithValues: PracticePlan.notificationSounds.values.map { name in
                let url = Bundle.main.url(forResource: name, withExtension: nil)
                return (name, PracticeSoundAsset.inspect(filename: name, data: url.flatMap { try? Data(contentsOf: $0) }))
            })
        }.value
        assets = result
        return result
    }
    private func addGong(_ gong: PracticePlan.Gong, sessionId: String, test: Bool = false) async throws {
        let inventory = await soundAssets()
        guard let filename = PracticePlan.notificationSounds[gong.file], inventory[filename]?.valid == true else {
            throw NSError(domain: "EquanimityPractice", code: 3, userInfo: [NSLocalizedDescriptionKey: "The bundled notification sound is missing or invalid."])
        }
        let request = try PracticeNotificationRequest.make(gong, sessionId: sessionId, test: test)
        try await center.add(request)
        #if DEBUG
        trace("practiceScheduled", id: gong.id, reason: "customSound(filename:) \(filename); sound populated=\(request.content.sound != nil)")
        print("[Equanimity Practice diag] scheduled id=\(gong.id) intended=\(gong.at) trigger=\(PracticeNotificationRequest.nextTriggerDate(for: request.trigger)?.timeIntervalSince1970 ?? 0) sound=\(filename) bundle=true")
        #endif
    }

    func install() {
        if center.delegate !== self { previousDelegate = center.delegate; center.delegate = self }
        if let data = UserDefaults.standard.data(forKey: projectionKey),
           let saved = try? JSONDecoder().decode(PracticePlan.self, from: data),
           (try? saved.validate()) != nil { plan = saved }
    }
    func enqueue(_ action: @escaping @MainActor () async -> Void) async {
        let previous = operation
        let next = Task { @MainActor in await previous?.value; await action() }
        operation = next
        await next.value
    }
    func status(scheduled: Int? = nil, requested: Int? = nil, scheduling: Bool? = nil) async -> JSObject {
        let settings = await center.notificationSettings()
        let permission: String
        switch settings.authorizationStatus {
        case .notDetermined: permission = "notDetermined"
        case .denied: permission = "denied"
        case .authorized: permission = "authorized"
        case .provisional: permission = "provisional"
        case .ephemeral: permission = "ephemeral"
        @unknown default: permission = "unknown"
        }
        var live = false
        if #available(iOS 16.2, *) { live = ActivityAuthorizationInfo().areActivitiesEnabled }
        let pending = await center.pendingNotificationRequests()
        let count = pending.filter { request in plan.map { PracticeNotificationRequest.belongs(request.identifier, to: $0.sessionId) } ?? false }.count
        let future = plan?.events.filter { $0.at / 1000 > Date().timeIntervalSince1970 }.count ?? 0
        return ["permission": permission, "soundEnabled": settings.soundSetting == .enabled,
                "liveActivitiesEnabled": live, "scheduled": scheduled ?? count, "requested": requested ?? future,
                "notificationScheduling": scheduling ?? (count > 0)]
    }
    func sync(_ next: PracticePlan) async throws -> JSObject {
        if let previous = plan, previous.sessionId != next.sessionId {
            await cancel(completed: false, sessionId: previous.sessionId)
        }
        if plan?.sessionId != next.sessionId { played.removeAll() }
        plan = next
        // No health data, account identifiers or private preset titles stored here.
        UserDefaults.standard.set(try JSONEncoder().encode(next), forKey: projectionKey)
        guard next.endDate > Date() else { await cancel(completed: false, sessionId: next.sessionId); return await status() }
        let settings = await center.notificationSettings()
        let authorized = [.authorized, .provisional, .ephemeral].contains(settings.authorizationStatus)
        let pending = await center.pendingNotificationRequests()
        let otherCount = pending.filter { !PracticeNotificationRequest.belongs($0.identifier, to: next.sessionId) }.count
        let future = next.upcoming(now: Date(), capacity: max(0, 64 - otherCount))
        let desired = authorized ? Set(future.map(\.id)) : []
        removePending(pending.filter {
            PracticeNotificationRequest.belongs($0.identifier, to: next.sessionId) && !desired.contains($0.identifier)
        }.map(\.identifier), reason: "sync obsolete session requests")
        do {
            if authorized {
                for gong in future {
                    // Same stable identifier replaces, never duplicates; unchanged
                    // pending requests need no work on repeated foreground events.
                    if pending.contains(where: { PracticeNotificationRequest.canReuse($0, for: gong) }) { continue }
                    guard gong.at / 1000 > Date().timeIntervalSince1970 else { continue }
                    try await addGong(gong, sessionId: next.sessionId)
                }
            }
        } catch {
            // Partial schedules must not double-play with the JS fallback.
            let current = await center.pendingNotificationRequests()
            removePending(current.filter { PracticeNotificationRequest.belongs($0.identifier, to: next.sessionId) }.map(\.identifier), reason: "partial scheduling failure")
            await reconcileActivity(next)
            throw error
        }
        await reconcileActivity(next)
        let actual = await center.pendingNotificationRequests().filter { desired.contains($0.identifier) }.count
        let requested = next.events.filter { $0.at / 1000 > Date().timeIntervalSince1970 }.count
        return await status(scheduled: actual, requested: requested, scheduling: authorized && actual > 0)
    }
    func cancel(completed: Bool, sessionId: String? = nil) async {
        // A final JS tick can arrive while UIKit has already backgrounded but
        // WKWebView's visibility still says visible. Never delete its OS alert.
        if PracticeNotificationRequest.deferCompletion(completed: completed, foreground: UIApplication.shared.applicationState == .active) {
            #if DEBUG
            print("[Equanimity Practice diag] deferred hidden completion; pending alerts retained")
            #endif
            return
        }
        guard let owner = sessionId ?? plan?.sessionId else { return }
        let delivered = await center.deliveredNotifications()
        // Background notifications are not routed through willPresent. Their
        // delivered identifiers prevent a just-resumed final gong playing twice.
        for notification in delivered where PracticeNotificationRequest.belongs(notification.request.identifier, to: owner) {
            played.insert(notification.request.identifier)
        }
        if completed, UIApplication.shared.applicationState == .active, let current = plan, current.sessionId == owner,
           abs(current.endDate.timeIntervalSinceNow) <= 2, let final = current.events.first(where: { $0.final }) {
            playOnce(final.id, file: final.file)
        }
        if plan?.sessionId == owner { plan = nil; UserDefaults.standard.removeObject(forKey: projectionKey) }
        let pending = await center.pendingNotificationRequests()
        let ids = pending.filter { PracticeNotificationRequest.belongs($0.identifier, to: owner) }.map(\.identifier)
        removePending(ids, reason: "cancel completed=\(completed)")
        removeDelivered(delivered.filter { PracticeNotificationRequest.belongs($0.request.identifier, to: owner) }.map { $0.request.identifier }, reason: "cancel completed=\(completed)")
        #if DEBUG
        print("[Equanimity Practice diag] cancel session=\(owner) removed=\(ids.count)")
        #endif
        if #available(iOS 16.2, *) {
            for activity in Activity<PracticeActivityAttributes>.activities where activity.attributes.sessionId == owner {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
        }
    }
    func foreground() {
        Task { @MainActor in await enqueue {
            #if DEBUG
            // Capture delivery evidence before ordinary completion cleanup
            // removes delivered alerts. Never change that cleanup's behavior.
            self.foregroundEvidence = await self.notificationEvidence()
            #endif
            for notification in await self.center.deliveredNotifications() where notification.request.identifier.hasPrefix(PracticePlan.prefix) {
                self.played.insert(notification.request.identifier)
            }
            if let current = self.plan, current.endDate <= Date() { await self.cancel(completed: false) }
            else if self.plan == nil { await self.cancel(completed: false) }
        } }
        #if DEBUG
        logDiagnostics("foreground")
        #endif
    }
    #if DEBUG
    func background() {
        Task { @MainActor in
            self.backgroundEvidence = await self.notificationEvidence()
            self.logDiagnostics("background transition; no cancellation")
        }
    }
    private func setting(_ value: UNNotificationSetting) -> String {
        switch value { case .enabled: return "enabled"; case .disabled: return "disabled"; case .notSupported: return "notSupported"; @unknown default: return "unknown" }
    }
    private func notificationEvidence() async -> JSObject {
        var result = await status()
        let settings = await center.notificationSettings(), inventory = await soundAssets()
        let pending = await center.pendingNotificationRequests()
        let delivered = await center.deliveredNotifications()
        let practice = pending.filter { $0.identifier.hasPrefix(PracticePlan.prefix) || $0.identifier.hasPrefix(PracticeNotificationRequest.testPrefix) || $0.identifier.hasPrefix(Self.controlPrefix) }
        result["capturedAt"] = Date().timeIntervalSince1970 * 1000
        result["soundSetting"] = setting(settings.soundSetting)
        result["alertSetting"] = setting(settings.alertSetting)
        result["lockScreenSetting"] = setting(settings.lockScreenSetting)
        result["scheduledDeliverySetting"] = setting(settings.scheduledDeliverySetting)
        result["delegateInstalled"] = center.delegate === self
        result["pendingPracticeCount"] = practice.count
        result["requests"] = practice.sorted { $0.identifier < $1.identifier }.map { request -> JSObject in
            let filename = controls[request.identifier] ?? request.content.userInfo["soundFilename"] as? String
                ?? PracticePlan.notificationSounds[request.content.userInfo["file"] as? String ?? ""] ?? "unmapped"
            return ["id": request.identifier, "intendedAt": request.content.userInfo["at"] as? Double ?? (PracticeNotificationRequest.nextTriggerDate(for: request.trigger)?.timeIntervalSince1970 ?? 0) * 1000,
                    "triggerAt": (PracticeNotificationRequest.nextTriggerDate(for: request.trigger)?.timeIntervalSince1970 ?? 0) * 1000,
                    "soundFilename": filename, "soundPopulated": request.content.sound != nil,
                    "mappedSoundFilename": PracticePlan.notificationSounds[request.content.userInfo["file"] as? String ?? ""] ?? controls[request.identifier] ?? "unmapped",
                    "userInfoSoundFilename": request.content.userInfo["soundFilename"] as? String ?? "none",
                    "triggerType": request.trigger.map { String(describing: type(of: $0)) } ?? "none",
                    "relevanceScore": request.content.relevanceScore,
                    "bundleExists": Bundle.main.url(forResource: filename, withExtension: nil) != nil, "validSound": inventory[filename]?.valid ?? false,
                    "test": request.content.userInfo["debugTest"] as? Bool ?? false,
                    "category": request.content.categoryIdentifier, "thread": request.content.threadIdentifier,
                    "titlePresent": !request.content.title.isEmpty, "bodyPresent": !request.content.body.isEmpty,
                    "interruptionLevel": Int(request.content.interruptionLevel.rawValue)]
        }
        let deliveredPractice = delivered.filter {
            $0.request.identifier.hasPrefix(PracticePlan.prefix) || $0.request.identifier.hasPrefix(PracticeNotificationRequest.testPrefix) || $0.request.identifier.hasPrefix(Self.controlPrefix)
        }
        result["deliveredPracticeCount"] = deliveredPractice.count
        result["deliveredRequests"] = deliveredPractice.map { notification -> JSObject in
            let request = notification.request
            let filename = controls[request.identifier] ?? request.content.userInfo["soundFilename"] as? String
                ?? PracticePlan.notificationSounds[request.content.userInfo["file"] as? String ?? ""] ?? "unmapped"
            return ["id": request.identifier, "deliveredAt": notification.date.timeIntervalSince1970 * 1000,
                    "soundFilename": filename, "soundPopulated": request.content.sound != nil,
                    "mappedSoundFilename": PracticePlan.notificationSounds[request.content.userInfo["file"] as? String ?? ""] ?? controls[request.identifier] ?? "unmapped",
                    "userInfoSoundFilename": request.content.userInfo["soundFilename"] as? String ?? "none",
                    "triggerType": request.trigger.map { String(describing: type(of: $0)) } ?? "none",
                    "relevanceScore": request.content.relevanceScore,
                    "category": request.content.categoryIdentifier, "thread": request.content.threadIdentifier,
                    "titlePresent": !request.content.title.isEmpty, "bodyPresent": !request.content.body.isEmpty,
                    "interruptionLevel": Int(request.content.interruptionLevel.rawValue)]
        }
        result["assets"] = inventory.values.sorted { $0.filename < $1.filename }.map { asset -> JSObject in
            ["filename": asset.filename, "exists": asset.exists, "valid": asset.valid,
             "duration": asset.duration, "format": "16-bit PCM WAV"]
        }
        return result
    }
    func diagnostics() async -> JSObject {
        var result = await notificationEvidence()
        if let backgroundEvidence { result["backgroundEvidence"] = backgroundEvidence }
        if let foregroundEvidence { result["foregroundEvidence"] = foregroundEvidence }
        result["notificationTrace"] = notificationTrace
        return result
    }
    private func logDiagnostics(_ event: String) {
        Task { @MainActor in
            let result = await diagnostics()
            print("[Equanimity Practice diag] \(event) authorization=\(result["permission"] ?? "unknown") sound=\(result["soundSetting"] ?? "unknown") pending=\(result["pendingPracticeCount"] ?? 0)")
            for row in result["requests"] as? [JSObject] ?? [] { print("[Equanimity Practice diag] request \(row)") }
        }
    }
    func testGong(file: String) async throws -> JSObject {
        let settings = await center.notificationSettings()
        guard settings.authorizationStatus == .authorized, settings.soundSetting == .enabled else {
            throw NSError(domain: "EquanimityPractice", code: 4, userInfo: [NSLocalizedDescriptionKey: "Enable notification permission and Sounds before testing."])
        }
        let session = UUID().uuidString
        let gong = PracticePlan.Gong(id: "\(PracticeNotificationRequest.testPrefix)\(session)",
                                    at: (Date().timeIntervalSince1970 + 10) * 1000, file: file, final: false)
        try await addGong(gong, sessionId: session, test: true)
        return await diagnostics()
    }
    func testNotificationControl(custom: Bool) async throws -> JSObject {
        // Independent control: no Practice builder, category, thread, userInfo,
        // projection, session cleanup or foreground audio. Only sound differs.
        let content = UNMutableNotificationContent()
        content.interruptionLevel = .active
        content.title = "Equanimity notification control"
        content.body = "This test should be visible and audible."
        content.sound = custom ? PracticeNotificationRequest.customSound(filename: "equanimity-gong-1.wav") : UNNotificationSound.default
        let id = Self.controlPrefix + UUID().uuidString
        let request = UNNotificationRequest(identifier: id, content: content,
            trigger: UNTimeIntervalNotificationTrigger(timeInterval: 10, repeats: false))
        try await center.add(request)
        controls[id] = custom ? "equanimity-gong-1.wav" : "system default"
        trace("controlScheduled", id: id, reason: controls[id]!)
        return await diagnostics()
    }
    #endif
    func playDue(sessionId: String, at: Double) {
        guard UIApplication.shared.applicationState == .active,
              let current = plan, current.sessionId == sessionId,
              let gong = current.events.first(where: { $0.at == at }),
              Date().timeIntervalSince1970 >= at / 1000,
              Date().timeIntervalSince1970 - at / 1000 < 1.5 else { return }
        playOnce(gong.id, file: gong.file)
    }
    private func playOnce(_ id: String, file: String) {
        guard played.insert(id).inserted else { return }
        EquanimityGongPlayer.shared.play(file: file)
    }
    private func reconcileActivity(_ next: PracticePlan) async {
        guard #available(iOS 16.2, *) else { return }
        let state = PracticeActivityAttributes.ContentState(startedAt: next.startDate, endAt: next.endDate)
        let content = ActivityContent(state: state, staleDate: next.endDate)
        var matching: Activity<PracticeActivityAttributes>?
        for activity in Activity<PracticeActivityAttributes>.activities {
            if activity.attributes.sessionId == next.sessionId && [.active, .stale].contains(activity.activityState) && matching == nil {
                matching = activity
            } else { await activity.end(nil, dismissalPolicy: .immediate) }
        }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        if let matching { await matching.update(content) }
        else if UIApplication.shared.applicationState == .active {
            // No push token; all countdown rendering is system driven.
            _ = try? Activity.request(attributes: PracticeActivityAttributes(sessionId: next.sessionId, title: next.title), content: content, pushType: nil)
        }
    }
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                               withCompletionHandler completionHandler: @escaping @Sendable (UNNotificationPresentationOptions) -> Void) {
        let finish: @Sendable (UNNotificationPresentationOptions, String) -> Void = { options, reason in
            #if DEBUG
            Task { @MainActor in self.trace("willPresent completion", id: notification.request.identifier, reason: reason, options: options) }
            #endif
            completionHandler(options)
        }
        #if DEBUG
        Task { @MainActor in self.trace("willPresent entered", id: notification.request.identifier, reason: "delegate called by OS") }
        #endif
        #if DEBUG
        if notification.request.identifier.hasPrefix(Self.controlPrefix) {
            finish([.banner, .list, .sound], "isolated control; OS presentation")
            return
        }
        if notification.request.identifier.hasPrefix(PracticeNotificationRequest.testPrefix) {
            finish([.banner, .sound], "Practice Debug test; OS presentation") // exercise OS sound even foregrounded
            return
        }
        #endif
        guard notification.request.identifier.hasPrefix(PracticePlan.prefix) else {
            Task { @MainActor in
                if let previousDelegate = self.previousDelegate,
                   previousDelegate.responds(to: #selector(UNUserNotificationCenterDelegate.userNotificationCenter(_:willPresent:withCompletionHandler:))) {
                    previousDelegate.userNotificationCenter?(center, willPresent: notification, withCompletionHandler: { finish($0, "previous delegate") })
                } else { finish([], "non-Practice; no previous delegate") }
            }
            return
        }
        Task { @MainActor in await self.enqueue {
            let info = notification.request.content.userInfo
            if let current = self.plan, info["sessionId"] as? String == current.sessionId,
               let gong = current.events.first(where: { $0.id == notification.request.identifier }),
               UIApplication.shared.applicationState == .active {
                self.playOnce(gong.id, file: gong.file)
                if gong.final { await self.cancel(completed: false) }
                else { _ = try? await self.sync(current) } // refill long sessions while running
                finish([], "active matching Practice; foreground audio only") // native audio only: no notification sound too
            } else if let current = self.plan, info["sessionId"] as? String == current.sessionId {
                finish([.banner, .sound], "inactive matching Practice; OS presentation") // inactive transition: let OS deliver
            } else { finish([], "Practice session does not match native plan") }
        } }
    }
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                            withCompletionHandler completionHandler: @escaping @Sendable () -> Void) {
        Task { @MainActor in
            if !response.notification.request.identifier.hasPrefix(PracticePlan.prefix),
               let previousDelegate = self.previousDelegate,
               previousDelegate.responds(to: #selector(UNUserNotificationCenterDelegate.userNotificationCenter(_:didReceive:withCompletionHandler:))) {
                previousDelegate.userNotificationCenter?(center, didReceive: response, withCompletionHandler: completionHandler)
            } else { completionHandler() }
        }
    }
}
