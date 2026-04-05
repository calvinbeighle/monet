// BrowserPaneView.swift
// Unified
//
// NSViewRepresentable wrapping WKWebView for inline browsing.
// Observes AppState.currentURL and loads new URLs as they change.
// BrowserContainerView is the public-facing wrapper that adds a title
// label overlay and a loading progress bar.
//
// All popups, JS alerts, permission requests, and new-window navigations
// are handled inline - nothing escapes to a separate window or desktop.

import SwiftUI
import WebKit

// MARK: - BrowserPaneView

struct BrowserPaneView: NSViewRepresentable {

    var appState: AppState

    @Binding var actions: BrowserActions

    // MARK: NSViewRepresentable

    func makeCoordinator() -> Coordinator {
        Coordinator(appState: appState)
    }

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()

        // Allow JS to open windows (we intercept and load inline).
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = true

        // Persist cookies and session data across app restarts.
        configuration.websiteDataStore = .default()

        // Allow media autoplay for inline video.
        configuration.mediaTypesRequiringUserActionForPlayback = []

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator

        // Expose progress KVO so the coordinator can relay it upward.
        context.coordinator.webView = webView
        context.coordinator.startObservingProgress()

        // Wire the actions binding so the container can drive navigation.
        DispatchQueue.main.async {
            actions = BrowserActions(
                goBack: { [weak webView] in webView?.goBack() },
                goForward: { [weak webView] in webView?.goForward() },
                reload: { [weak webView] in webView?.reload() }
            )
        }

        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        guard let url = appState.currentURL else { return }

        let currentlyLoaded = webView.url
        if currentlyLoaded != url {
            let request = URLRequest(url: url)
            webView.load(request)
        }
    }

    // MARK: - Coordinator

    @Observable
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {

        var appState: AppState
        var loadingProgress: Double = 0.0
        weak var webView: WKWebView?

        private var progressObservation: NSKeyValueObservation?

        init(appState: AppState) {
            self.appState = appState
        }

        func startObservingProgress() {
            guard let webView else { return }
            progressObservation = webView.observe(
                \.estimatedProgress,
                options: [.new]
            ) { [weak self] webView, _ in
                DispatchQueue.main.async {
                    self?.loadingProgress = webView.estimatedProgress
                }
            }
        }

        deinit {
            progressObservation?.invalidate()
        }

        // MARK: WKNavigationDelegate

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            decisionHandler(.allow)
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationResponse: WKNavigationResponse,
            decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
        ) {
            decisionHandler(.allow)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            DispatchQueue.main.async { [weak self, weak webView] in
                self?.appState.pageTitle = webView?.title ?? ""
                // Sync the URL bar if the user navigated via a link.
                if let currentURL = webView?.url {
                    self?.appState.currentURL = currentURL
                }
            }
        }

        // Handle SSL errors by continuing (MVP - trust all for dev).
        func webView(
            _ webView: WKWebView,
            didReceive challenge: URLAuthenticationChallenge,
            completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
        ) {
            if challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
               let trust = challenge.protectionSpace.serverTrust {
                completionHandler(.useCredential, URLCredential(trust: trust))
            } else {
                completionHandler(.performDefaultHandling, nil)
            }
        }

        // MARK: WKUIDelegate - Popups and new windows

        /// Handle target="_blank" and window.open() - load in the same webView.
        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            if let url = navigationAction.request.url {
                webView.load(URLRequest(url: url))
            }
            return nil
        }

        // MARK: WKUIDelegate - JavaScript dialogs (rendered as native sheets)

        /// JS alert() - show as a native alert sheet attached to the webView's window.
        func webView(
            _ webView: WKWebView,
            runJavaScriptAlertPanelWithMessage message: String,
            initiatedByFrame frame: WKFrameInfo,
            completionHandler: @escaping () -> Void
        ) {
            let alert = NSAlert()
            alert.messageText = frame.request.url?.host ?? "Page"
            alert.informativeText = message
            alert.alertStyle = .informational
            alert.addButton(withTitle: "OK")

            if let window = webView.window {
                alert.beginSheetModal(for: window) { _ in
                    completionHandler()
                }
            } else {
                alert.runModal()
                completionHandler()
            }
        }

        /// JS confirm() - show as a native confirm sheet.
        func webView(
            _ webView: WKWebView,
            runJavaScriptConfirmPanelWithMessage message: String,
            initiatedByFrame frame: WKFrameInfo,
            completionHandler: @escaping (Bool) -> Void
        ) {
            let alert = NSAlert()
            alert.messageText = frame.request.url?.host ?? "Page"
            alert.informativeText = message
            alert.alertStyle = .informational
            alert.addButton(withTitle: "OK")
            alert.addButton(withTitle: "Cancel")

            if let window = webView.window {
                alert.beginSheetModal(for: window) { response in
                    completionHandler(response == .alertFirstButtonReturn)
                }
            } else {
                let response = alert.runModal()
                completionHandler(response == .alertFirstButtonReturn)
            }
        }

        /// JS prompt() - show as a native text input sheet.
        func webView(
            _ webView: WKWebView,
            runJavaScriptTextInputPanelWithPrompt prompt: String,
            defaultText: String?,
            initiatedByFrame frame: WKFrameInfo,
            completionHandler: @escaping (String?) -> Void
        ) {
            let alert = NSAlert()
            alert.messageText = frame.request.url?.host ?? "Page"
            alert.informativeText = prompt
            alert.alertStyle = .informational
            alert.addButton(withTitle: "OK")
            alert.addButton(withTitle: "Cancel")

            let textField = NSTextField(frame: NSRect(x: 0, y: 0, width: 260, height: 24))
            textField.stringValue = defaultText ?? ""
            alert.accessoryView = textField

            if let window = webView.window {
                alert.beginSheetModal(for: window) { response in
                    if response == .alertFirstButtonReturn {
                        completionHandler(textField.stringValue)
                    } else {
                        completionHandler(nil)
                    }
                }
            } else {
                let response = alert.runModal()
                if response == .alertFirstButtonReturn {
                    completionHandler(textField.stringValue)
                } else {
                    completionHandler(nil)
                }
            }
        }

        // MARK: WKUIDelegate - Permissions

        /// Handle media capture permission requests (camera, microphone).
        /// Auto-grant for MVP so sites like Google Meet, Zoom, etc. work inline.
        func webView(
            _ webView: WKWebView,
            requestMediaCapturePermissionFor origin: WKSecurityOrigin,
            initiatedByFrame frame: WKFrameInfo,
            type: WKMediaCaptureType,
            decisionHandler: @escaping (WKPermissionDecision) -> Void
        ) {
            // Show a native alert asking the user, then grant or deny.
            let typeLabel: String
            switch type {
            case .camera: typeLabel = "camera"
            case .microphone: typeLabel = "microphone"
            case .cameraAndMicrophone: typeLabel = "camera and microphone"
            @unknown default: typeLabel = "media"
            }

            let alert = NSAlert()
            alert.messageText = "Permission Request"
            alert.informativeText = "\(origin.host) wants to use your \(typeLabel)."
            alert.alertStyle = .informational
            alert.addButton(withTitle: "Allow")
            alert.addButton(withTitle: "Deny")

            if let window = webView.window {
                alert.beginSheetModal(for: window) { response in
                    decisionHandler(response == .alertFirstButtonReturn ? .grant : .deny)
                }
            } else {
                let response = alert.runModal()
                decisionHandler(response == .alertFirstButtonReturn ? .grant : .deny)
            }
        }

    }
}

// MARK: - BrowserActions

struct BrowserActions {
    var goBack: () -> Void = {}
    var goForward: () -> Void = {}
    var reload: () -> Void = {}
}

// MARK: - BrowserContainerView

struct BrowserContainerView: View {

    var appState: AppState

    @State private var browserActions = BrowserActions()
    @State private var coordinator: BrowserPaneView.Coordinator?

    private var loadingProgress: Double {
        coordinator?.loadingProgress ?? 0
    }

    private var isLoading: Bool {
        loadingProgress > 0 && loadingProgress < 1
    }

    var body: some View {
        ZStack(alignment: .top) {
            BrowserPaneView(appState: appState, actions: $browserActions)
                .ignoresSafeArea()

            // Progress bar.
            if isLoading {
                GeometryReader { geometry in
                    Rectangle()
                        .fill(Color.accentColor.opacity(0.85))
                        .frame(width: geometry.size.width * loadingProgress, height: 3)
                        .animation(.linear(duration: 0.1), value: loadingProgress)
                }
                .frame(height: 3)
                .transition(.opacity)
            }

            // Page title label.
            if !appState.pageTitle.isEmpty {
                HStack {
                    Text(appState.pageTitle)
                        .font(.system(size: 11, weight: .regular))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 6))
                        .padding(.top, 8)
                        .padding(.leading, 12)
                    Spacer()
                }
            }
        }
        .background {
            Group {
                Button("") { browserActions.goBack() }
                    .keyboardShortcut("[", modifiers: .command)
                    .hidden()
                Button("") { browserActions.goForward() }
                    .keyboardShortcut("]", modifiers: .command)
                    .hidden()
                Button("") { browserActions.reload() }
                    .keyboardShortcut("r", modifiers: .command)
                    .hidden()
            }
            .frame(width: 0, height: 0)
        }
    }
}
