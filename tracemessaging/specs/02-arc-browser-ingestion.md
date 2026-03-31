# 02 - Arc Browser Context Ingestion

## Topic Statement

The system reads Arc browser data to understand what the user is browsing and when, providing browsing context for workstream detection.

## Scope

**In-scope:** Reading Arc sidebar JSON files, archived tabs, and History SQLite databases; extracting tab/space/browsing state; normalizing into activity records; tracking browsing over time.

**Boundaries:** Workstream assignment is out of scope (see 07-workstream-detection). Browser automation or control is out of scope.

## Data Sources (confirmed on this machine)

Arc stores data in `~/Library/Application Support/Arc/`. Three usable sources exist:

### 1. StorableSidebar.json (current tabs, ~979KB, updated live)

- Structure: `sidebar.containers[].items[]`
- Each item: `data.tab.savedURL`, `data.tab.savedTitle`, `createdAt`
- Contains ~134 current/pinned sidebar items across all spaces
- Updated in real-time as Arc sidebar changes

### 2. StorableArchiveItems.json (archived tabs, ~3.9MB)

- Contains ~4,030 auto-archived tabs
- Each entry: `sidebarItem.data.tab.savedURL`, `sidebarItem.data.tab.savedTitle`, `archivedAt`, `reason`, `source.space`
- Historical archive going back months
- Space name preserved via `source.space`

### 3. History SQLite databases (Chromium-format, per-profile)

- Location: `User Data/Profile {N}/History`
- Primary profiles: Profile 13 (~58,800 URLs, 144MB), Profile 8 (~57,000 URLs, 100MB), Profile 9 (~48,500 URLs, 70MB)
- Schema: `urls(id, url, title, visit_count, typed_count, last_visit_time, hidden)` + `visits(id, url, visit_time, from_visit, visit_duration, transition)`
- Timestamps: Windows FILETIME (microseconds since 1601-01-01)
- Locked while Arc is running; read via immutable URI mode: `file:///path/History?immutable=1&mode=ro`

### Not usable

- `StorableArchive.json` - contains only `{ version, autoArchiveStartTime }`, not tab data
- Dated `StorableArchive.*.json` snapshots - 64 bytes each, empty placeholders

### Historical sidebar snapshots

- Dated `StorableSidebar.YYYY-MM-DD-*.json` files exist (~960KB+ each)
- Full historical sidebar state at various points in time
- Not locked, can be read freely

## Data Contracts

### Normalized Activity Record (output)

- Source: "arc-browser"
- Source ID: hash of (url + space name)
- Timestamp: lastAccessed, archivedAt, or visit_time
- Title: tab title
- Participants: [] (no participants for browser tabs)
- Preview: URL domain + path summary
- Body: null
- Labels: [space name] (from sidebar or archive source.space)
- Metadata: { url, spaceName, isPinned, isBookmark, domain, visitCount, dataSource }

## Behaviors (execution order)

1. **Data source discovery**: On startup, check for StorableSidebar.json at the known path. If not found, fall back to History SQLite databases. If neither exists, log a warning and skip browser ingestion entirely. No error shown to user.

2. **Current tab read**: Parse StorableSidebar.json. Extract all items with saved URLs. Each tab becomes one activity record. Preserve space/container context as labels.

3. **Archived tab read**: Parse StorableArchiveItems.json. Extract tabs archived within the past 7 days. Each becomes one activity record. Space name from `source.space` preserved as label.

4. **History read (optional, for richer context)**: Open History SQLite via immutable URI mode. Query `urls` table joined with `visits` for past 7 days. Convert Windows FILETIME timestamps to Unix epoch. Each distinct URL visit becomes one activity record. Profile 13 is the primary profile.

5. **Periodic re-read**: Re-read StorableSidebar.json every 60 seconds. Compare against the previous read. Emit new activity records for tabs that appeared or changed. Update timestamps for tabs whose state changed.

6. **Domain extraction**: For each URL, extract the domain and a readable path summary (e.g., "github.com/anthropics/claude-code" becomes domain "github.com", path "anthropics/claude-code"). This aids workstream detection keyword matching.

7. **Space context**: Arc spaces/containers represent user-defined groupings. The space name is preserved as a label on each activity record. Tabs in the same space share a contextual relationship.

## Acceptance Criteria

- Reads current Arc sidebar state and extracts all tabs with URLs and titles
- Reads archived tabs from StorableArchiveItems.json for past 7 days
- Optionally reads History SQLite for richer browsing context
- Re-reads sidebar every 60 seconds and detects new/changed tabs
- Extracts domain and path from URLs for keyword matching
- Preserves Arc space names as labels on activity records
- Gracefully skips if Arc data is not found (no error to user)
