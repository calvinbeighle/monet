# 13 - Email Actions

## Topic Statement

The user can reply to, draft, archive, and label emails directly from within a workstream context, with all actions flowing through Gmail.

## Scope

**In-scope:** Reply composition, draft management, archive/label actions, optimistic local updates, error handling/rollback.

**Boundaries:** Gmail data fetching is out of scope (see 01-gmail-ingestion). Workstream display is out of scope (see 11-workstream-detail-view). AI-drafted replies are out of scope for MVP (future enhancement).

## Data Contracts

### Reply Composition

- Thread ID: Gmail thread ID being replied to
- In-Reply-To: RFC 2822 Message-ID of the message being replied to
- References: chain of Message-IDs for threading
- Recipients: to, cc, bcc (pre-populated from original message)
- Subject: "Re: [original subject]"
- Body: user-composed HTML
- Workstream context: the workstream this reply is being sent from (for context preservation)

### Draft

- Draft ID: Gmail draft ID (null for new unsaved drafts)
- Thread ID
- Recipients, subject, body (same as reply)
- State: unsaved, saved, dirty (edited since last save), sending, discarded

### Action Result

- Success: boolean
- Gmail response (if success)
- Error message (if failure)
- Rollback action (for optimistic updates)

## Behaviors (execution order)

1. **Reply initiation**: From the workstream detail view, clicking "Reply" on an email activity opens a reply composer. Recipients are pre-populated from the original message (Reply: sender only; Reply All: all recipients). The composer appears inline below the email in the activity timeline.

2. **Composition**: Rich text editor with basic formatting (bold, italic, links, lists). The workstream context is visible alongside the composer so the user can reference other activities while writing.

3. **Draft auto-save**: After the user begins typing, drafts auto-save to Gmail every 30 seconds. Draft state transitions: unsaved -> saved -> dirty (on edit) -> saved (on auto-save). Drafts persist across app restarts via Gmail API.

4. **Send**: Sending the reply calls the Gmail API via Nango proxy. Before send: the exact recipient, subject, and body are displayed for confirmation. User must explicitly confirm. Optimistic local update: the reply appears immediately in the activity timeline as "sending". On success, the activity updates to "sent". On failure, the activity shows an error and the user can retry.

5. **Archive**: Archive action removes the INBOX label via Gmail API. Optimistic local update: the email disappears from the workstream immediately. On failure, it reappears with an error notification.

6. **Label**: User can apply or remove Gmail labels. Changes are sent to Gmail API. Optimistic local update with rollback on failure.

7. **Threading**: Replies must set In-Reply-To (RFC 2822 Message-ID header), References chain, and matching "Re:" subject. All three are required for Gmail to thread correctly.

8. **Workstream context preservation**: After sending a reply, the email activity in the workstream updates to reflect the new message. The workstream's last activity timestamp updates. The AI summary re-evaluates.

## Acceptance Criteria

- Reply composer opens inline with pre-populated recipients
- Rich text editing with basic formatting
- Drafts auto-save to Gmail every 30 seconds
- Send requires explicit user confirmation showing recipient, subject, body
- Optimistic local updates with rollback on failure
- Archive removes INBOX label and updates locally
- Threading headers (In-Reply-To, References, Re: subject) are set correctly
- Workstream context updates after send (timestamp, summary re-evaluation)
