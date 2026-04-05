// ChatService.swift
// Handles streaming Anthropic Claude API calls using async/await + URLSession.
// Reads the API key from AppState (which loads from UserDefaults or env var).

import Foundation
import Observation

// MARK: - API Payload Types

private struct APIMessage: Encodable {
    let role: String
    let content: String
}

private struct MessagesRequestBody: Encodable {
    let model: String
    let max_tokens: Int
    let stream: Bool
    let messages: [APIMessage]
}

// MARK: - SSE Delta Types

private struct SSEEvent: Decodable {
    let type: String
    let delta: SSEDelta?
    let index: Int?
}

private struct SSEDelta: Decodable {
    let type: String?
    let text: String?
}

// MARK: - ChatService

@Observable
final class ChatService {

    private let apiURL = URL(string: "https://api.anthropic.com/v1/messages")!
    private let model = "claude-sonnet-4-20250514"
    private let maxTokens = 4096
    private let anthropicVersion = "2023-06-01"

    // MARK: - API Key Resolution

    private func resolvedAPIKey(from appState: AppState) throws -> String {
        // First check AppState (loaded from UserDefaults or env).
        if !appState.apiKey.isEmpty {
            return appState.apiKey
        }
        // Fallback to env var directly.
        if let envKey = ProcessInfo.processInfo.environment["ANTHROPIC_API_KEY"],
           !envKey.isEmpty {
            return envKey
        }
        // Fallback to UserDefaults directly.
        if let stored = UserDefaults.standard.string(forKey: "anthropic_api_key"),
           !stored.isEmpty {
            return stored
        }
        throw ChatServiceError.missingAPIKey
    }

    // MARK: - Send Message

    func sendMessage(messages: [ChatMessage], appState: AppState) async {
        guard !appState.isLoading else { return }

        appState.isLoading = true

        let assistantMessage = ChatMessage(role: .assistant, content: "")
        appState.chatMessages.append(assistantMessage)
        let assistantID = assistantMessage.id

        do {
            let apiKey = try resolvedAPIKey(from: appState)
            let request = try buildRequest(messages: messages, apiKey: apiKey)

            let (bytes, response) = try await URLSession.shared.bytes(for: request)

            guard let httpResponse = response as? HTTPURLResponse else {
                throw ChatServiceError.invalidResponse
            }

            guard (200...299).contains(httpResponse.statusCode) else {
                // Try to read error body.
                var errorBody = ""
                for try await line in bytes.lines {
                    errorBody += line
                    if errorBody.count > 500 { break }
                }
                throw ChatServiceError.httpError(statusCode: httpResponse.statusCode, body: errorBody)
            }

            for try await line in bytes.lines {
                guard line.hasPrefix("data: ") else { continue }
                let jsonString = String(line.dropFirst(6))

                if jsonString == "[DONE]" { break }

                guard let jsonData = jsonString.data(using: .utf8) else { continue }

                let event: SSEEvent
                do {
                    event = try JSONDecoder().decode(SSEEvent.self, from: jsonData)
                } catch {
                    continue
                }

                guard event.type == "content_block_delta",
                      event.delta?.type == "text_delta",
                      let text = event.delta?.text,
                      !text.isEmpty
                else { continue }

                appendDelta(text, toMessageID: assistantID, in: appState)
            }

        } catch {
            let description = userFacingError(error)
            replaceContent(description, forMessageID: assistantID, in: appState)

            // If key is missing, trigger the prompt.
            if case ChatServiceError.missingAPIKey = error {
                appState.showAPIKeyPrompt = true
            }
        }

        appState.isLoading = false
    }

    // MARK: - Request Builder

    private func buildRequest(messages: [ChatMessage], apiKey: String) throws -> URLRequest {
        var request = URLRequest(url: apiURL)
        request.httpMethod = "POST"
        request.setValue(apiKey, forHTTPHeaderField: "x-api-key")
        request.setValue(anthropicVersion, forHTTPHeaderField: "anthropic-version")
        request.setValue("application/json", forHTTPHeaderField: "content-type")

        let apiMessages = messages.map { msg in
            APIMessage(role: msg.role.rawValue, content: msg.content)
        }

        let body = MessagesRequestBody(
            model: model,
            max_tokens: maxTokens,
            stream: true,
            messages: apiMessages
        )

        request.httpBody = try JSONEncoder().encode(body)
        return request
    }

    // MARK: - State Mutation Helpers

    private func appendDelta(_ text: String, toMessageID id: UUID, in appState: AppState) {
        guard let idx = appState.chatMessages.firstIndex(where: { $0.id == id }) else { return }
        appState.chatMessages[idx].content += text
    }

    private func replaceContent(_ text: String, forMessageID id: UUID, in appState: AppState) {
        guard let idx = appState.chatMessages.firstIndex(where: { $0.id == id }) else { return }
        appState.chatMessages[idx].content = text
    }

    // MARK: - Error Formatting

    private func userFacingError(_ error: Error) -> String {
        if let chatError = error as? ChatServiceError {
            switch chatError {
            case .missingAPIKey:
                return "No API key set. Please enter your Anthropic API key."
            case .invalidResponse:
                return "Received an unexpected response from the Anthropic API."
            case .httpError(let code, let body):
                if code == 401 {
                    return "Invalid API key (401). Please check your key and try again."
                }
                return "Anthropic API returned HTTP \(code). \(body.prefix(200))"
            }
        }
        return "An error occurred: \(error.localizedDescription)"
    }
}

// MARK: - Error Types

private enum ChatServiceError: Error {
    case missingAPIKey
    case invalidResponse
    case httpError(statusCode: Int, body: String)
}
