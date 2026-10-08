import Foundation
import HealthKit
import Capacitor

@objc(EquanimityHealthKitPlugin)
final class EquanimityHealthKitPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "EquanimityHealthKitPlugin"
    let jsName = "EquanimityHealthKit"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestAuthorization", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "inspect", returnType: CAPPluginReturnPromise),
    ]

    private let healthStore = HKHealthStore()

    private enum TypeDefinition {
        case quantity(HKQuantityTypeIdentifier, String)
        case category(HKCategoryTypeIdentifier, String)

        var identifier: String {
            switch self {
            case .quantity(let identifier, _): return identifier.rawValue
            case .category(let identifier, _): return identifier.rawValue
            }
        }

        var displayName: String {
            switch self {
            case .quantity(_, let name), .category(_, let name): return name
            }
        }

        var sampleType: HKSampleType? {
            switch self {
            case .quantity(let identifier, _): return HKObjectType.quantityType(forIdentifier: identifier)
            case .category(let identifier, _): return HKObjectType.categoryType(forIdentifier: identifier)
            }
        }
    }

    private let requestedDefinitions: [TypeDefinition] = [
        .quantity(.basalBodyTemperature, "Basal body temperature"),
        .category(.sleepAnalysis, "Sleep analysis"),
        .category(.menstrualFlow, "Menstrual flow"),
        .category(.cervicalMucusQuality, "Cervical mucus quality"),
        .category(.ovulationTestResult, "Ovulation test result"),
        .category(.sexualActivity, "Sexual activity"),
    ]

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve(statusPayload())
    }

    @objc func requestAuthorization(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(statusPayload(extra: [
                "authorizationRequestCompleted": false,
                "message": "HealthKit is unavailable on this device.",
            ]))
            return
        }

        let readTypes = Set(requestedDefinitions.compactMap(\.sampleType).map { $0 as HKObjectType })
        healthStore.requestAuthorization(toShare: [], read: readTypes) { [weak self] success, error in
            DispatchQueue.main.async {
                guard let self else { return }
                if let error {
                    call.reject("HealthKit authorization could not be completed.", "HEALTHKIT_AUTHORIZATION_ERROR", error)
                    return
                }
                // Apple does not expose read authorization status for individual types.
                // `success` means the request completed, not that every read was granted.
                call.resolve(self.statusPayload(extra: [
                    "authorizationRequestCompleted": success,
                    "message": "The request completed. HealthKit read permission is reported by query results, not by a per-type read status API.",
                ]))
            }
        }
    }

    @objc func inspect(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve([
                "available": false,
                "records": [],
                "errors": [],
                "message": "HealthKit is unavailable on this device.",
            ])
            return
        }

        let days = max(1, min(call.getInt("days", 30), 3650))
        let startDate = Calendar.current.date(byAdding: .day, value: -days, to: Date()) ?? Date(timeIntervalSince1970: 0)
        let endDate = Date()
        let definitions = requestedDefinitions.filter { $0.sampleType != nil }
        let group = DispatchGroup()
        let lock = NSLock()
        var samples: [[String: Any]] = []
        var errors: [[String: String]] = []

        for definition in definitions {
            guard let sampleType = definition.sampleType else { continue }
            group.enter()
            let predicate = HKQuery.predicateForSamples(withStart: startDate, end: endDate, options: .strictStartDate)
            let query = HKSampleQuery(sampleType: sampleType, predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]) { [weak self] _, result, error in
                defer { group.leave() }
                if let error {
                    lock.lock()
                    errors.append(["typeIdentifier": definition.identifier, "message": error.localizedDescription])
                    lock.unlock()
                    return
                }
                guard let self, let result else { return }
                let mapped = result.compactMap { self.serialize(sample: $0, definition: definition) }
                lock.lock()
                samples.append(contentsOf: mapped)
                lock.unlock()
            }
            healthStore.execute(query)
        }

        group.notify(queue: .main) {
            samples.sort { left, right in
                let leftDate = left["startDate"] as? String ?? ""
                let rightDate = right["startDate"] as? String ?? ""
                if leftDate == rightDate { return (left["uuid"] as? String ?? "") < (right["uuid"] as? String ?? "") }
                return leftDate < rightDate
            }
            call.resolve([
                "available": true,
                "queriedFrom": self.iso8601(startDate),
                "queriedTo": self.iso8601(endDate),
                "records": samples,
                "errors": errors,
                "message": samples.isEmpty ? "No readable records were returned for the selected period." : "Records are held in this inspection session only.",
            ])
        }
    }

    private func statusPayload(extra: [String: Any] = [:]) -> [String: Any] {
        var payload: [String: Any] = [
            "available": HKHealthStore.isHealthDataAvailable(),
            "platform": "ios",
            "readAuthorizationStatus": "not-exposed-by-healthkit",
            "message": "HealthKit does not expose individual read authorization status. A query with no records cannot distinguish denial from an empty data set.",
            "requestedTypes": requestedDefinitions.map { definition in
                [
                    "identifier": definition.identifier,
                    "displayName": definition.displayName,
                    "available": definition.sampleType != nil,
                    "readAuthorization": "not-exposed-by-healthkit",
                ] as [String: Any]
            },
        ]
        extra.forEach { payload[$0.key] = $0.value }
        return payload
    }

    private func serialize(sample: HKSample, definition: TypeDefinition) -> [String: Any]? {
        let sourceRevision = sample.sourceRevision
        let source = sourceRevision.source
        let sourceBundleIdentifier = source.bundleIdentifier
        let sampleTimeZone = (sample.metadata?[HKMetadataKeyTimeZone] as? String).flatMap { TimeZone(identifier: $0) } ?? TimeZone.current
        var metadata: [String: String] = [:]
        sample.metadata?.forEach { key, value in
            metadata["healthkit.\(key)"] = String(describing: value)
        }

        var sourceMetadata: [String: Any] = [
            "name": source.name,
            "bundleIdentifier": sourceBundleIdentifier,
            "provider": provider(sourceName: source.name, bundleIdentifier: sourceBundleIdentifier),
        ]
        if let version = sourceRevision.version { sourceMetadata["version"] = version }
        if let productType = sourceRevision.productType { sourceMetadata["productType"] = productType }

        var record: [String: Any] = [
            "uuid": sample.uuid.uuidString,
            "typeIdentifier": definition.identifier,
            "sampleType": definition.displayName,
            "startDate": iso8601(sample.startDate),
            "endDate": iso8601(sample.endDate),
            "localDate": localDate(sample.startDate, timeZone: sampleTimeZone),
            "timeZone": sampleTimeZone.identifier,
            "source": sourceMetadata,
            "metadata": metadata,
        ]

        if let device = sample.device {
            var deviceMetadata: [String: Any] = [:]
            if let value = device.name { deviceMetadata["name"] = value }
            if let value = device.manufacturer { deviceMetadata["manufacturer"] = value }
            if let value = device.model { deviceMetadata["model"] = value }
            if let value = device.hardwareVersion { deviceMetadata["hardwareVersion"] = value }
            if let value = device.firmwareVersion { deviceMetadata["firmwareVersion"] = value }
            if let value = device.softwareVersion { deviceMetadata["softwareVersion"] = value }
            if let value = device.localIdentifier { deviceMetadata["localIdentifier"] = value }
            if let value = device.udiDeviceIdentifier { deviceMetadata["udiDeviceIdentifier"] = value }
            if !deviceMetadata.isEmpty { record["device"] = deviceMetadata }
        }

        switch definition {
        case .quantity:
            guard let quantitySample = sample as? HKQuantitySample else { return nil }
            record["value"] = ["kind": "quantity", "value": quantitySample.quantity.doubleValue(for: HKUnit.degreeCelsius()), "unit": "Cel"]
        case .category:
            guard let categorySample = sample as? HKCategorySample else { return nil }
            record["categoryValue"] = categorySample.value
            record["value"] = categoryValue(categorySample.value, identifier: definition.identifier)
        }

        return record
    }

    private func categoryValue(_ value: Int, identifier: String) -> [String: Any] {
        let label: String
        if identifier == HKCategoryTypeIdentifier.sleepAnalysis.rawValue {
            switch value {
            case HKCategoryValueSleepAnalysis.inBed.rawValue: label = "in-bed"
            case HKCategoryValueSleepAnalysis.awake.rawValue: label = "awake"
            case HKCategoryValueSleepAnalysis.asleep.rawValue: label = "asleep-unspecified"
            case 3: label = "asleep-core"
            case 4: label = "asleep-deep"
            case 5: label = "asleep-rem"
            default: label = "sleep-category-\(value)"
            }
        } else if identifier == HKCategoryTypeIdentifier.menstrualFlow.rawValue {
            switch value {
            case 1: label = "unspecified"
            case 2: label = "light"
            case 3: label = "medium"
            case 4: label = "heavy"
            case 5: label = "none"
            default: label = "menstrual-flow-\(value)"
            }
        } else if identifier == HKCategoryTypeIdentifier.cervicalMucusQuality.rawValue {
            switch value {
            case 1: label = "dry"
            case 2: label = "sticky"
            case 3: label = "creamy"
            case 4: label = "watery"
            case 5: label = "egg-white"
            default: label = "cervical-mucus-\(value)"
            }
        } else if identifier == HKCategoryTypeIdentifier.ovulationTestResult.rawValue {
            switch value {
            case 1: label = "negative"
            case 2: label = "luteinizing-hormone-surge"
            case 3: label = "indeterminate"
            case 4: label = "estrogen-surge"
            default: label = "ovulation-test-\(value)"
            }
        } else {
            label = "sexual-activity-recorded"
        }
        return ["kind": identifier == HKCategoryTypeIdentifier.sexualActivity.rawValue ? "boolean" : "category", "value": identifier == HKCategoryTypeIdentifier.sexualActivity.rawValue ? true : label, "unit": identifier == HKCategoryTypeIdentifier.sexualActivity.rawValue ? "boolean" : "category"]
    }

    private func provider(sourceName: String, bundleIdentifier: String) -> String {
        let source = "\(sourceName) \(bundleIdentifier)".lowercased()
        if source.contains("tempdrop") { return "Tempdrop" }
        if source.contains("com.apple") || sourceName.lowercased().contains("apple") { return "Apple" }
        return "other source"
    }

    private func iso8601(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    private func localDate(_ date: Date, timeZone: TimeZone) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_CA")
        formatter.timeZone = timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }
}
