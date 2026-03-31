# 07 - Workstream Detection

## Topic Statement

The AI clusters normalized activity records from all sources into workstreams based on shared context signals (participants, topics, timing, projects).

## Scope

**In-scope:** Clustering algorithm inputs/outputs, workstream creation/merge/split rules, confidence scoring, initial detection on app load, continuous re-evaluation.

**Boundaries:** Data ingestion is out of scope (see specs 01-06). Real-time linking of new items is out of scope (see 09-context-linking). UI rendering is out of scope.

## Data Contracts

### Input: Activity Record (from any source)

- Source, source ID, timestamp, title, participants, preview, labels, metadata

### Output: Workstream

- Workstream ID (generated, stable)
- Name: AI-generated descriptive name (e.g., "Acme Corp Proposal", "tracemessaging Development")
- Activity IDs: ordered list of activity record IDs belonging to this workstream
- Participants: deduplicated union of all activity participants
- Sources: set of source types represented (e.g., {"gmail", "google-calendar", "git"})
- Created timestamp
- Last activity timestamp
- Confidence score: 0-1, how confident the AI is in the clustering
- Status: active, stale, archived
- AI rationale: one-sentence explanation of why these activities are grouped

### Clustering Signal Weights

- Participant overlap: highest weight. Shared email addresses across activities are the strongest grouping signal.
- Topic/keyword overlap: titles, subjects, and preview text with shared keywords or entity names.
- Temporal proximity: activities happening within the same time window (same day, same hour) are biased toward grouping.
- Project association: activities sharing the same git repo, Arc space, or Claude Code project directory.
- CRM association: activities involving contacts associated with the same HubSpot deal or company.
- Label/tag overlap: shared Gmail labels, Arc space names, calendar event series.

## Behaviors (execution order)

1. **Initial clustering**: On app load, after all ingestion sources have completed their initial fetch, run the clustering algorithm on all activity records from the past 14 days. This produces the initial set of workstreams.

2. **AI clustering call**: Send the activity records (titles, participants, timestamps, labels, source types) to Claude API. The prompt instructs Claude to identify distinct workstreams - clusters of activities that relate to the same project, relationship, or initiative. Claude returns a list of workstreams with names, member activity IDs, rationale, and confidence scores.

3. **Minimum cluster size**: A workstream must contain at least 2 activity records from at least 2 different sources. A single email with no other context does not form a workstream - it remains unassigned until more context arrives.

4. **Unassigned activities**: Activities that do not meet the clustering threshold remain in an "unassigned" pool. They are displayed in a separate section of the timeline. They are re-evaluated on every clustering cycle.

5. **Workstream merging**: If two workstreams share >60% of their participants and >40% of their topic keywords, the AI evaluates whether they should be merged. Merges require AI confirmation (not automatic threshold-based).

6. **Workstream splitting**: If an AI evaluation determines a workstream contains unrelated activities (confidence < 0.5 for some members), it proposes a split. The user is not prompted - the AI splits automatically but preserves the original workstream ID for the dominant cluster.

7. **Staleness**: A workstream with no new activity for 7 days transitions to "stale" status. Stale workstreams are visually de-emphasized but not removed. A workstream with no activity for 30 days transitions to "archived".

8. **Re-evaluation**: Every 5 minutes, re-run clustering on activities from the past 24 hours plus any unassigned activities. Existing workstreams are updated (new members added, confidence re-scored), not recreated. Workstream IDs are stable.

9. **User override**: The user can manually move an activity to a different workstream or create a new workstream. Manual assignments are never overridden by the AI. The AI treats manual assignments as strong signals for future clustering.

## Acceptance Criteria

- Clusters activities from 6 sources into named workstreams
- Each workstream has a descriptive AI-generated name and rationale
- Workstreams require activities from at least 2 sources
- Participant overlap is the strongest clustering signal
- Unassigned activities are displayed separately and re-evaluated
- Workstream IDs are stable across re-evaluation cycles
- Stale workstreams (7 days inactive) are de-emphasized
- Manual user assignments are never overridden by AI
- Re-evaluation runs every 5 minutes on recent activities
- Confidence scores reflect clustering quality
