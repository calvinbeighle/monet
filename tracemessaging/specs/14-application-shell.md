# 14 - Application Shell

## Topic Statement

The application shell is the outermost UI container that manages layout, navigation, authentication state, and loading sequences.

## Scope

**In-scope:** Layout regions, shell lifecycle states, navigation between timeline and detail views, loading/error states, responsive behavior.

**Boundaries:** Content of the timeline (see 10) and detail view (see 11) is out of scope. Data ingestion is out of scope.

## Data Contracts

### Shell State

- Auth state: unauthenticated, authenticating, authenticated
- Data state: loading, loaded, error, offline
- Active view: timeline, detail (with workstream ID), settings
- Notification queue: list of { id, message, type (info/warning/error), timestamp, dismissable }

### Layout Regions

- Header bar: app name, search input, settings button, sync status indicator
- Main content: timeline view or detail view (mutually exclusive)
- Notification area: bottom-right stack of toast notifications

## Behaviors (execution order)

1. **Startup sequence**: App launches -> check authentication state -> if unauthenticated, show auth prompt (Gmail OAuth connect button) -> if authenticated, show loading state while ingestion sources initialize -> when at least one source has data, transition to timeline view.

2. **Header bar**: Always visible. Contains: "Trace" app name/logo, search input, settings gear icon, sync status indicator (green dot = synced, spinning = syncing, red dot = error, gray dot = offline).

3. **Sync status**: Reflects the aggregate state of all ingestion sources. If any source is actively fetching, show "syncing". If all sources have completed their latest cycle, show "synced". If any source has failed, show "error" with hover tooltip listing which sources failed.

4. **View navigation**: The shell manages two primary views - timeline and detail. Clicking a workstream card navigates to the detail view. The back button returns to timeline. Browser history (pushState) is updated so browser back/forward works.

5. **Settings view**: Accessible from the header gear icon. Contains: connected data sources (with connect/disconnect for each), sync intervals, notification preferences. Slides in as a panel or navigates to a settings page.

6. **Notifications**: Toast notifications stack in the bottom-right. Types: info (blue), warning (yellow), error (red). Auto-dismiss after 5 seconds for info, 10 seconds for warnings, manual dismiss only for errors. Maximum 3 visible; older ones queue.

7. **Offline mode**: If network is unavailable, the sync indicator shows "offline". All cached data remains navigable. Actions that require network (send email, refresh) show a "you're offline" message. Reconnection triggers automatic sync.

8. **Loading state**: On initial load, show a centered loading indicator with status text: "Connecting to Gmail...", "Reading browser tabs...", "Loading calendar...", etc. Each source shows a checkmark when complete.

9. **Error recovery**: If authentication expires mid-session, show a non-blocking banner prompting re-authentication. Cached data remains visible and navigable.

## Acceptance Criteria

- App launches with auth check and loading sequence
- Header shows app name, search, settings, and sync status
- Sync indicator reflects aggregate state of all data sources
- Navigation between timeline and detail views with browser history support
- Toast notifications with auto-dismiss behavior
- Offline mode shows cached data with "offline" indicator
- Loading state shows per-source progress
- Auth expiration shows non-blocking re-auth banner
