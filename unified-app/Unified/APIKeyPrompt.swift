// APIKeyPrompt.swift
// Sheet that appears when no Anthropic API key is configured.
// User pastes their key, it gets saved to UserDefaults.

import SwiftUI

struct APIKeyPrompt: View {

    @Environment(AppState.self) private var appState
    @State private var keyInput: String = ""
    @State private var showError: Bool = false

    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: "key.fill")
                .font(.system(size: 36))
                .foregroundStyle(Color(hex: "#A78BFA"))

            Text("Anthropic API Key Required")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(.white)

            Text("Paste your API key to enable AI chat. You can get one from console.anthropic.com.")
                .font(.system(size: 13))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 340)

            SecureField("sk-ant-...", text: $keyInput)
                .textFieldStyle(.roundedBorder)
                .frame(width: 360)
                .onSubmit { saveKey() }

            if showError {
                Text("Please enter a valid API key starting with sk-")
                    .font(.system(size: 12))
                    .foregroundStyle(.red)
            }

            HStack(spacing: 12) {
                Button("Skip for now") {
                    appState.showAPIKeyPrompt = false
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)

                Button("Save Key") {
                    saveKey()
                }
                .buttonStyle(.borderedProminent)
                .disabled(keyInput.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(40)
        .frame(width: 440)
        .background(Color(hex: "#1a1a1a"))
    }

    private func saveKey() {
        let trimmed = keyInput.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else {
            showError = true
            return
        }
        appState.saveAPIKey(trimmed)
    }
}
