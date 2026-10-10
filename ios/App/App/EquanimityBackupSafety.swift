import Foundation

/// The persistent default WKWebsiteDataStore keeps IndexedDB/localStorage in
/// Library/WebKit (legacy WebsiteData and modern Default origin directories).
/// Exclude that app-private parent, not individual SQLite/WAL files or user keys.
/// Do not relocate storage, enumerate records, change data stores or delete data.
enum EquanimityBackupSafety {
    static func excludeWebKitStorage(library: URL) throws {
        var directory = library.appendingPathComponent("WebKit", isDirectory: true)
        let manager = FileManager.default
        var isDirectory: ObjCBool = false
        if manager.fileExists(atPath: directory.path, isDirectory: &isDirectory) {
            let values = try directory.resourceValues(forKeys: [.isSymbolicLinkKey])
            guard isDirectory.boolValue, values.isSymbolicLink != true else {
                throw CocoaError(.fileWriteInvalidFileName)
            }
        } else {
            try manager.createDirectory(at: directory, withIntermediateDirectories: false)
        }
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try directory.setResourceValues(values)
        guard try directory.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup == true else {
            throw CocoaError(.fileWriteUnknown)
        }
    }

    static func protectDeviceStorage() {
        do {
            let library = try FileManager.default.url(for: .libraryDirectory, in: .userDomainMask,
                appropriateFor: nil, create: false)
            try excludeWebKitStorage(library: library)
        } catch {
            // No filesystem paths, errors, account IDs or record contents.
            NSLog("[Equanimity] Device storage backup exclusion could not be verified.")
        }
    }
}
