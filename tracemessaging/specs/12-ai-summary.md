# 12 - AI Summary and Recommended Actions

## Topic Statement

The AI generates per-workstream summaries of current status, key developments, and recommends the single most important next action.

## Scope

**In-scope:** Summary generation triggers, prompt design outcomes, recommended action types, refresh behavior, caching.

**Boundaries:** Workstream detection is out of scope (see 07). Executing recommended actions (email reply, etc.) is out of scope (see 13-email-actions). UI display is out of scope (see 11-workstream-detail-view).

## Data Contracts

### Input (per workstream)

- Workstream name and description
- All member activities (titles, participants, timestamps, previews, sources)
- Participant CRM enrichment (company, deal stage, relationship score)
- Previous summary (if any, for continuity)

### Output: Workstream Summary

- Status summary: 2-3 sentences describing current state of this workstream
- Key developments: up to 3 bullet points of what changed since last summary
- Recommended action: { type, description, targetActivityId, confidence }
  - Types: reply-email, schedule-meeting, review-document, follow-up, archive-workstream, no-action
- Urgency: low, medium, high (based on time sensitivity and relationship importance)
- Generated timestamp

## Behaviors (execution order)

1. **Generation trigger**: A summary is generated when: (a) a workstream is first created, (b) a new activity is added to the workstream, (c) the user explicitly requests refresh, (d) the cached summary is older than 30 minutes.

2. **AI call**: Send the workstream context (name, activities with titles/participants/timestamps/previews, CRM data) to Claude API. The prompt instructs Claude to: summarize the current state, identify what changed recently, and recommend the single most important next action.

3. **Recommended action**: The AI selects one action type and provides a description. The action must reference a specific activity (e.g., "Reply to John's email about the Q2 proposal" with the target email activity ID). If no action is needed, type is "no-action".

4. **Urgency assessment**: The AI evaluates urgency based on: time since last response (for email threads), upcoming deadlines (from calendar events), deal stage (from CRM), and explicit urgency signals in message content.

5. **Caching**: Generated summaries are cached in IndexedDB alongside the workstream record. Cached summaries are displayed immediately on load while background refresh runs.

6. **Continuity**: When regenerating a summary, the previous summary is included as context. This prevents the AI from repeating the same observations and encourages it to highlight what changed.

7. **Cost management**: Summary generation calls are debounced - if multiple activities arrive for the same workstream within 60 seconds, only one summary generation runs (after the 60-second window closes).

## Acceptance Criteria

- Each workstream has an AI-generated summary with status, key developments, and recommended action
- Summaries refresh when new activities arrive, on user request, or when cache is >30 minutes old
- Recommended action specifies a concrete next step with target activity
- Urgency assessment reflects time sensitivity and relationship importance
- Summaries are cached and display immediately on app load
- Generation is debounced (60-second window) to avoid excessive API calls
- Previous summary included as context for continuity
