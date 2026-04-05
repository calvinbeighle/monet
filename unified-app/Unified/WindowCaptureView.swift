// WindowCaptureView.swift
// Captures an external app's window via ScreenCaptureKit and renders it
// as a live interactive SwiftUI view with mouse/keyboard forwarding.
// Falls back to CGWindowListCreateImage if SCStream fails.

import AppKit
import CoreGraphics
import CoreMedia
import os.log
import ScreenCaptureKit
import SwiftUI

private let logger = Logger(subsystem: "com.unified.app", category: "WindowCapture")

// MARK: - WindowCaptureManager

@Observable
final class WindowCaptureManager: NSObject, SCStreamOutput, SCStreamDelegate {

    var capturedImage: CGImage?
    var isCapturing: Bool = false
    var captureError: String?
    var statusText: String = "Initializing..."
    var imageSize: CGSize = .zero

    private var stream: SCStream?
    private(set) var targetPID: pid_t?
    private var targetWindowID: CGWindowID = 0
    private var windowFrame: CGRect = .zero
    private var hasReceivedFirstFrame = false
    private var fallbackTimer: Timer?
    private var retryCount = 0
    private let maxRetries = 20

    // MARK: - Start with retry

    func startCapturing(pid: pid_t, bundleID: String?) async {
        targetPID = pid
        captureError = nil
        hasReceivedFirstFrame = false
        retryCount = 0

        // Write debug info to file for troubleshooting.
        debugLog("Starting capture for pid=\(pid) bundleID=\(bundleID ?? "nil")")

        await attemptCapture(pid: pid, bundleID: bundleID)
    }

    private func attemptCapture(pid: pid_t, bundleID: String?) async {
        retryCount += 1
        debugLog("Attempt \(retryCount)/\(maxRetries)")

        if retryCount > maxRetries {
            await MainActor.run {
                captureError = "Could not capture window after \(maxRetries) attempts. Check Screen Recording permission in System Settings > Privacy & Security."
                statusText = "Capture failed"
            }
            return
        }

        await MainActor.run {
            statusText = "Finding window (attempt \(retryCount))..."
        }

        // Method 1: Try CGWindowList (simpler, more reliable).
        let windowID = findWindowID(pid: pid, bundleID: bundleID)

        if windowID != 0 {
            debugLog("Found window ID \(windowID) via CGWindowList")
            self.targetWindowID = windowID
            await MainActor.run {
                statusText = "Starting stream..."
            }

            // Try ScreenCaptureKit first.
            let scSuccess = await tryScreenCaptureKit(pid: pid, windowID: windowID)
            if scSuccess {
                debugLog("SCStream started successfully")
                return
            }

            // Fallback: use CGWindowListCreateImage polling.
            debugLog("SCStream failed, falling back to CGWindowListCreateImage")
            await MainActor.run {
                statusText = "Using fallback capture..."
                startFallbackCapture(windowID: windowID)
            }
            return
        }

        debugLog("No window found yet, retrying in 0.5s...")
        // No window yet - wait and retry.
        try? await Task.sleep(nanoseconds: 500_000_000)
        await attemptCapture(pid: pid, bundleID: bundleID)
    }

    // MARK: - Find window via CGWindowList

    private func findWindowID(pid: pid_t, bundleID: String?) -> CGWindowID {
        guard let windowList = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[CFString: Any]] else {
            debugLog("CGWindowListCopyWindowInfo returned nil")
            return 0
        }

        debugLog("Total windows in system: \(windowList.count)")

        // Filter windows for this PID.
        var candidates: [(CGWindowID, String, CGRect)] = []

        for info in windowList {
            let ownerPID = info[kCGWindowOwnerPID] as? pid_t ?? 0
            let windowID = info[kCGWindowNumber] as? CGWindowID ?? 0
            let name = info[kCGWindowName] as? String ?? ""
            let ownerName = info[kCGWindowOwnerName] as? String ?? ""
            let layer = info[kCGWindowLayer] as? Int ?? 0

            // Only normal layer windows (layer 0).
            guard layer == 0 else { continue }

            // Match by PID or bundle ID.
            var matches = (ownerPID == pid)
            if !matches, let bid = bundleID {
                // Some apps spawn sub-processes. Try matching by name.
                if let app = NSRunningApplication(processIdentifier: ownerPID),
                   app.bundleIdentifier == bid {
                    matches = true
                }
            }
            guard matches else { continue }

            // Get bounds.
            if let boundsDict = info[kCGWindowBounds] as? [String: CGFloat] {
                let rect = CGRect(
                    x: boundsDict["X"] ?? 0,
                    y: boundsDict["Y"] ?? 0,
                    width: boundsDict["Width"] ?? 0,
                    height: boundsDict["Height"] ?? 0
                )
                if rect.width > 50 && rect.height > 50 {
                    candidates.append((windowID, "\(ownerName): \(name)", rect))
                    debugLog("  Candidate: wid=\(windowID) '\(ownerName): \(name)' \(rect)")
                }
            }
        }

        // Pick the largest window.
        let sorted = candidates.sorted { $0.2.width * $0.2.height > $1.2.width * $1.2.height }
        if let best = sorted.first {
            windowFrame = best.2
            imageSize = CGSize(width: best.2.width, height: best.2.height)
            debugLog("Selected window: wid=\(best.0) '\(best.1)'")
            return best.0
        }

        debugLog("No suitable window candidates found for pid=\(pid)")
        return 0
    }

    // MARK: - ScreenCaptureKit approach

    private func tryScreenCaptureKit(pid: pid_t, windowID: CGWindowID) async -> Bool {
        let content: SCShareableContent
        do {
            content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
        } catch {
            debugLog("SCShareableContent failed: \(error)")
            return false
        }

        // Find the matching SC window.
        guard let scWindow = content.windows.first(where: { $0.windowID == windowID }) else {
            debugLog("SCWindow not found for windowID \(windowID)")
            // Try by PID as fallback.
            let byPID = content.windows.filter { $0.owningApplication?.processID == pid && $0.frame.width > 50 && $0.frame.height > 50 }
            debugLog("Windows by PID: \(byPID.count)")
            if let fallback = byPID.first {
                return await startSCStream(window: fallback)
            }
            return false
        }

        return await startSCStream(window: scWindow)
    }

    private func startSCStream(window: SCWindow) async -> Bool {
        let config = SCStreamConfiguration()
        config.width = max(Int(window.frame.width * 2), 100)
        config.height = max(Int(window.frame.height * 2), 100)
        config.minimumFrameInterval = CMTime(value: 1, timescale: 30)
        config.showsCursor = true
        config.queueDepth = 3

        let filter = SCContentFilter(desktopIndependentWindow: window)
        let newStream = SCStream(filter: filter, configuration: config, delegate: self)

        do {
            try newStream.addStreamOutput(self, type: .screen, sampleHandlerQueue: .global(qos: .userInteractive))
            try await newStream.startCapture()
        } catch {
            debugLog("SCStream start failed: \(error)")
            return false
        }

        await MainActor.run {
            self.stream = newStream
            self.isCapturing = true
            self.statusText = "Streaming..."
        }

        // Timeout: if no frame after 5 seconds, report failure so fallback kicks in.
        try? await Task.sleep(nanoseconds: 5_000_000_000)
        if !hasReceivedFirstFrame {
            debugLog("SCStream timeout - no frames after 5s")
            try? await newStream.stopCapture()
            await MainActor.run {
                self.stream = nil
                self.isCapturing = false
            }
            return false
        }

        return true
    }

    // MARK: - Fallback: CGWindowListCreateImage polling

    private func startFallbackCapture(windowID: CGWindowID) {
        isCapturing = true
        fallbackTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 30.0, repeats: true) { [weak self] _ in
            self?.captureFrame(windowID: windowID)
        }
        // Capture first frame immediately.
        captureFrame(windowID: windowID)
    }

    private func captureFrame(windowID: CGWindowID) {
        let image = CGWindowListCreateImage(
            .null,
            .optionIncludingWindow,
            windowID,
            [.boundsIgnoreFraming, .bestResolution]
        )

        if let image {
            if !hasReceivedFirstFrame {
                debugLog("Fallback: first frame received \(image.width)x\(image.height)")
                hasReceivedFirstFrame = true
                statusText = "Captured"
                captureError = nil
            }
            capturedImage = image
        }
    }

    // MARK: - Stop

    func stopCapturing() {
        fallbackTimer?.invalidate()
        fallbackTimer = nil
        let s = stream
        stream = nil
        isCapturing = false
        capturedImage = nil
        targetPID = nil
        targetWindowID = 0
        hasReceivedFirstFrame = false
        Task {
            try? await s?.stopCapture()
        }
    }

    // MARK: - SCStreamOutput

    nonisolated func stream(
        _ stream: SCStream,
        didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of type: SCStreamOutputType
    ) {
        guard type == .screen else { return }
        guard let imageBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

        let ciImage = CIImage(cvPixelBuffer: imageBuffer)
        let context = CIContext()
        guard let cgImage = context.createCGImage(ciImage, from: ciImage.extent) else { return }

        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            if !self.hasReceivedFirstFrame {
                self.debugLog("SCStream: first frame \(cgImage.width)x\(cgImage.height)")
                self.statusText = "Streaming"
            }
            self.capturedImage = cgImage
            self.hasReceivedFirstFrame = true
            self.captureError = nil
        }
    }

    // MARK: - SCStreamDelegate

    nonisolated func stream(_ stream: SCStream, didStopWithError error: any Error) {
        DispatchQueue.main.async { [weak self] in
            self?.debugLog("SCStream stopped: \(error)")
            self?.isCapturing = false
            self?.captureError = "Capture stopped: \(error.localizedDescription)"
        }
    }

    // MARK: - Mouse forwarding

    func forwardMouseEvent(
        localPoint: CGPoint,
        viewSize: CGSize,
        eventType: CGEventType,
        scrollDelta: (dx: Int32, dy: Int32) = (0, 0)
    ) {
        guard let pid = targetPID else { return }

        let fracX = localPoint.x / viewSize.width
        let fracY = localPoint.y / viewSize.height

        let screenX = windowFrame.origin.x + fracX * windowFrame.width
        let screenY = windowFrame.origin.y + fracY * windowFrame.height
        let screenPoint = CGPoint(x: screenX, y: screenY)

        if eventType == .scrollWheel {
            guard let event = CGEvent(
                scrollWheelEvent2Source: nil,
                units: .line,
                wheelCount: 2,
                wheel1: scrollDelta.dy,
                wheel2: scrollDelta.dx,
                wheel3: 0
            ) else { return }
            event.location = screenPoint
            event.postToPid(pid)
            return
        }

        let button: CGMouseButton = (eventType == .rightMouseDown || eventType == .rightMouseUp) ? .right : .left
        guard let event = CGEvent(mouseEventSource: nil, mouseType: eventType, mouseCursorPosition: screenPoint, mouseButton: button) else { return }
        event.postToPid(pid)
    }

    // MARK: - Key forwarding

    func forwardKeyEvent(keyCode: CGKeyCode, isDown: Bool, flags: CGEventFlags) {
        guard let pid = targetPID else { return }
        guard let event = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: isDown) else { return }
        event.flags = flags
        event.postToPid(pid)
    }

    // MARK: - Debug logging

    private func debugLog(_ message: String) {
        let timestamp = ISO8601DateFormatter().string(from: Date())
        let line = "[\(timestamp)] \(message)\n"
        let logPath = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Logs/Unified-capture.log")
        if let data = line.data(using: .utf8) {
            if FileManager.default.fileExists(atPath: logPath.path) {
                if let handle = try? FileHandle(forWritingTo: logPath) {
                    handle.seekToEndOfFile()
                    handle.write(data)
                    handle.closeFile()
                }
            } else {
                try? data.write(to: logPath)
            }
        }
        logger.info("\(message)")
    }
}

// MARK: - WindowCaptureView

struct WindowCaptureView: View {

    let captureManager: WindowCaptureManager

    var body: some View {
        GeometryReader { geo in
            ZStack {
                Color.black

                if let cgImage = captureManager.capturedImage {
                    Image(decorative: cgImage, scale: 2.0)
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .overlay {
                            CapturedFrameOverlay(captureManager: captureManager)
                        }
                } else if let error = captureManager.captureError {
                    permissionErrorView(message: error)
                } else {
                    loadingView
                }
            }
        }
    }

    @ViewBuilder
    private var loadingView: some View {
        VStack(spacing: 12) {
            ProgressView()
                .controlSize(.large)
                .tint(.white)
            Text(captureManager.statusText)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Color.white.opacity(0.6))
        }
    }

    @ViewBuilder
    private func permissionErrorView(message: String) -> some View {
        VStack(spacing: 16) {
            Image(systemName: "video.slash.fill")
                .font(.system(size: 40))
                .foregroundStyle(Color.white.opacity(0.3))

            Text("Screen Recording Required")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.white)

            Text(message)
                .font(.system(size: 12))
                .foregroundStyle(Color.white.opacity(0.5))
                .multilineTextAlignment(.center)
                .frame(maxWidth: 320)

            Button("Open Privacy Settings") {
                if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture") {
                    NSWorkspace.shared.open(url)
                }
            }
            .buttonStyle(.borderedProminent)
        }
        .padding(32)
    }
}

// MARK: - CapturedFrameOverlay

private struct CapturedFrameOverlay: NSViewRepresentable {

    let captureManager: WindowCaptureManager

    func makeNSView(context: Context) -> InteractionNSView {
        let view = InteractionNSView()
        view.captureManager = captureManager
        return view
    }

    func updateNSView(_ nsView: InteractionNSView, context: Context) {
        nsView.captureManager = captureManager
    }
}

final class InteractionNSView: NSView {

    weak var captureManager: WindowCaptureManager?
    private var trackingArea: NSTrackingArea?

    override var acceptsFirstResponder: Bool { true }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        refreshTracking()
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        refreshTracking()
    }

    private func refreshTracking() {
        if let t = trackingArea { removeTrackingArea(t) }
        let area = NSTrackingArea(
            rect: bounds,
            options: [.activeAlways, .mouseMoved, .mouseEnteredAndExited, .enabledDuringMouseDrag],
            owner: self,
            userInfo: nil
        )
        addTrackingArea(area)
        trackingArea = area
    }

    override func mouseDown(with e: NSEvent) { window?.makeFirstResponder(self); forward(e, .leftMouseDown) }
    override func mouseUp(with e: NSEvent) { forward(e, .leftMouseUp) }
    override func mouseDragged(with e: NSEvent) { forward(e, .leftMouseDragged) }
    override func mouseMoved(with e: NSEvent) { forward(e, .mouseMoved) }
    override func rightMouseDown(with e: NSEvent) { forward(e, .rightMouseDown) }
    override func rightMouseUp(with e: NSEvent) { forward(e, .rightMouseUp) }

    override func scrollWheel(with e: NSEvent) {
        let local = convert(e.locationInWindow, from: nil)
        let flipped = CGPoint(x: local.x, y: bounds.height - local.y)
        captureManager?.forwardMouseEvent(
            localPoint: flipped, viewSize: bounds.size, eventType: .scrollWheel,
            scrollDelta: (dx: Int32(e.scrollingDeltaX), dy: Int32(e.scrollingDeltaY))
        )
    }

    override func keyDown(with e: NSEvent) {
        captureManager?.forwardKeyEvent(keyCode: CGKeyCode(e.keyCode), isDown: true, flags: e.cgEvent?.flags ?? [])
    }
    override func keyUp(with e: NSEvent) {
        captureManager?.forwardKeyEvent(keyCode: CGKeyCode(e.keyCode), isDown: false, flags: e.cgEvent?.flags ?? [])
    }

    private func forward(_ event: NSEvent, _ type: CGEventType) {
        let local = convert(event.locationInWindow, from: nil)
        let flipped = CGPoint(x: local.x, y: bounds.height - local.y)
        captureManager?.forwardMouseEvent(localPoint: flipped, viewSize: bounds.size, eventType: type)
    }
}
