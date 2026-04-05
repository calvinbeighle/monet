// AppState.swift
// Shared observable application state for Unified.

import SwiftUI
import AppKit

@Observable
final class AppState {

    // Browser
    var currentURL: URL?
    var pageTitle: String = ""

    // Chat
    var chatMessages: [ChatMessage] = []
    var isLoading: Bool = false

    // SmartBar
    var smartBarText: String = ""
    var predictions: [Prediction] = []
    var selectedPredictionIndex: Int = 0

    // Layout
    var isChatCollapsed: Bool = false

    // Embedded app
    var embeddedApp: NSRunningApplication?
    var isShowingEmbeddedApp: Bool = false

    // API key
    var showAPIKeyPrompt: Bool = false
    var apiKey: String = ""

    init() {
        if let stored = UserDefaults.standard.string(forKey: "anthropic_api_key"), !stored.isEmpty {
            apiKey = stored
        } else if let envKey = ProcessInfo.processInfo.environment["ANTHROPIC_API_KEY"], !envKey.isEmpty {
            apiKey = envKey
            UserDefaults.standard.set(envKey, forKey: "anthropic_api_key")
        } else {
            showAPIKeyPrompt = true
        }
    }

    func saveAPIKey(_ key: String) {
        apiKey = key
        UserDefaults.standard.set(key, forKey: "anthropic_api_key")
        showAPIKeyPrompt = false
    }

    func navigateTo(url: URL) {
        dismissEmbeddedApp()
        currentURL = url
        smartBarText = url.absoluteString
        predictions = []
        selectedPredictionIndex = 0
    }

    func dismissEmbeddedApp() {
        embeddedApp = nil
        isShowingEmbeddedApp = false
        // Restore window level.
        if let window = NSApplication.shared.windows.first(where: { $0.isVisible }) {
            window.level = .normal
            window.backgroundColor = .black
        }
    }
}
