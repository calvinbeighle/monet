# 09 - Context Linking

## Topic Statement

When a new activity arrives from any source, the system determines in real time which existing workstream it belongs to and attaches it automatically.

## Scope

**In-scope:** Real-time evaluation of incoming activities against existing workstreams, confidence-based assignment, notification of new assignments.

**Boundaries:** Initial bulk clustering is out of scope (see 07-workstream-detection). Workstream creation from scratch is out of scope (see 07). UI rendering is out of scope.

## Data Contracts

### Input

- New activity record (from any ingestion source)
- Existing workstreams (with their activity members, participants, keywords)

### Output

- Assignment decision: { workstreamId (or null), confidence, rationale }

## Behaviors (execution order)

1. **Trigger**: Every time an ingestion source emits a new or updated activity record, the context linking system evaluates it against existing workstreams.

2. **Fast-path matching**: Before calling the AI, check for strong deterministic signals:
   - Same Gmail thread ID as an existing workstream member: assign immediately (confidence 1.0)
   - Same event series (recurring calendar) as an existing member: assign immediately (confidence 1.0)
   - Same git repo + branch as an existing member: assign with high confidence (0.9)

3. **AI evaluation**: If no fast-path match, send the new activity (title, participants, preview, source, timestamp) plus summaries of the top 5 candidate workstreams (by participant overlap and recency) to Claude API. Claude returns: assigned workstream ID (or null), confidence score, one-sentence rationale.

4. **Confidence threshold**: If AI confidence >= 0.7, assign automatically. If 0.4-0.7, assign but flag as "uncertain" for user review. If < 0.4, leave unassigned.

5. **Batching**: If multiple activities arrive within a 5-second window, batch them into a single AI evaluation call for efficiency.

6. **Assignment notification**: When a new activity is assigned to a workstream, the workstream's unread count increments and a notification is emitted for the timeline UI.

7. **Re-linking on workstream change**: If a workstream is merged, split, or has activities manually reassigned, re-evaluate all uncertain assignments (confidence < 0.7) in affected workstreams.

## Acceptance Criteria

- New activities from any source are evaluated against existing workstreams in real time
- Deterministic fast-path matches (same thread, same series, same repo) assign instantly
- AI evaluation returns assignment with confidence and rationale
- High-confidence assignments (>= 0.7) are automatic
- Uncertain assignments (0.4-0.7) are flagged for user review
- Low-confidence activities (< 0.4) remain unassigned
- Multiple activities within 5 seconds are batched into one AI call
- Workstream unread count updates on new assignment
