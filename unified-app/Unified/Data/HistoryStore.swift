/**
 HistoryStore.swift
 Unified

 Observable store that owns all read/write access to URL and app-launch
 history persisted via SwiftData. Callers inject a ModelContext at init
 time so the store can be used from any scene or background task without
 coupling to a specific SwiftUI environment.

 Error handling: every SwiftData call is wrapped in a do/catch and logs
 failures to the console. The store never throws or crashes on a query
 error - it returns an empty result instead.
 */

import Foundation
import SwiftData
import os.log

private let logger = Logger(subsystem: "com.unified.app", category: "HistoryStore")

// MARK: - Scoring helpers (file-private)

/// Returns a value in [0, 1] that decays as `date` recedes into the past.
/// Uses a half-life of 7 days so a week-old entry scores ~0.5.
private func recencyFactor(for date: Date) -> Double {
    let halfLifeSeconds: Double = 7 * 24 * 3600
    let age = max(0, Date().timeIntervalSince(date))
    return pow(0.5, age / halfLifeSeconds)
}

/// Combined score used to rank URL history entries.
/// Higher visit counts and more recent dates both lift the score.
private func urlScore(_ entry: URLHistoryEntry) -> Double {
    Double(entry.visitCount) * recencyFactor(for: entry.lastVisited)
}

/// Extracts the registrable host (e.g. "github.com") from a raw URL string.
/// Returns nil when the string cannot be parsed as a URL with a host.
private func domain(from urlString: String) -> String? {
    guard
        let url = URL(string: urlString),
        let host = url.host
    else { return nil }
    return host
}

// MARK: - HistoryStore

/// Observable store for URL and app-launch history backed by SwiftData.
@Observable
final class HistoryStore {

    // The context is stored as a plain property; @Observable tracks access
    // automatically so callers will re-render when published state changes.
    private let context: ModelContext

    /// Creates the store with an injected SwiftData model context.
    init(context: ModelContext) {
        self.context = context
    }

    // MARK: - URL History

    /**
     Records a navigation to `url`, upserting the matching URLHistoryEntry.

     - If an entry for this URL already exists, its visitCount is incremented,
       lastVisited is updated, and (if non-empty) title is refreshed.
     - If no entry exists, a new one is inserted.

     - Parameters:
       - url: The absolute URL string that was visited.
       - title: The page title at the time of the visit; ignored when empty.
     */
    func recordVisit(url: String, title: String) {
        do {
            let existing = try fetchURLEntry(matching: url)
            if let entry = existing {
                entry.visitCount += 1
                entry.lastVisited = Date()
                if !title.isEmpty {
                    entry.title = title
                }
            } else {
                let entry = URLHistoryEntry(
                    urlString: url,
                    title: title,
                    visitCount: 1,
                    lastVisited: Date()
                )
                context.insert(entry)
            }
            try context.save()
        } catch {
            logger.error("recordVisit failed for \(url): \(error.localizedDescription)")
        }
    }

    /**
     Returns URL history entries whose urlString or title contains `query`,
     ranked by a recency-weighted visit-count score.

     - Parameters:
       - query: Free-text filter; an empty string returns all entries.
       - limit: Maximum number of results to return (default 5).
     - Returns: Matching entries sorted best-first, capped at `limit`.
     */
    func recentURLs(matching query: String, limit: Int = 5) -> [URLHistoryEntry] {
        do {
            var descriptor = FetchDescriptor<URLHistoryEntry>()

            if !query.isEmpty {
                let lower = query.lowercased()
                descriptor.predicate = #Predicate<URLHistoryEntry> { entry in
                    entry.urlString.localizedStandardContains(lower)
                    || entry.title.localizedStandardContains(lower)
                }
            }

            // Fetch a broader set and sort in memory so we can apply the
            // composite score without a custom sort descriptor.
            descriptor.fetchLimit = limit * 10

            let all = try context.fetch(descriptor)
            return Array(
                all.sorted { urlScore($0) > urlScore($1) }
                    .prefix(limit)
            )
        } catch {
            logger.error("recentURLs query failed: \(error.localizedDescription)")
            return []
        }
    }

    /**
     Returns the top 20 most-visited domains for autocomplete hints.

     Domains are derived from stored URL strings. The list is de-duplicated
     and sorted by aggregate visit count descending.

     - Returns: An array of host strings (e.g. ["github.com", "notion.so"]).
     */
    func topDomains() -> [String] {
        do {
            let descriptor = FetchDescriptor<URLHistoryEntry>()
            let all = try context.fetch(descriptor)

            // Aggregate visit counts per domain.
            var counts: [String: Int] = [:]
            for entry in all {
                guard let d = domain(from: entry.urlString) else { continue }
                counts[d, default: 0] += entry.visitCount
            }

            return counts
                .sorted { $0.value > $1.value }
                .prefix(20)
                .map(\.key)
        } catch {
            logger.error("topDomains query failed: \(error.localizedDescription)")
            return []
        }
    }

    // MARK: - App Launch History

    /**
     Records a launch of the app at `path`, upserting the matching AppLaunchEntry.

     - If an entry already exists for `path`, launchCount is incremented and
       lastLaunched is refreshed.
     - If no entry exists, a new one is inserted using the provided `name`.

     - Parameters:
       - name: The human-readable app name (e.g. "Slack").
       - path: The absolute path to the .app bundle.
     */
    func recordAppLaunch(name: String, path: String) {
        do {
            let existing = try fetchAppEntry(matching: path)
            if let entry = existing {
                entry.launchCount += 1
                entry.lastLaunched = Date()
                // Refresh name in case the app was renamed.
                entry.appName = name
            } else {
                let entry = AppLaunchEntry(
                    appName: name,
                    appPath: path,
                    launchCount: 1,
                    lastLaunched: Date()
                )
                context.insert(entry)
            }
            try context.save()
        } catch {
            logger.error("recordAppLaunch failed for \(path): \(error.localizedDescription)")
        }
    }

    /**
     Returns the most recently launched apps.

     - Parameter limit: Maximum number of results (default 10).
     - Returns: AppLaunchEntry values sorted by lastLaunched descending.
     */
    func recentApps(limit: Int = 10) -> [AppLaunchEntry] {
        do {
            var descriptor = FetchDescriptor<AppLaunchEntry>(
                sortBy: [SortDescriptor(\.lastLaunched, order: .reverse)]
            )
            descriptor.fetchLimit = limit
            return try context.fetch(descriptor)
        } catch {
            logger.error("recentApps query failed: \(error.localizedDescription)")
            return []
        }
    }

    // MARK: - Private fetch helpers

    /// Fetches the single URLHistoryEntry whose urlString exactly matches `url`.
    private func fetchURLEntry(matching url: String) throws -> URLHistoryEntry? {
        var descriptor = FetchDescriptor<URLHistoryEntry>(
            predicate: #Predicate { $0.urlString == url }
        )
        descriptor.fetchLimit = 1
        return try context.fetch(descriptor).first
    }

    /// Fetches the single AppLaunchEntry whose appPath exactly matches `path`.
    private func fetchAppEntry(matching path: String) throws -> AppLaunchEntry? {
        var descriptor = FetchDescriptor<AppLaunchEntry>(
            predicate: #Predicate { $0.appPath == path }
        )
        descriptor.fetchLimit = 1
        return try context.fetch(descriptor).first
    }
}
