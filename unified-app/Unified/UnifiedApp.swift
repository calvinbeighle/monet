// UnifiedApp.swift
// App entry point for Unified.
// Uses a borderless window that fills the screen (NOT native fullscreen)
// so we stay on the same Space as other apps and can embed their windows.

import SwiftUI
import AppKit

// MARK: - App Delegate

class AppDelegate: NSObject, NSApplicationDelegate {

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Try multiple times in case SwiftUI hasn't created the window yet.
        configureAfterDelay(attempt: 0)
    }

    private func configureAfterDelay(attempt: Int) {
        guard attempt < 5 else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + Double(attempt) * 0.2 + 0.1) {
            if let window = NSApplication.shared.windows.first(where: { $0.isVisible || $0.contentView != nil }) {
                self.configureWindow(window)
            } else {
                self.configureAfterDelay(attempt: attempt + 1)
            }
        }
    }

    private func configureWindow(_ window: NSWindow) {
        guard let screen = window.screen ?? NSScreen.main else { return }

        // Borderless, no title bar, transparent background for app embedding.
        window.styleMask = [.borderless, .fullSizeContentView, .resizable]
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.isOpaque = false
        window.backgroundColor = .clear
        window.isMovableByWindowBackground = false
        window.hasShadow = false

        // Fill the full screen frame (including under menu bar area).
        window.setFrame(screen.frame, display: true, animate: false)

        // Window level: normal so other windows can be managed around it.
        window.level = .normal
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]

        // Make key.
        window.makeKeyAndOrderFront(nil)
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return false
    }
}

// MARK: - App Entry Point

@main
struct UnifiedApp: App {

    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    @State private var appState = AppState()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(appState)
                .preferredColorScheme(.dark)
                .ignoresSafeArea(.all)
        }
        .windowStyle(.hiddenTitleBar)
        .windowResizability(.contentMinSize)
        .defaultSize(width: NSScreen.main?.frame.width ?? 1440, height: NSScreen.main?.frame.height ?? 900)
    }
}
