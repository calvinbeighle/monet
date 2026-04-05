// ContentView.swift
// Root layout for Unified. Composes SmartBarView, BrowserPaneView, and ChatPanelView.

import SwiftUI

private enum Layout {
    static let smartBarHeight: CGFloat = 52
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

                SmartBarView(intentEngine: intentEngine)
                    .frame(height: Layout.smartBarHeight)
                    .padding(.bottom, 32)
                    .zIndex(100)
            }
        }
        // Make the window background transparent when embedding an app
        // so the external app window shows through the left pane.
        .background(appState.isShowingEmbeddedApp ? Color.clear : Color(hex: "#111111"))
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
        .onAppear {
            // Make window background transparent to support app embedding.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                if let window = NSApplication.shared.windows.first(where: { $0.isVisible }) {
                    window.isOpaque = false
                    window.backgroundColor = .clear
                }
            }
        }
    }

    // MARK: - Content area

    @ViewBuilder
    private func contentArea(in geometry: GeometryProxy) -> some View {
        let totalWidth = geometry.size.width
        let chatWidth = chatPanelWidth(totalWidth: totalWidth)
        let browserWidth = totalWidth - chatWidth

        HStack(spacing: 0) {
            if appState.currentURL != nil || appState.isShowingEmbeddedApp {
                if appState.isShowingEmbeddedApp {
                    // Transparent area - the external app window is positioned behind
                    // our window in this exact region by AppWindowEmbedder.
                    embeddedAppPane()
                        .frame(width: browserWidth)
                } else {
                    BrowserContainerView(appState: appState)
                        .frame(width: browserWidth)
                        .transition(.move(edge: .leading).combined(with: .opacity))
                }
            }

            if (appState.currentURL != nil || appState.isShowingEmbeddedApp) && !appState.isChatCollapsed {
                Rectangle()
                    .fill(Color.white.opacity(0.08))
                    .frame(width: 1)
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

    // MARK: - Embedded app pane (transparent pass-through)

    @ViewBuilder
    private func embeddedAppPane() -> some View {
        ZStack(alignment: .bottom) {
            // Fully transparent so the external app window shows through.
            Color.clear

            // Control bar floating above the smart bar.
            if let app = appState.embeddedApp {
                HStack(spacing: 10) {
                    Circle()
                        .fill(Color(hex: "#34D399"))
                        .frame(width: 8, height: 8)
                    Text(app.localizedName ?? "App")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(.white)
                    Spacer()
                    Button("Close") {
                        app.terminate()
                        appState.dismissEmbeddedApp()
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 8))
                .padding(.horizontal, 8)
                .padding(.bottom, 96)
            }
        }
    }

    // MARK: - Width calculation

    private func chatPanelWidth(totalWidth: CGFloat) -> CGFloat {
        if appState.isChatCollapsed { return Layout.collapsedChatWidth }
        if appState.currentURL != nil || appState.isShowingEmbeddedApp {
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
