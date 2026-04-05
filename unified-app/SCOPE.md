# Unified Mac App - Scope

## Vision

One fullscreen surface that replaces the desktop - a smart bar, inline browser, and persistent chat unified into a single interface where the user never switches contexts.

## The Smart Bar

Always visible at the top. Single text input. As the user types, a dropdown shows ranked predictions.

### Intent prediction logic

Run these checks on every keystroke, in priority order:

1. **URL detection** - Input matches a URL pattern (`*.com`, `*.org`, `http://`, etc.) or starts with a known domain prefix (e.g. typing `git` suggests `github.com`). Show favicon + full URL in autocomplete.
2. **App matching** - Input fuzzy-matches an installed macOS app name (pulled from `/Applications` and `~/Applications`). Show app icon + name in autocomplete.
3. **Fallback to prompt** - If neither URL nor app matches with sufficient confidence, treat the input as an AI prompt. Show a chat icon + "Ask AI" label.

### Routing behavior

- **Enter on URL suggestion** - Load the URL in the browser pane
- **Enter on app suggestion** - Launch the app (initially via `NSWorkspace.open`, later embed via window capture)
- **Enter on prompt / no suggestion** - Send text to the chat surface
- **Escape** - Clear the bar, return focus to whatever was active

### Autocomplete details

- Recency-weighted: recently visited URLs and recently opened apps rank higher
- Max 5 suggestions visible at once
- First suggestion is auto-highlighted, arrow keys to navigate
- Typing continues to refine predictions without requiring explicit mode selection

## The Browser Pane

Inline web rendering powered by `WKWebView`. Loads URLs from the smart bar.

### Behavior

- Takes up the main content area below the bar
- Standard web navigation: back, forward, reload via keyboard shortcuts (Cmd+[, Cmd+], Cmd+R)
- No visible browser chrome - no address bar (the smart bar IS the address bar), no tabs (MVP is single-page)
- Page title shown as a subtle label near the top of the pane
- Links clicked within a page load in the same pane
- External auth flows (OAuth popups, etc.) handled via `WKWebView` navigation delegate

### Limitations (MVP)

- Single page at a time, no tabs
- No extensions
- No bookmarks (recency in the smart bar serves this role)
- Cookie/session persistence across app restarts via `WKWebsiteDataStore`

## The Chat Surface

Persistent conversation panel. Sits alongside the browser pane (right side, resizable divider).

### MVP scope

- Displays a single ongoing conversation thread
- Receives prompts routed from the smart bar
- Streams responses from an LLM API (Claude via Anthropic SDK)
- Supports markdown rendering in responses
- Conversation persists for the session (cleared on app restart for MVP)
- No file uploads, no tool use, no multi-turn context window management beyond basic message history

### Layout

- When no URL is loaded, chat takes the full content area
- When a URL is loaded, chat slides to a right panel (default 35% width)
- User can collapse/expand the chat panel

## Architecture

```
+----------------------------------------------------------+
|                     Smart Bar                            |
|  [text input] [autocomplete dropdown]                    |
+----------------------------------------------------------+
|                          |                               |
|     Browser Pane         |       Chat Surface            |
|     (WKWebView)          |       (SwiftUI List)          |
|                          |                               |
|                          |                               |
+----------------------------------------------------------+
```

### Components

- **SmartBarView** - SwiftUI view with NSTextField for low-latency keypress handling. Owns the intent prediction engine.
- **IntentEngine** - Pure Swift class. Takes a string, returns ranked `[Prediction]`. Queries URL history, app index, and applies heuristics. No async required for MVP.
- **BrowserPaneView** - Wraps `WKWebView` in a SwiftUI `NSViewRepresentable`. Exposes navigation actions.
- **ChatPanelView** - SwiftUI view with message list and streaming response display.
- **ChatService** - Handles Anthropic API calls. Streams responses via async/await.
- **AppIndexer** - On launch, scans `/Applications` and `~/Applications`, caches app names and icons. Refreshes on `NSWorkspace` notifications.
- **HistoryStore** - Lightweight SQLite (via SwiftData or raw SQLite) storing visited URLs with timestamps for recency ranking.

### Data flow

1. User types in SmartBar
2. SmartBar calls IntentEngine on each keystroke
3. IntentEngine returns predictions
4. On enter, SmartBar routes to BrowserPaneView.load(url:) or ChatService.send(prompt:) or NSWorkspace.open(app:)

## Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| UI framework | SwiftUI | Native Mac, fullscreen APIs, fast iteration |
| Text input | NSTextField (AppKit) | SwiftUI TextField lacks fine-grained keypress control needed for autocomplete |
| Browser engine | WKWebView | Only real option for inline web on macOS, works well |
| LLM API | Anthropic Claude API | Direct HTTP via URLSession, streaming via SSE |
| Local storage | SwiftData (SQLite) | URL history and app index persistence, ships with macOS 14+ |
| Build system | Xcode + Swift Package Manager | Standard for Mac apps |
| Minimum target | macOS 14 (Sonoma) | SwiftData requires it, reasonable baseline |

## Out of Scope (for now)

- Tabs / multiple browser pages
- Background agents or autonomous AI actions
- OAuth / account system
- Memory layer / long-term context
- File uploads or tool use in chat
- Browser extensions or content injection
- App embedding (capturing other app windows inside the surface)
- Menu bar mode or windowed mode (fullscreen only for MVP)
- Settings UI
- Multiple chat threads
- Keyboard shortcut customization
- Spotlight/Raycast replacement at the OS level (no global hotkey yet)

## Open Questions

1. **Global activation** - Should the app register a global hotkey (like Cmd+Space) to summon itself, or just be a fullscreen app you Cmd+Tab to? Global hotkey is more Raycast-like but conflicts with Spotlight.
2. **App launching vs embedding** - MVP launches apps externally via NSWorkspace. Longer term, do we capture app windows into the surface (like Stage Manager)? This is technically complex.
3. **Chat context awareness** - Should the chat know what URL is currently loaded in the browser? (e.g. "summarize this page") This is powerful but adds scope.
4. **URL autocomplete source** - Do we only use the app's own history, or also import Safari/Chrome history for cold start? Importing adds value but adds complexity and permissions.
5. **Fullscreen strategy** - Native macOS fullscreen (NSWindow.toggleFullScreen) or custom borderless window that fills the screen? Native plays nice with Mission Control but has animation quirks.

## MVP Success Metric

The app works when a user can type a URL and browse it inline, type a question and get an AI response, and type an app name and launch it - all from the same input field without ever thinking about which mode they are in.
