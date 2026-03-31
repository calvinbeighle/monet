# 11 - Workstream Detail View

## Topic Statement

The detail view is a full-screen takeover that slides up over the feed (like expanding a TikTok comment section), showing all context for a single workstream in one immersive view.

## Scope

**In-scope:** Slide-up transition, sticky AI summary card, activity feed within workstream, participant drawer, source filtering, workstream editing, merge UI.

**Boundaries:** Email reply composition is out of scope (see 13-email-actions). AI summary generation is out of scope (see 12-ai-summary). Workstream detection is out of scope (see 07).

## Data Contracts

### Detail View Layout

1. **Sticky header**: workstream name (editable inline, large serif), urgency badge, close button, participant avatars row
2. **AI summary card**: pinned below header with frosted glass background. Summary text, recommended action button, "last updated" timestamp, refresh icon. Always visible even when scrolling.
3. **Activity feed**: scrollable list below summary card. Each activity is an expandable card.
4. **Participant drawer**: slides in from right edge on swipe or button tap.

### Activity Feed Entry

- Source icon (colored by source type) and source label
- Timestamp (relative, absolute on hover)
- Title
- Preview (expandable to full body for emails)
- Participants involved in this specific activity
- Contextual action button (reply for email, open link for browser, view diff for git)

## Behaviors (execution order)

1. **Open transition**: Tapping a workstream card in the feed triggers a slide-up transition. The feed stays underneath, blurred. The detail view covers ~95% of the screen. Swipe down or tap the dimmed area above to dismiss.

2. **AI summary card**: Pinned at top with frosted glass effect (`backdrop-filter: blur`). Shows current AI summary, recommended action as a prominent button, and "last updated X ago" timestamp. Refresh button regenerates. This card does NOT scroll with the activity feed - it stays visible as an anchor.

3. **Activity feed**: Below the summary card, all member activities displayed chronologically (newest at top). Each entry is a card with source icon, timestamp, title, and preview. Email: tap to expand full body inline (HTML rendered). Calendar: time block, attendee list, meeting link button. Git: commit hash + message + changed file count (tap to expand file list). Browser: favicon + title + URL (tap to open). Claude: session title + project path.

4. **Source filter tabs**: Horizontal scrolling tabs above activity feed (All / Email / Calendar / Git / Browser / Claude). Slide animation when switching. "All" is default. Filtering does NOT affect the AI summary card.

5. **Participant drawer**: Swipe from right edge or tap participant avatars in header. Slides in as a right-side panel (40% width). Each participant card shows: name, email, company (CRM), deal names, relationship score, last interaction time. Tap a participant to filter the activity feed to just their activities.

6. **Workstream editing**: Name is editable inline (tap to focus, Enter to save). Remove individual activities via swipe-left on activity card (sends to unassigned). Add activities via "+" button that opens a search/picker for unassigned items.

7. **Workstream merge**: Long-press on header (or three-dot menu) -> "Merge with..." -> bottom sheet with searchable workstream list -> confirm dialog showing both workstreams' activity counts -> merge animation (activities flow from source to target).

8. **Unread marking**: Opening detail view marks ALL activities as viewed. Unread badge on the feed card resets to 0.

9. **Back/dismiss**: Swipe down to dismiss (parallax drag with rubber-band at edges). Back button in header also dismisses. Browser pushState for `/workstream/:id` (deep-linkable). Feed scroll position preserved on return.

## Acceptance Criteria

- Detail view slides up over the blurred feed
- AI summary card stays pinned at top while activity feed scrolls
- Activities displayed chronologically with expandable content
- Source filter tabs filter activity feed with animation
- Participant drawer slides in from right edge with CRM data
- Workstream name editable inline
- Activities removable via swipe-left, addable via picker
- Merge UI accessible via long-press or menu
- Swipe down dismisses back to feed
- Opening clears unread count
