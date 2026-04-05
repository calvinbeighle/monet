// WindowCaptureView.swift
// Captures an external app's window via ScreenCaptureKit and renders it
// as a live interactive SwiftUI view with mouse/keyboard forwarding.

import AppKit
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
    var imageSize: CGSize = .zero

    private var stream: SCStream?
    private var targetPID: pid_t?
    private var windowFrame: CGRect = .zero
    private var hasReceivedFirstFrame = false

    // MARK: - Permission check

    static var hasScreenRecordingPermission: Bool {
        CGPreflightScreenCaptureAccess()
    }

    static func requestPermission() {
        CGRequestScreenCaptureAccess()
    }

    // MARK: - Start

    func startCapturing(pid: pid_t) async throws {
        targetPID = pid
        captureError = nil
        hasReceivedFirstFrame = false

        // Check permission - but don't block on it. CGPreflightScreenCaptureAccess
        // can return false even when permission is granted if the app hasn't been
        // restarted since the grant. We try anyway and handle errors.
        let hasPermission = CGPreflightScreenCaptureAccess()
        logger.info("Screen recording preflight: \(hasPermission)")

        if !hasPermission {
            logger.info("Preflight returned false, requesting and trying anyway")
            CGRequestScreenCaptureAccess()
            // Don't return - try the capture anyway. It might work if permission
            // was granted but the process cache is stale.
        }

        // Fetch shareable content.
        logger.info("Fetching shareable content for pid \(pid)")
        let content: SCShareableContent
        do {
            content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
        } catch {
            logger.error("SCShareableContent failed: \(error.localizedDescription)")
            captureError = "Failed to access screen content: \(error.localizedDescription)"
            return
        }

        logger.info("Found \(content.windows.count) total windows")

        // Find windows for this PID.
        let allAppWindows = content.windows.filter { $0.owningApplication?.processID == pid }
        logger.info("Found \(allAppWindows.count) windows for pid \(pid)")
        for w in allAppWindows {
            logger.info("  Window: \(w.title ?? "(no title)") frame=\(w.frame.debugDescription) onScreen=\(w.isOnScreen)")
        }

        // Pick the largest visible window.
        let appWindows = allAppWindows
            .filter { $0.frame.width > 50 && $0.frame.height > 50 }
            .sorted { $0.frame.width * $0.frame.height > $1.frame.width * $1.frame.height }

        guard let scWindow = appWindows.first else {
            captureError = "No capturable window found for this app. Found \(allAppWindows.count) windows but none were large enough."
            logger.error("No suitable window found")
            return
        }

        logger.info("Capturing window: \(scWindow.title ?? "(no title)") frame=\(scWindow.frame.debugDescription)")
        windowFrame = scWindow.frame
        imageSize = CGSize(width: scWindow.frame.width, height: scWindow.frame.height)

        // Configure capture.
        let config = SCStreamConfiguration()
        config.width = max(Int(scWindow.frame.width * 2), 100)
        config.height = max(Int(scWindow.frame.height * 2), 100)
        config.minimumFrameInterval = CMTime(value: 1, timescale: 30)
        config.showsCursor = true
        config.queueDepth = 3

        let filter = SCContentFilter(desktopIndependentWindow: scWindow)
        let newStream = SCStream(filter: filter, configuration: config, delegate: self)

        do {
            try newStream.addStreamOutput(self, type: .screen, sampleHandlerQueue: .global(qos: .userInteractive))
            try await newStream.startCapture()
            logger.info("Stream started successfully")
        } catch {
            logger.error("Stream start failed: \(error.localizedDescription)")
            captureError = "Failed to start capture: \(error.localizedDescription)"
            return
        }

        self.stream = newStream
        self.isCapturing = true

        // Move window off-screen AFTER capture starts.
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
            logger.info("Moving window off-screen")
            self?.moveWindowOffScreen(pid: pid)
        }

        // Timeout: if no frame after 8 seconds, show error.
        DispatchQueue.main.asyncAfter(deadline: .now() + 8.0) { [weak self] in
            guard let self, !self.hasReceivedFirstFrame, self.isCapturing else { return }
            logger.error("Timeout: no frames received after 8s")
            self.captureError = "Capture started but no frames received after 8 seconds. Try granting Screen Recording permission and restarting Unified."
            self.isCapturing = false
        }
    }

    // MARK: - Stop

    func stopCapturing() {
        let s = stream
        stream = nil
        isCapturing = false
        capturedImage = nil
        targetPID = nil
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
        guard let cgImage = context.createCGImage(ciImage, from: ciImage.extent) else {
            logger.error("Failed to create CGImage from frame")
            return
        }

        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            if !self.hasReceivedFirstFrame {
                logger.info("First frame received! Size: \(cgImage.width)x\(cgImage.height)")
            }
            self.capturedImage = cgImage
            self.hasReceivedFirstFrame = true
            self.captureError = nil
        }
    }

    // MARK: - SCStreamDelegate

    nonisolated func stream(_ stream: SCStream, didStopWithError error: any Error) {
        DispatchQueue.main.async { [weak self] in
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

        // Map to screen coordinates. windowFrame is in CG screen coords (top-left origin).
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

    // MARK: - Move off-screen

    private func moveWindowOffScreen(pid: pid_t) {
        let appRef = AXUIElementCreateApplication(pid)
        var windowsRef: CFTypeRef?
        guard AXUIElementCopyAttributeValue(appRef, kAXWindowsAttribute as CFString, &windowsRef) == .success,
              let windows = windowsRef as? [AXUIElement],
              let window = windows.first
        else { return }

        var position = CGPoint(x: -10000, y: 0)
        if let posValue = AXValueCreate(.cgPoint, &position) {
            AXUIElementSetAttributeValue(window, kAXPositionAttribute as CFString, posValue)
        }
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
                            // Mouse/keyboard interaction layer.
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
            Text("Connecting to app...")
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

/// Transparent NSView overlay that intercepts mouse/keyboard events
/// and forwards them to the captured app process.
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

    // Mouse events
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

    // Keyboard events
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
