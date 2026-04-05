// SmartBarView.swift
// Always-visible bar near the bottom that acts as the unified command surface.
// Wraps an AppKit NSTextField via NSViewRepresentable for low-latency keystroke handling.
// On each keystroke, asks IntentEngine for predictions and displays an autocomplete dropdown.
// Enter routes to browser, app launcher, or chat depending on the selected prediction type.
// Visual design: Dia-style centered pill bar with frosted glass feel and minimal dropdown.

import AppKit
import SwiftUI

// MARK: - SmartBarView

/// The top-level SmartBar component. Renders a centered pill-shaped search bar and,
/// when predictions are available, a floating autocomplete dropdown anchored above the bar.
struct SmartBarView: View {

    @Environment(AppState.self) private var appState
    let intentEngine: IntentEngine
    private let windowEmbedder = AppWindowEmbedder()

    // Maximum width for the bar and dropdown - matches Dia's centered compact layout.
    private let maxBarWidth: CGFloat = 680

    var body: some View {
        @Bindable var state = appState

        HStack {
            Spacer()

            VStack(spacing: 0) {
                // Autocomplete dropdown - shown above the bar when predictions exist.
                if !appState.predictions.isEmpty {
                    PredictionDropdown(
                        predictions: appState.predictions,
                        selectedIndex: appState.selectedPredictionIndex,
                        onSelect: commitPrediction
                    )
                    .frame(maxWidth: maxBarWidth)
                    .transition(
                        .asymmetric(
                            insertion: .opacity.combined(with: .scale(scale: 0.97, anchor: .bottom)),
                            removal: .opacity.combined(with: .scale(scale: 0.97, anchor: .bottom))
                        )
                    )
                    .padding(.bottom, 6)
                }

                // The pill bar itself.
                ZStack {
                    // Base: frosted glass material with a subtle border.
                    RoundedRectangle(cornerRadius: 22)
                        .fill(.ultraThinMaterial)
                        .overlay(
                            RoundedRectangle(cornerRadius: 22)
                                .stroke(Color.white.opacity(0.08), lineWidth: 1)
                        )
                        .shadow(color: .black.opacity(0.35), radius: 20, x: 0, y: 6)

                    HStack(spacing: 10) {
                        // Magnifying glass icon on the left.
                        Image(systemName: "magnifyingglass")
                            .font(.system(size: 14, weight: .regular))
                            .foregroundStyle(Color.white.opacity(0.35))

                        SmartBarTextField(
                            text: $state.smartBarText,
                            onTextChange: handleTextChange,
                            onCommit: handleCommit,
                            onEscape: handleEscape,
                            onArrowUp: { navigatePrediction(by: -1) },
                            onArrowDown: { navigatePrediction(by: 1) }
                        )
                    }
                    .padding(.horizontal, 16)
                }
                .frame(maxWidth: maxBarWidth)
                .frame(height: 44)
            }

            Spacer()
        }
        .animation(.spring(response: 0.22, dampingFraction: 0.82), value: appState.predictions.count)
    }

    // MARK: - Handlers

    /// Called on every keystroke - updates predictions via IntentEngine.
    private func handleTextChange(_ text: String) {
        appState.smartBarText = text
        let predictions = intentEngine.predict(query: text)
        appState.predictions = predictions
        appState.selectedPredictionIndex = 0
    }

    /// Called when the user presses Enter.
    private func handleCommit() {
        if !appState.predictions.isEmpty {
            let index = appState.selectedPredictionIndex
            let safeIndex = max(0, min(index, appState.predictions.count - 1))
            commitPrediction(appState.predictions[safeIndex])
        } else {
            // No predictions - treat raw text as a prompt if non-empty.
            let text = appState.smartBarText.trimmingCharacters(in: .whitespaces)
            if !text.isEmpty {
                sendPrompt(text)
            }
            clearBar()
        }
    }

    /// Called when the user presses Escape.
    private func handleEscape() {
        clearBar()
    }

    /// Moves the highlighted prediction index by delta, clamped to valid range.
    private func navigatePrediction(by delta: Int) {
        let count = appState.predictions.count
        guard count > 0 else { return }
        let next = appState.selectedPredictionIndex + delta
        appState.selectedPredictionIndex = max(0, min(next, count - 1))
    }

    // MARK: - Routing

    /// Routes the selected prediction to the appropriate subsystem.
    private func commitPrediction(_ prediction: Prediction) {
        switch prediction.type {
        case .url:
            if let url = URL(string: prediction.value) {
                // Dismiss any embedded app and switch to browser view.
                if appState.isShowingEmbeddedApp {
                    windowEmbedder.release(appState: appState)
                }
                appState.navigateTo(url: url)
            }

        case .app:
            // Dismiss any current browser page, then embed the app on the left side.
            appState.currentURL = nil
            appState.pageTitle = ""

            windowEmbedder.embedApp(
                path: prediction.value,
                appState: appState
            )

        case .prompt:
            sendPrompt(prediction.value)
        }
        clearBar()
    }

    /// Appends a user message to chatMessages for the chat surface to consume.
    private func sendPrompt(_ text: String) {
        let message = ChatMessage(role: .user, content: text)
        appState.chatMessages.append(message)
    }

    /// Resets the bar and dropdown to a clean state.
    private func clearBar() {
        appState.smartBarText = ""
        appState.predictions = []
        appState.selectedPredictionIndex = 0
    }
}

// MARK: - PredictionDropdown

/// Floating dropdown listing up to 5 autocomplete predictions above the SmartBar.
/// No dividers - uses consistent vertical spacing instead for a cleaner Dia-like feel.
private struct PredictionDropdown: View {

    let predictions: [Prediction]
    let selectedIndex: Int
    let onSelect: (Prediction) -> Void

    var body: some View {
        VStack(spacing: 1) {
            ForEach(Array(predictions.enumerated()), id: \.element.id) { index, prediction in
                PredictionRow(
                    prediction: prediction,
                    isSelected: index == selectedIndex
                )
                .onTapGesture { onSelect(prediction) }
            }
        }
        .padding(.vertical, 6)
        .background(
            RoundedRectangle(cornerRadius: 14)
                .fill(Color(hex: "#1c1c1e").opacity(0.96))
                .overlay(
                    RoundedRectangle(cornerRadius: 14)
                        .stroke(Color.white.opacity(0.07), lineWidth: 1)
                )
                .shadow(color: .black.opacity(0.55), radius: 28, x: 0, y: 8)
        )
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }
}

// MARK: - PredictionRow

/// A single row inside the PredictionDropdown.
/// Layout: icon - label - spacer - type pill tag.
private struct PredictionRow: View {

    let prediction: Prediction
    let isSelected: Bool

    var body: some View {
        HStack(spacing: 10) {
            // Leading icon.
            Image(systemName: prediction.iconName)
                .font(.system(size: 14, weight: .medium))
                .frame(width: 18, height: 18)
                .foregroundStyle(iconColor)

            // Label text.
            Text(prediction.label)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Color.white.opacity(0.88))
                .lineLimit(1)
                .truncationMode(.middle)

            Spacer()

            // Type pill tag replacing the old return arrow.
            TypePill(type: prediction.type)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(
            Group {
                if isSelected {
                    RoundedRectangle(cornerRadius: 8)
                        .fill(Color.white.opacity(0.05))
                        .padding(.horizontal, 6)
                } else {
                    Color.clear
                }
            }
        )
        .contentShape(Rectangle())
    }

    private var iconColor: Color {
        switch prediction.type {
        case .url:    return Color(hex: "#4A9EFF")
        case .app:    return Color(hex: "#34D399")
        case .prompt: return Color(hex: "#A78BFA")
        }
    }
}

// MARK: - TypePill

/// A small pill label showing the prediction category: URL, App, or AI.
private struct TypePill: View {

    let type: PredictionType

    var body: some View {
        Text(label)
            .font(.system(size: 9, weight: .semibold))
            .foregroundStyle(pillColor.opacity(0.75))
            .padding(.horizontal, 6)
            .padding(.vertical, 3)
            .background(
                Capsule()
                    .fill(pillColor.opacity(0.12))
            )
    }

    private var label: String {
        switch type {
        case .url:    return "URL"
        case .app:    return "App"
        case .prompt: return "AI"
        }
    }

    private var pillColor: Color {
        switch type {
        case .url:    return Color(hex: "#4A9EFF")
        case .app:    return Color(hex: "#34D399")
        case .prompt: return Color(hex: "#A78BFA")
        }
    }
}

// MARK: - SmartBarTextField (NSViewRepresentable)

/// Bridges an AppKit NSTextField into SwiftUI.
/// Uses a custom NSTextField subclass to intercept arrow keys, Escape, and Enter
/// before the default field editor consumes them.
struct SmartBarTextField: NSViewRepresentable {

    @Binding var text: String
    let onTextChange: (String) -> Void
    let onCommit: () -> Void
    let onEscape: () -> Void
    let onArrowUp: () -> Void
    let onArrowDown: () -> Void

    func makeNSView(context: Context) -> SmartBarNSTextField {
        let field = SmartBarNSTextField()
        field.delegate = context.coordinator
        field.placeholderString = "Search, browse, or ask..."
        field.isBordered = false
        field.isBezeled = false
        field.drawsBackground = false
        field.focusRingType = .none
        field.font = .systemFont(ofSize: 14, weight: .light)
        field.textColor = NSColor.white
        field.cell?.sendsActionOnEndEditing = false
        // Store coordinator reference for key callbacks.
        field.coordinator = context.coordinator
        // Become first responder on appear.
        DispatchQueue.main.async {
            field.window?.makeFirstResponder(field)
        }
        return field
    }

    func updateNSView(_ nsView: SmartBarNSTextField, context: Context) {
        // Only push down when the source of truth changed externally
        // (e.g. Escape cleared the bar) to avoid clobbering mid-keystroke input.
        if nsView.stringValue != text {
            nsView.stringValue = text
        }
        // Keep coordinator callbacks current.
        context.coordinator.onCommit = onCommit
        context.coordinator.onEscape = onEscape
        context.coordinator.onArrowUp = onArrowUp
        context.coordinator.onArrowDown = onArrowDown
        context.coordinator.onTextChange = onTextChange
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(
            onTextChange: onTextChange,
            onCommit: onCommit,
            onEscape: onEscape,
            onArrowUp: onArrowUp,
            onArrowDown: onArrowDown
        )
    }

    // MARK: Coordinator

    /// Acts as NSTextFieldDelegate and holds mutable callback references
    /// that the NSTextField subclass can invoke on special key events.
    final class Coordinator: NSObject, NSTextFieldDelegate {
        var onTextChange: (String) -> Void
        var onCommit: () -> Void
        var onEscape: () -> Void
        var onArrowUp: () -> Void
        var onArrowDown: () -> Void

        init(
            onTextChange: @escaping (String) -> Void,
            onCommit: @escaping () -> Void,
            onEscape: @escaping () -> Void,
            onArrowUp: @escaping () -> Void,
            onArrowDown: @escaping () -> Void
        ) {
            self.onTextChange = onTextChange
            self.onCommit = onCommit
            self.onEscape = onEscape
            self.onArrowUp = onArrowUp
            self.onArrowDown = onArrowDown
        }

        func controlTextDidChange(_ obj: Notification) {
            guard let field = obj.object as? NSTextField else { return }
            onTextChange(field.stringValue)
        }

        func control(_ control: NSControl, textView: NSTextView, doCommandBy commandSelector: Selector) -> Bool {
            if commandSelector == #selector(NSResponder.insertNewline(_:)) {
                onCommit()
                return true
            }
            if commandSelector == #selector(NSResponder.cancelOperation(_:)) {
                onEscape()
                return true
            }
            if commandSelector == #selector(NSResponder.moveUp(_:)) {
                onArrowUp()
                return true
            }
            if commandSelector == #selector(NSResponder.moveDown(_:)) {
                onArrowDown()
                return true
            }
            return false
        }
    }
}

// MARK: - SmartBarNSTextField

/// Custom NSTextField subclass that forwards special keys to its coordinator.
final class SmartBarNSTextField: NSTextField {

    weak var coordinator: SmartBarTextField.Coordinator?

    override func keyDown(with event: NSEvent) {
        switch event.keyCode {
        case 53: // Escape
            coordinator?.onEscape()
        case 125: // Arrow Down
            coordinator?.onArrowDown()
        case 126: // Arrow Up
            coordinator?.onArrowUp()
        case 36, 76: // Return / Enter (numpad)
            coordinator?.onCommit()
        default:
            super.keyDown(with: event)
        }
    }
}

// MARK: - Color hex helper

extension Color {
    /// Initialises a Color from a CSS-style hex string (e.g. "#1a1a1a" or "1a1a1a").
    init(hex: String) {
        let cleaned = hex.trimmingCharacters(in: .init(charactersIn: "#"))
        var value: UInt64 = 0
        Scanner(string: cleaned).scanHexInt64(&value)
        let r = Double((value >> 16) & 0xFF) / 255.0
        let g = Double((value >> 8) & 0xFF) / 255.0
        let b = Double(value & 0xFF) / 255.0
        self.init(red: r, green: g, blue: b)
    }
}
