# 10 - Workstream Timeline (TikTok-Style Feed)

## Topic Statement

The home screen is a full-viewport vertical swipe feed of workstreams. One workstream fills the entire screen. Scroll or swipe to move between workstreams. Each card is immersive and self-contained - like TikTok for your work.

## Scope

**In-scope:** Full-screen feed layout, snap scrolling, workstream card design, swipe gestures, urgency sorting, filter chips, triage mode for unassigned items, keyboard navigation, real-time feed updates.

**Boundaries:** Workstream detail view (expanding a card) is out of scope (see 11). Workstream detection logic is out of scope (see 07).

## Data Contracts

### Workstream Card (one per screen)

- **Top zone:** workstream name (large serif), urgency indicator (color-coded: red/amber/green/blue), relative timestamp, unread badge
- **Middle zone:** AI summary (2-3 sentences, italic serif), recommended action as prominent tappable button
- **Bottom zone:** source icons row, participant avatars (circular with CRM enrichment on hover), activity sparkline (7-day mini chart), action buttons (reply, archive, snooze)
- **Right edge (TikTok-style):** vertical icon column - bookmark, share, mute, archive. Appears on hover/focus.
- **Progress indicator:** between-card separator showing position ("3 of 7")

### Unassigned Activity Card (triage mode)

- Full-screen swipeable card (Tinder-style)
- Activity title, source icon, timestamp, preview text
- AI-suggested workstream assignment shown as overlay
- Swipe right = assign, left = dismiss, up = create new workstream

## Behaviors (execution order)

1. **Feed layout**: CSS scroll-snap (`scroll-snap-type: y mandatory`) ensures each workstream card snaps to fill the viewport. Smooth spring-physics scrolling between cards. Dark cinematic background (#0a0a0b).

2. **Sort order**: Urgent first (overdue items, items needing response), then by last activity timestamp (most recent). Stale workstreams appear at the bottom of the feed, visually de-emphasized (lower opacity, dashed border).

3. **Swipe gestures**: Swipe right on a card = execute the recommended action (with confirmation). Swipe left = snooze/dismiss for 4 hours. Swipe up/down = navigate between workstreams. Touch and mouse wheel both work.

4. **Real-time updates**: When new activity arrives for a workstream, it moves to the top of the feed. If the user is currently viewing that card, it updates in-place (summary refreshes, unread increments). If viewing a different card, a pulse indicator appears at the top of the feed.

5. **Filter chips**: Floating semi-transparent chips at top of screen: All / Urgent / Deals / Engineering / Stale. Filtering animates cards in/out with crossfade. Filter state persists across sessions.

6. **Triage mode**: Toggle via header button or navigating past the last workstream card. Shows unassigned activities as full-screen swipeable cards. Swipe right assigns to AI-suggested workstream, left dismisses, up creates new workstream. Badge on feed header shows triage count.

7. **Keyboard navigation**: J/K to scroll between workstreams, Enter to open detail view, A to assign, R to reply to most recent email, Cmd+K for command palette search.

8. **Staggered entry**: On initial load, cards animate in with staggered fade-up (50ms delay between each). Sparklines draw in from left to right.

9. **Empty state**: Cinematic onboarding - full-screen dark card with staggered source connection progress (each source gets a line item with checkmark animation as it connects).

## ANTI-PATTERNS (DO NOT BUILD)

- DO NOT build a scrollable list of small cards. This is NOT an inbox.
- DO NOT use `max-w-[800px]` centered content. Cards must be FULL VIEWPORT.
- DO NOT show an empty state with "No workstreams yet" and small text. Show a cinematic loading/onboarding experience.
- DO NOT put all workstreams visible at once. ONE workstream per screen, scroll-snap between them.

## CSS Implementation Requirements

The feed container MUST use:

```css
scroll-snap-type: y mandatory;
height: 100vh; /* or calc(100vh - header height) */
overflow-y: scroll;
```

Each card MUST use:

```css
scroll-snap-align: start;
height: 100vh; /* or calc(100vh - header height) */
```

This is non-negotiable. The entire UX depends on one-card-per-screen snap scrolling.

## Acceptance Criteria

- Each workstream occupies the full viewport height with scroll-snap
- Smooth snap scrolling between workstreams (spring physics, not linear)
- Cards show name, AI summary, urgency, sources, participants, sparkline, recommended action
- Swipe right executes recommended action with confirmation
- Filter chips filter the feed in-place with animation
- Real-time: new activity pushes workstream to top with animation
- Triage mode shows unassigned items as swipeable full-screen cards
- Keyboard navigation works (J/K/Enter/A/R)
- Stale workstreams appear de-emphasized at end of feed
- Dark theme with urgency color coding (red/amber/green/blue)
- When fixtures load, workstreams appear immediately - no empty state unless truly zero data
