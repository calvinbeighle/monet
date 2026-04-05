// AppWindowEmbedder.swift
// Manages embedding external apps on the left 65% of the screen.
// Our main window shrinks to the right 35% panel.
// A dark background window fills the full screen behind everything.

import AppKit
import Foundation

final class AppWindowEmbedder {

    private var managedApp: NSRunningApplication?
    private var terminationObserver: NSObjectProtocol?
    private var repositionTimer: Timer?
    private var backgroundWindow: NSWindow?
    private var fullScreenFrame: NSRect?
    private var isInSplitMode = false

    static let splitRatio: CGFloat = 0.65

    init() {}

    deinit {
        repositionTimer?.invalidate()
        if let obs = terminationObserver {
            NSWorkspace.shared.notificationCenter.removeObserver(obs)
        }
    }

    // MARK: - Public API

    func embedApp(path: String, appState: AppState) {
        // If already embedding, terminate the previous app first.
        if let oldApp = managedApp, oldApp.isTerminated == false {
            oldApp.terminate()
        }
        clearObservers()

        let url = URL(fileURLWithPath: path)
        let config = NSWorkspace.OpenConfiguration()
        config.activates = true

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
                appState.currentURL = nil
                appState.pageTitle = ""

                // Wire up dismiss callback.
                appState.onDismissEmbeddedApp = { [weak self] in
                    self?.releaseCurrentApp()
                }

                let name = runningApp.localizedName ?? url.deletingPathExtension().lastPathComponent
                appState.chatMessages.append(ChatMessage(role: .assistant, content: "**\(name)** is open. Click on it to interact."))

                // Enter split mode (only saves frame on first call).
                self.enterSplitMode()

                // Position the app window on the left after it creates its window.
                let pid = runningApp.processIdentifier
                self.waitAndPosition(pid: pid, attempt: 0)

                // Watch for termination.
                self.terminationObserver = NSWorkspace.shared.notificationCenter.addObserver(
                    forName: NSWorkspace.didTerminateApplicationNotification,
                    object: nil,
                    queue: .main
                ) { [weak self] notification in
                    guard let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
                          app.processIdentifier == runningApp.processIdentifier else { return }
                    self?.releaseCurrentApp()
                    appState.dismissEmbeddedApp()
                    appState.chatMessages.append(ChatMessage(role: .assistant, content: "**\(name)** was closed."))
                }
            }
        }
    }

    func release(appState: AppState) {
        releaseCurrentApp()
    }

    // MARK: - Split mode

    private func enterSplitMode() {
        guard let hostWindow = NSApplication.shared.windows.first(where: {
            $0.isVisible && $0 !== backgroundWindow
        }), let screen = hostWindow.screen ?? NSScreen.main else { return }

        let screenFrame = screen.frame

        // Only save the full-screen frame on the FIRST enter.
        if !isInSplitMode {
            fullScreenFrame = hostWindow.frame
        }
        isInSplitMode = true

        // Background window.
        if backgroundWindow == nil {
            let bg = NSWindow(
                contentRect: screenFrame,
                styleMask: [.borderless],
                backing: .buffered,
                defer: false
            )
            bg.backgroundColor = NSColor(red: 0.067, green: 0.067, blue: 0.067, alpha: 1)
            bg.isOpaque = true
            bg.hasShadow = false
            bg.ignoresMouseEvents = true
            bg.level = NSWindow.Level(rawValue: NSWindow.Level.normal.rawValue - 1)
            bg.collectionBehavior = [.canJoinAllSpaces, .stationary]
            backgroundWindow = bg
        }
        backgroundWindow?.setFrame(screenFrame, display: true)
        backgroundWindow?.orderFront(nil)

        // Shrink main window to the right panel.
        let rightWidth = screenFrame.width * (1 - Self.splitRatio)
        let rightFrame = NSRect(
            x: screenFrame.origin.x + screenFrame.width - rightWidth,
            y: screenFrame.origin.y,
            width: rightWidth,
            height: screenFrame.height
        )
        hostWindow.setFrame(rightFrame, display: true, animate: true)
    }

    private func exitSplitMode() {
        guard isInSplitMode else { return }
        isInSplitMode = false

        backgroundWindow?.orderOut(nil)

        guard let hostWindow = NSApplication.shared.windows.first(where: {
            $0.isVisible && $0 !== backgroundWindow
        }) else { return }

        if let saved = fullScreenFrame {
            hostWindow.setFrame(saved, display: true, animate: true)
            fullScreenFrame = nil
        } else if let screen = hostWindow.screen ?? NSScreen.main {
            hostWindow.setFrame(screen.frame, display: true, animate: true)
        }

        hostWindow.makeKeyAndOrderFront(nil)
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    // MARK: - Wait for window and position it

    private func waitAndPosition(pid: pid_t, attempt: Int) {
        guard attempt < 30 else {
            debugLog("Gave up waiting for window after 30 attempts (pid=\(pid))")
            return
        }

        let appRef = AXUIElementCreateApplication(pid)
        var windowsRef: CFTypeRef?
        let result = AXUIElementCopyAttributeValue(appRef, kAXWindowsAttribute as CFString, &windowsRef)

        if result == .success,
           let windows = windowsRef as? [AXUIElement],
           !windows.isEmpty {
            // Window found - position it now.
            positionWindow(windows[0])
            debugLog("Positioned window on attempt \(attempt + 1)")

            // Start repositioning timer to keep it pinned.
            repositionTimer?.invalidate()
            repositionTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
                let ref = AXUIElementCreateApplication(pid)
                var wRef: CFTypeRef?
                if AXUIElementCopyAttributeValue(ref, kAXWindowsAttribute as CFString, &wRef) == .success,
                   let wins = wRef as? [AXUIElement],
                   let win = wins.first {
                    self?.positionWindow(win)
                }
            }
        } else {
            // Not ready yet - retry.
            debugLog("No window yet for pid=\(pid), attempt \(attempt + 1), AX result=\(result.rawValue)")
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
                self?.waitAndPosition(pid: pid, attempt: attempt + 1)
            }
        }
    }

    private func positionWindow(_ window: AXUIElement) {
        guard let screen = NSScreen.main else { return }
        let screenFrame = screen.frame
        let leftWidth = screenFrame.width * Self.splitRatio

        var position = CGPoint(x: screenFrame.origin.x, y: 0)
        if let posValue = AXValueCreate(.cgPoint, &position) {
            let r = AXUIElementSetAttributeValue(window, kAXPositionAttribute as CFString, posValue)
            if r != .success {
                debugLog("Failed to set position: error \(r.rawValue)")
            }
        }

        var size = CGSize(width: leftWidth, height: screenFrame.height)
        if let sizeValue = AXValueCreate(.cgSize, &size) {
            let r = AXUIElementSetAttributeValue(window, kAXSizeAttribute as CFString, sizeValue)
            if r != .success {
                debugLog("Failed to set size: error \(r.rawValue)")
            }
        }
    }

    // MARK: - Release

    private func releaseCurrentApp() {
        clearObservers()
        managedApp = nil
        exitSplitMode()
    }

    private func clearObservers() {
        repositionTimer?.invalidate()
        repositionTimer = nil
        if let obs = terminationObserver {
            NSWorkspace.shared.notificationCenter.removeObserver(obs)
            terminationObserver = nil
        }
    }

    // MARK: - Debug

    private func debugLog(_ message: String) {
        let ts = ISO8601DateFormatter().string(from: Date())
        let line = "[\(ts)] \(message)\n"
        let path = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Logs/Unified-embed.log")
        if let data = line.data(using: .utf8) {
            if FileManager.default.fileExists(atPath: path.path) {
                if let h = try? FileHandle(forWritingTo: path) {
                    h.seekToEndOfFile()
                    h.write(data)
                    h.closeFile()
                }
            } else {
                try? data.write(to: path)
            }
        }
    }
}
