/**
 Models.swift
 Unified

 Shared data types used across the app: predictions for the smart bar,
 chat messages for the AI panel, and SwiftData persistent models for
 URL and app-launch history.
 */

import Foundation
import SwiftData

// NOTE: Prediction and PredictionType are defined in SmartBar/IntentEngine.swift.

// MARK: - Chat Messages

/// Identifies which participant authored a chat message.
enum MessageRole: String, Codable {
    case user
    case assistant
}

/// A single turn in an AI chat conversation.
struct ChatMessage: Identifiable, Equatable {
    let id: UUID
    let role: MessageRole

    /// The text content of the message; mutable so streaming can append tokens.
    var content: String
    let timestamp: Date

    init(
        id: UUID = UUID(),
        role: MessageRole,
        content: String,
        timestamp: Date = Date()
    ) {
        self.id = id
        self.role = role
        self.content = content
        self.timestamp = timestamp
    }
}

// MARK: - SwiftData Persistent Models

/// Persisted record of a URL the user has navigated to.
@Model
class URLHistoryEntry {
    var urlString: String
    var title: String
    var visitCount: Int
    var lastVisited: Date

    init(
        urlString: String,
        title: String = "",
        visitCount: Int = 1,
        lastVisited: Date = Date()
    ) {
        self.urlString = urlString
        self.title = title
        self.visitCount = visitCount
        self.lastVisited = lastVisited
    }
}

/// Persisted record of a macOS app the user has launched through the bar.
@Model
class AppLaunchEntry {
    var appName: String
    var appPath: String
    var launchCount: Int
    var lastLaunched: Date

    init(
        appName: String,
        appPath: String,
        launchCount: Int = 1,
        lastLaunched: Date = Date()
    ) {
        self.appName = appName
        self.appPath = appPath
        self.launchCount = launchCount
        self.lastLaunched = lastLaunched
    }
}
