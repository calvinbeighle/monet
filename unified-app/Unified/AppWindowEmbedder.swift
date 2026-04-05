// AppWindowEmbedder.swift
// Embeds external app windows by positioning them in the gap between
// our chrome panels using the Accessibility API. No screen capture needed.
// The external app runs natively and is fully interactive.

import AppKit
import Foundation

final class AppWindowEmbedder {

    private var managedApp: NSRunningApplication?
    private var terminationObserver: NSObjectProtocol?
    private var repositionTimer: Timer?

    init() {}

    deinit { cleanup() }

    // MARK: - Public API

    func embedApp(path: String, appState: AppState) {
        cleanup()

        let url = URL(fileURLWithPath: path)
        let config = NSWorkspace.OpenConfiguration()
        config.activates = false

        NSWorkspace.shared.openApplication(at: url, configuration: config) { [weak self] runningApp, error in
            DispatchQueue.main.async {
                guard let self else { return }
                guard let runningApp else {
                    let name = url.deletingPathExtension().lastPathComponent
                    appState.chatMessages.append(ChatMessage(role: .assistant, content: "Failed to launch **\(name)**."))
                    return
                }

                self.managedApp = runningApp
                appState.embeddedApp = runningApp
                appState.isShowingEmbeddedApp = true

                let name = runningApp.localizedName ?? url.deletingPathExtension().lastPathComponent
                appState.chatMessages.append(ChatMessage(role: .assistant, content: "Embedding **\(name)**..."))

                // Watch for termination.
                self.terminationObserver = NSWorkspace.shared.notificationCenter.addObserver(
                    forName: NSWorkspace.didTerminateApplicationNotification,
                    object: nil,
                    queue: .main
                ) { [weak self] notification in
                    guard let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
                          app.processIdentifier == runningApp.processIdentifier else { return }
                    self?.cleanup()
                    appState.dismissEmbeddedApp()
                    appState.chatMessages.append(ChatMessage(role: .assistant, content: "**\(name)** was closed."))
                }

                // Wait for window then position it.
                self.waitAndPosition(app: runningApp, appState: appState, attempt: 0)
            }
        }
    }

    func release(appState: AppState) {
        cleanup()
    }

    // MARK: - Wait and position

    private func waitAndPosition(app: NSRunningApplication, appState: AppState, attempt: Int) {
        guard attempt < 30 else {
            appState.chatMessages.append(ChatMessage(role: .assistant, content: "Could not find a window to embed."))
            return
        }

        let pid = app.processIdentifier
        let appRef = AXUIElementCreateApplication(pid)
        var windowsRef: CFTypeRef?
        let result = AXUIElementCopyAttributeValue(appRef, kAXWindowsAttribute as CFString, &windowsRef)

        if result == .success, let windows = windowsRef as? [AXUIElement], !windows.isEmpty {
            // Window found. Position it and start the reposition timer.
            positionEmbeddedWindow(pid: pid)

            // Raise our window level so our chrome (chat, bar) sits on top.
            if let hostWindow = NSApplication.shared.windows.first(where: { $0.isVisible }) {
                hostWindow.level = NSWindow.Level(rawValue: NSWindow.Level.floating.rawValue + 1)
            }

            let name = app.localizedName ?? "App"
            // Replace the "Embedding..." message with success.
            if let idx = appState.chatMessages.lastIndex(where: { $0.content.contains("Embedding") }) {
                appState.chatMessages[idx].content = "**\(name)** is embedded. Click on it to interact."
            }

            // Keep repositioning to handle window resizes etc.
            repositionTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
                self?.positionEmbeddedWindow(pid: pid)
            }
        } else {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
                self?.waitAndPosition(app: app, appState: appState, attempt: attempt + 1)
            }
        }
    }

    // MARK: - Position the window

    private func positionEmbeddedWindow(pid: pid_t) {
        guard let hostWindow = NSApplication.shared.windows.first(where: { $0.isVisible }) else { return }
        guard let screen = hostWindow.screen ?? NSScreen.main else { return }

        let hostFrame = hostWindow.frame
        let screenHeight = screen.frame.height

        // The embedded app goes in the left 65% of our window,
        // leaving room for the smart bar at the bottom.
        let smartBarSpace: CGFloat = 100
        let browserWidth = hostFrame.width * 0.65

        // Target frame in screen coords (bottom-left origin).
        let targetRect = NSRect(
            x: hostFrame.origin.x,
            y: hostFrame.origin.y + smartBarSpace,
            width: browserWidth,
            height: hostFrame.height - smartBarSpace
        )

        // AX API uses top-left origin. Convert.
        let axX = targetRect.origin.x
        let axY = screenHeight - targetRect.origin.y - targetRect.height

        let appRef = AXUIElementCreateApplication(pid)
        var windowsRef: CFTypeRef?
        guard AXUIElementCopyAttributeValue(appRef, kAXWindowsAttribute as CFString, &windowsRef) == .success,
              let windows = windowsRef as? [AXUIElement],
              let window = windows.first else { return }

        var position = CGPoint(x: axX, y: axY)
        if let posValue = AXValueCreate(.cgPoint, &position) {
            AXUIElementSetAttributeValue(window, kAXPositionAttribute as CFString, posValue)
        }

        var size = CGSize(width: targetRect.width, height: targetRect.height)
        if let sizeValue = AXValueCreate(.cgSize, &size) {
            AXUIElementSetAttributeValue(window, kAXSizeAttribute as CFString, sizeValue)
        }
    }

    // MARK: - Cleanup

    private func cleanup() {
        repositionTimer?.invalidate()
        repositionTimer = nil
        if let obs = terminationObserver {
            NSWorkspace.shared.notificationCenter.removeObserver(obs)
            terminationObserver = nil
        }
        // Restore our window level to normal when closing embedded app.
        if let hostWindow = NSApplication.shared.windows.first(where: { $0.isVisible }) {
            hostWindow.level = .normal
        }
        managedApp = nil
    }
}
