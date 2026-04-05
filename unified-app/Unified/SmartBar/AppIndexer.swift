// AppIndexer.swift
// Scans /Applications and ~/Applications at launch, caches InstalledApp records,
// and tracks recently launched apps via NSWorkspace notifications for recency weighting.

import AppKit
import Foundation

// MARK: - InstalledApp

/// A lightweight record describing a macOS application found on disk.
struct InstalledApp: Identifiable {
    let id: UUID = UUID()
    /// Human-readable display name (bundle display name or filename without .app).
    let name: String
    /// Absolute filesystem path to the .app bundle.
    let path: String
    /// Bundle identifier extracted from Info.plist, if present.
    let bundleIdentifier: String?
}

// MARK: - AppIndexer

/// Scans the standard application directories and maintains an in-memory index of
/// installed apps. Provides fast case-insensitive search and recency tracking.
@Observable
final class AppIndexer {

    /// Full list of installed apps discovered at launch.
    private(set) var installedApps: [InstalledApp] = []

    /// Bundle identifiers of recently launched apps, ordered newest-first.
    private(set) var recentlyLaunchedBundleIDs: [String] = []

    // Maximum number of recent app entries to track.
    private let maxRecentCount = 20

    // Observation token for the workspace notification.
    private var notificationObserver: NSObjectProtocol?

    // MARK: - Init

    init() {
        installedApps = Self.scanApplicationDirectories()
        startObservingLaunches()
    }

    deinit {
        if let observer = notificationObserver {
            NSWorkspace.shared.notificationCenter.removeObserver(observer)
        }
    }

    // MARK: - Search

    /// Returns apps whose name contains the query string (case-insensitive).
    /// Results are sorted so recently launched apps appear first.
    ///
    /// - Parameter query: The search string typed by the user.
    /// - Returns: Matching InstalledApp records, recency-weighted.
    func search(query: String) -> [InstalledApp] {
        guard !query.isEmpty else { return [] }
        let lowered = query.lowercased()
        let matches = installedApps.filter { $0.name.lowercased().contains(lowered) }
        return matches.sorted { lhs, rhs in
            let lhsRecency = recencyScore(for: lhs)
            let rhsRecency = recencyScore(for: rhs)
            if lhsRecency != rhsRecency { return lhsRecency > rhsRecency }
            // Prefer prefix matches over mid-word matches.
            let lhsPrefix = lhs.name.lowercased().hasPrefix(lowered)
            let rhsPrefix = rhs.name.lowercased().hasPrefix(lowered)
            if lhsPrefix != rhsPrefix { return lhsPrefix }
            return lhs.name < rhs.name
        }
    }

    // MARK: - Private helpers

    /// Returns a recency score (higher = more recent) for sorting.
    private func recencyScore(for app: InstalledApp) -> Int {
        guard let bid = app.bundleIdentifier,
              let index = recentlyLaunchedBundleIDs.firstIndex(of: bid) else {
            return 0
        }
        // Newest entry is at index 0, give it the highest score.
        return maxRecentCount - index
    }

    /// Scans /Applications and ~/Applications, returning all .app bundles found.
    private static func scanApplicationDirectories() -> [InstalledApp] {
        let fm = FileManager.default
        let dirs = [
            URL(fileURLWithPath: "/Applications"),
            URL(fileURLWithPath: "/System/Applications"),
            URL(fileURLWithPath: "/System/Applications/Utilities"),
            fm.homeDirectoryForCurrentUser.appendingPathComponent("Applications"),
        ]

        var results: [InstalledApp] = []
        for directory in dirs {
            results.append(contentsOf: collectApps(in: directory, fileManager: fm))
        }
        return results
    }

    /// Recursively collects .app bundles one level deep inside a directory.
    private static func collectApps(
        in directory: URL,
        fileManager: FileManager
    ) -> [InstalledApp] {
        guard let contents = try? fileManager.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        ) else {
            return []
        }

        var apps: [InstalledApp] = []
        for url in contents where url.pathExtension == "app" {
            if let app = makeInstalledApp(from: url) {
                apps.append(app)
            }
        }
        return apps
    }

    /// Builds an InstalledApp by reading the bundle's Info.plist.
    private static func makeInstalledApp(from url: URL) -> InstalledApp? {
        let infoPlistURL = url.appendingPathComponent("Contents/Info.plist")
        var displayName: String
        var bundleID: String?

        if let plist = NSDictionary(contentsOf: infoPlistURL) {
            // Prefer CFBundleDisplayName, fall back to CFBundleName, then filename.
            if let name = plist["CFBundleDisplayName"] as? String, !name.isEmpty {
                displayName = name
            } else if let name = plist["CFBundleName"] as? String, !name.isEmpty {
                displayName = name
            } else {
                displayName = url.deletingPathExtension().lastPathComponent
            }
            bundleID = plist["CFBundleIdentifier"] as? String
        } else {
            displayName = url.deletingPathExtension().lastPathComponent
        }

        return InstalledApp(
            name: displayName,
            path: url.path,
            bundleIdentifier: bundleID
        )
    }

    /// Registers for NSWorkspace launch notifications to update recency tracking.
    private func startObservingLaunches() {
        notificationObserver = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didLaunchApplicationNotification,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let self else { return }
            if let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey]
                as? NSRunningApplication,
               let bundleID = app.bundleIdentifier {
                self.recordLaunch(bundleID: bundleID)
            }
        }
    }

    /// Inserts the bundle ID at the front of the recency list, deduplicating and capping.
    private func recordLaunch(bundleID: String) {
        recentlyLaunchedBundleIDs.removeAll { $0 == bundleID }
        recentlyLaunchedBundleIDs.insert(bundleID, at: 0)
        if recentlyLaunchedBundleIDs.count > maxRecentCount {
            recentlyLaunchedBundleIDs.removeLast()
        }
    }
}
