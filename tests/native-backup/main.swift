import Foundation

let library = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
try FileManager.default.createDirectory(at: library, withIntermediateDirectories: false)
defer { try? FileManager.default.removeItem(at: library) }
let unrelated = library.appendingPathComponent("unrelated.txt")
try Data("retain unrelated".utf8).write(to: unrelated)
try EquanimityBackupSafety.excludeWebKitStorage(library: library)
let webkit = library.appendingPathComponent("WebKit", isDirectory: true)
let record = webkit.appendingPathComponent("test-checkpoint.txt")
try Data("retain checkpoint".utf8).write(to: record)
try EquanimityBackupSafety.excludeWebKitStorage(library: library)
let excluded = try webkit.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup
let checkpoint = try Data(contentsOf: record)
let untouched = try Data(contentsOf: unrelated)
precondition(excluded == true)
precondition(checkpoint == Data("retain checkpoint".utf8))
precondition(untouched == Data("retain unrelated".utf8))
let foreignLibrary = library.appendingPathComponent("foreign", isDirectory: true)
try FileManager.default.createDirectory(at: foreignLibrary, withIntermediateDirectories: false)
try FileManager.default.createSymbolicLink(at: foreignLibrary.appendingPathComponent("WebKit"), withDestinationURL: webkit)
do {
    try EquanimityBackupSafety.excludeWebKitStorage(library: foreignLibrary)
    fatalError("Must reject symbolic links")
} catch { /* expected: no touching the link target */ }
print("Native backup exclusion: creation, readback, idempotence, retained data and symlink guard passed.")
