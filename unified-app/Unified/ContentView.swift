// ContentView.swift
// Root layout for Unified. Composes SmartBarView, BrowserPaneView, and ChatPanelView.

import SwiftUI

private enum Layout {
    static let browserFraction: CGFloat = 0.65
    static let collapsedChatWidth: CGFloat = 48
}

struct ContentView: View {

    @Environment(AppState.self) private var appState

    private let appIndexer: AppIndexer
    private let intentEngine: IntentEngine
    private let chatService = ChatService()

    @State private var lastProcessedCount = 0

    init() {
        let indexer = AppIndexer()
        self.appIndexer = indexer
        self.intentEngine = IntentEngine(appIndexer: indexer)
    }

    var body: some View {
        @Bindable var state = appState

        GeometryReader { geometry in
            ZStack(alignment: .bottom) {
                contentArea(in: geometry)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)

                // SmartBar anchored at the bottom. No fixed height so predictions
                // can grow upward without clipping.
                SmartBarView(intentEngine: intentEngine)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.bottom, 32)
                    .zIndex(100)
            }
        }
        .background(Color(hex: "#111111"))
        .ignoresSafeArea(.all)
        .sheet(isPresented: $state.showAPIKeyPrompt) {
            APIKeyPrompt()
                .environment(appState)
        }
        .onChange(of: appState.chatMessages.count) { _, newCount in
            guard newCount > lastProcessedCount,
                  appState.chatMessages.last?.role == .user
            else {
                lastProcessedCount = newCount
                return
            }
            lastProcessedCount = newCount
            let snapshot = appState.chatMessages
            Task {
                await chatService.sendMessage(messages: snapshot, appState: appState)
            }
        }
    }

    // MARK: - Content area

    @ViewBuilder
    private func contentArea(in geometry: GeometryProxy) -> some View {
        let totalWidth = geometry.size.width
        let chatWidth = chatPanelWidth(totalWidth: totalWidth)
        let browserWidth = totalWidth - chatWidth
        // Show the browser left pane only for URLs when NOT in split mode
        // (when embedding, our window has already been resized to just the right panel).
        let showBrowser = appState.currentURL != nil && !appState.isShowingEmbeddedApp

        HStack(spacing: 0) {
            if showBrowser {
                BrowserContainerView(appState: appState)
                    .frame(width: browserWidth)
                    .transition(.move(edge: .leading).combined(with: .opacity))

                if !appState.isChatCollapsed {
                    Rectangle()
                        .fill(Color.white.opacity(0.08))
                        .frame(width: 1)
                }
            }

            ChatPanelView()
                .frame(width: chatWidth)
                .background(Color(hex: "#111111"))
                .transition(.move(edge: .trailing))
        }
        .animation(.spring(duration: 0.3), value: appState.currentURL)
        .animation(.spring(duration: 0.3), value: appState.isShowingEmbeddedApp)
        .animation(.spring(duration: 0.25), value: appState.isChatCollapsed)
    }

    // MARK: - Width calculation

    private func chatPanelWidth(totalWidth: CGFloat) -> CGFloat {
        if appState.isChatCollapsed { return Layout.collapsedChatWidth }
        // When an embedded app is showing, our window has been resized to just
        // the right panel, so chat fills the full window width.
        if appState.isShowingEmbeddedApp { return totalWidth }
        // When browsing a URL, give 35% to chat.
        if appState.currentURL != nil {
            return totalWidth * (1 - Layout.browserFraction)
        }
        return totalWidth
    }
}

#Preview {
    ContentView()
        .environment(AppState())
        .frame(width: 1280, height: 800)
}
