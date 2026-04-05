// IntentEngine.swift
// Pure Swift class that converts a raw query string into a ranked list of Predictions.
// Runs synchronously on every keystroke - no async, no I/O.
//
// Priority order:
//   1. URL detection (explicit schemes, known TLDs, history prefixes)
//   2. App matching (fuzzy/contains against AppIndexer)
//   3. Prompt fallback (query length > 2 with no strong match)

import Foundation

// MARK: - Prediction

/// A single autocomplete suggestion produced by IntentEngine.
struct Prediction: Identifiable {
    let id: UUID = UUID()
    /// The kind of action this prediction represents.
    let type: PredictionType
    /// Label shown in the dropdown row.
    let label: String
    /// The resolved value - a URL string, filesystem path, or prompt text.
    let value: String
    /// SF Symbol name used as the row icon.
    let iconName: String
}

/// The action category for a Prediction.
enum PredictionType {
    /// Navigate the browser pane to a URL.
    case url
    /// Launch or focus a macOS application.
    case app
    /// Send the text as an AI prompt.
    case prompt
}

// MARK: - HistoryStore protocol

/// Minimal interface IntentEngine needs from the history layer.
/// Keeps IntentEngine testable without a real SwiftData stack.
protocol HistoryStoreProtocol {
    /// URLs recently visited, newest-first.
    var recentURLs: [String] { get }
}

// MARK: - IntentEngine

/// Converts a raw query string into a ranked list of Predictions.
/// Accepts dependencies via init for testability.
final class IntentEngine {

    // MARK: - Dependencies

    private let appIndexer: AppIndexer
    private let historyStore: HistoryStoreProtocol?

    // MARK: - Constants

    /// TLDs considered valid for URL detection without an explicit scheme.
    private static let knownTLDs: Set<String> = [
        "com", "org", "net", "io", "dev", "co", "app", "ai",
        "edu", "gov", "uk", "ca", "de", "fr", "jp", "au"
    ]

    /// Short domain prefixes that map to well-known full domains.
    /// Used to suggest completions when the user types a prefix with no dot yet.
    private static let domainShortcuts: [String: String] = [
        "git":      "github.com",
        "gh":       "github.com",
        "yt":       "youtube.com",
        "reddit":   "reddit.com",
        "r/":       "reddit.com/r/",
        "twitter":  "twitter.com",
        "x":        "x.com",
        "gpt":      "chat.openai.com",
        "claude":   "claude.ai",
        "figma":    "figma.com",
        "notion":   "notion.so",
        "linear":   "linear.app",
        "slack":    "slack.com",
        "vercel":   "vercel.com",
        "supabase": "supabase.com",
    ]

    // MARK: - Init

    /// - Parameters:
    ///   - appIndexer: Pre-warmed app index for app-launch predictions.
    ///   - historyStore: Optional URL history for recency-weighted URL suggestions.
    init(appIndexer: AppIndexer, historyStore: HistoryStoreProtocol? = nil) {
        self.appIndexer = appIndexer
        self.historyStore = historyStore
    }

    // MARK: - Public API

    /// Produces a ranked list of predictions for the given query.
    /// Runs synchronously - safe to call on the main thread per keystroke.
    ///
    /// - Parameter query: The current text in the SmartBar.
    /// - Returns: Up to 5 predictions, sorted by confidence.
    func predict(query: String) -> [Prediction] {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return [] }

        var results: [Prediction] = []

        // 1. URL detection - highest priority.
        if let urlPrediction = detectURL(in: trimmed) {
            results.append(urlPrediction)
        }

        // 2. History matches (URL type, recency-weighted).
        let historyMatches = matchHistory(query: trimmed)
        results.append(contentsOf: historyMatches)

        // 3. App matches - up to 3.
        let appMatches = matchApps(query: trimmed)
        results.append(contentsOf: appMatches)

        // 4. Domain shortcut expansion.
        if results.isEmpty, let shortcutPrediction = expandShortcut(query: trimmed) {
            results.append(shortcutPrediction)
        }

        // 5. Prompt fallback - only when no confident URL or app match exists.
        let hasStrongMatch = results.contains { $0.type == .url || $0.type == .app }
        if !hasStrongMatch, trimmed.count > 2 {
            results.append(makePromptPrediction(for: trimmed))
        } else if trimmed.count > 2 {
            // Always offer prompt as the last option so the user can override.
            results.append(makePromptPrediction(for: trimmed))
        }

        // Deduplicate by value and cap at 5.
        var seen = Set<String>()
        let unique = results.filter { seen.insert($0.value).inserted }
        return Array(unique.prefix(5))
    }

    // MARK: - URL detection

    /// Returns a .url Prediction if the query looks like a URL.
    private func detectURL(in query: String) -> Prediction? {
        // Explicit scheme - user already typed http:// or https://.
        if query.hasPrefix("http://") || query.hasPrefix("https://") {
            let resolved = query.hasPrefix("http://") || query.hasPrefix("https://") ? query : "https://\(query)"
            return Prediction(
                type: .url,
                label: resolved,
                value: resolved,
                iconName: "globe"
            )
        }

        // Check for a dot and known TLD (e.g. "github.com", "vercel.app").
        if let tldMatch = extractTLD(from: query), Self.knownTLDs.contains(tldMatch) {
            let resolved = "https://\(query)"
            return Prediction(
                type: .url,
                label: query,
                value: resolved,
                iconName: "globe"
            )
        }

        return nil
    }

    /// Extracts the last path component after the final dot in a host portion.
    /// Returns nil if the query contains spaces or looks like plain prose.
    private func extractTLD(from query: String) -> String? {
        // Reject multi-word input early.
        guard !query.contains(" ") else { return nil }
        // Strip a trailing path (e.g. "github.com/user/repo") to get the host.
        let host = query.components(separatedBy: "/").first ?? query
        guard let dotIndex = host.lastIndex(of: ".") else { return nil }
        let tld = String(host[host.index(after: dotIndex)...]).lowercased()
        // TLDs are between 2 and 6 characters.
        guard (2...6).contains(tld.count) else { return nil }
        return tld
    }

    // MARK: - History matching

    /// Returns URL predictions for recent history entries that contain the query.
    private func matchHistory(query: String) -> [Prediction] {
        guard let store = historyStore else { return [] }
        let lowered = query.lowercased()
        return store.recentURLs
            .filter { $0.lowercased().contains(lowered) }
            .prefix(2)
            .map { urlString in
                Prediction(
                    type: .url,
                    label: urlString,
                    value: urlString,
                    iconName: "clock.arrow.circlepath"
                )
            }
    }

    // MARK: - App matching

    /// Returns up to 3 app predictions for the given query.
    private func matchApps(query: String) -> [Prediction] {
        return appIndexer.search(query: query)
            .prefix(3)
            .map { app in
                Prediction(
                    type: .app,
                    label: app.name,
                    value: app.path,
                    iconName: "app.badge"
                )
            }
    }

    // MARK: - Shortcut expansion

    /// Expands a known short alias to a full URL prediction.
    private func expandShortcut(query: String) -> Prediction? {
        let lowered = query.lowercased().trimmingCharacters(in: .whitespaces)
        for (prefix, domain) in Self.domainShortcuts {
            if lowered == prefix || lowered.hasPrefix(prefix + " ") {
                let resolved = "https://\(domain)"
                return Prediction(
                    type: .url,
                    label: domain,
                    value: resolved,
                    iconName: "arrow.up.right.square"
                )
            }
        }
        return nil
    }

    // MARK: - Prompt fallback

    /// Builds a generic "Ask AI" prediction for treating the input as a prompt.
    private func makePromptPrediction(for query: String) -> Prediction {
        Prediction(
            type: .prompt,
            label: "Ask AI: \"\(query)\"",
            value: query,
            iconName: "bubble.left.and.bubble.right"
        )
    }
}
