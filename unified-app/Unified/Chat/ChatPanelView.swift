// ChatPanelView.swift
// The persistent chat surface displayed below the SmartBar.
// Renders the full conversation history as a scrollable list of MessageBubble
// views, auto-scrolls to the latest message when new content arrives, and
// shows a three-dot typing indicator while a streaming response is in-flight.
//
// Input is NOT handled here - prompts are submitted via the SmartBar and
// routed to ChatService externally. This view is purely presentational.

import SwiftUI

// MARK: - Typing Indicator

/// Three animated dots that pulse in sequence to indicate a pending response.
private struct TypingIndicator: View {

    /// Drives the animation phase for each dot (0.0 - 1.0).
    @State private var phase: Double = 0

    var body: some View {
        HStack(spacing: 5) {
            ForEach(0..<3, id: \.self) { index in
                Circle()
                    .fill(Color.white.opacity(0.6))
                    .frame(width: 7, height: 7)
                    // Each dot lags behind the previous one by 0.2s.
                    .scaleEffect(dotScale(for: index))
                    .animation(
                        .easeInOut(duration: 0.5)
                            .repeatForever(autoreverses: true)
                            .delay(Double(index) * 0.2),
                        value: phase
                    )
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(Color(hex: "#2a2a2a"))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .onAppear { phase = 1 }
    }

    /// Returns the scale factor for dot `index` based on the current animation phase.
    private func dotScale(for index: Int) -> CGFloat {
        phase > 0 ? 1.35 : 0.75
    }
}

// MARK: - Empty State

/// Shown when there are no messages yet.
private struct EmptyStateView: View {
    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: "bubble.left.and.bubble.right")
                .font(.system(size: 32))
                .foregroundStyle(Color.white.opacity(0.2))

            Text("Type a question in the bar above")
                .font(.system(size: 14))
                .foregroundStyle(Color.white.opacity(0.3))
        }
    }
}

// MARK: - ChatPanelView

/// The main scrollable chat surface.
/// Consumes `AppState` from the environment and renders the message list.
struct ChatPanelView: View {

    @Environment(AppState.self) private var appState

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                Color(hex: "#111111").ignoresSafeArea()

                if appState.chatMessages.isEmpty && !appState.isLoading {
                    EmptyStateView()
                } else {
                    messageList(containerWidth: proxy.size.width)
                }
            }
        }
    }

    // MARK: - Message List

    /// Scrollable list of all message bubbles plus the typing indicator.
    @ViewBuilder
    private func messageList(containerWidth: CGFloat) -> some View {
        ScrollViewReader { scrollProxy in
            ScrollView(.vertical, showsIndicators: false) {
                LazyVStack(alignment: .leading, spacing: 10) {
                    ForEach(appState.chatMessages) { message in
                        MessageBubble(message: message)
                            // Limit bubble width to 80% of the panel.
                            .frame(maxWidth: containerWidth * 0.8,
                                   alignment: message.role == .user ? .trailing : .leading)
                            .frame(maxWidth: .infinity,
                                   alignment: message.role == .user ? .trailing : .leading)
                    }

                    if appState.isLoading {
                        HStack {
                            TypingIndicator()
                            Spacer()
                        }
                        .id("typing-indicator")
                    }

                    // Invisible anchor at the bottom for auto-scroll.
                    Color.clear
                        .frame(height: 1)
                        .id("bottom-anchor")
                }
                .padding(.horizontal, 16)
                .padding(.top, 16)
                .padding(.bottom, 120) // Room for the SmartBar at the bottom
            }
            // Auto-scroll when new messages arrive or loading state changes.
            .onChange(of: appState.chatMessages.count) { _, _ in
                scrollToBottom(proxy: scrollProxy)
            }
            .onChange(of: appState.isLoading) { _, newValue in
                if newValue {
                    scrollToBottom(proxy: scrollProxy)
                }
            }
            // Also scroll when the last message's content grows (streaming).
            .onChange(of: appState.chatMessages.last?.content) { _, _ in
                scrollToBottom(proxy: scrollProxy, animated: false)
            }
        }
    }

    // MARK: - Scroll Helper

    /// Scrolls the list to the bottom anchor.
    /// - Parameters:
    ///   - proxy: The `ScrollViewProxy` used to programmatically scroll.
    ///   - animated: Pass `false` for high-frequency streaming updates to avoid
    ///               queuing too many animations.
    private func scrollToBottom(proxy: ScrollViewProxy, animated: Bool = true) {
        if animated {
            withAnimation(.easeOut(duration: 0.25)) {
                proxy.scrollTo("bottom-anchor", anchor: .bottom)
            }
        } else {
            proxy.scrollTo("bottom-anchor", anchor: .bottom)
        }
    }
}

// MARK: - Preview

#Preview {
    let appState = AppState()
    appState.chatMessages = [
        ChatMessage(role: .user, content: "What is **SwiftUI**?"),
        ChatMessage(role: .assistant, content: "SwiftUI is Apple's *declarative* UI framework.\n\nHere is a quick example:\n\n```swift\nText(\"Hello, world!\")\n    .font(.title)\n    .padding()\n```\n\nIt works across all Apple platforms."),
        ChatMessage(role: .user, content: "How do I make an `@Observable` class?"),
    ]
    appState.isLoading = true

    return ChatPanelView()
        .environment(appState)
        .frame(width: 480, height: 600)
}
