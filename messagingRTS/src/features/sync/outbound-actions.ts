// Outbound actions per Spec 01 Sections 4-6 and Spec 10 Section 4
// Orchestrates reply, draft, and archive with optimistic local updates,
// rollback on failure, and offline queueing.
//
// Why this module exists: Gmail API calls live in gmail-client.ts (transport),
// but the application needs an orchestration layer that:
// 1. Applies optimistic updates to local state before the API confirms
// 2. Rolls back on failure so the user sees consistent state
// 3. Queues actions when offline for ordered replay on reconnect
// 4. Tracks draft lifecycle (None -> Unsaved -> Saved -> Dirty -> Sending)
// 5. Validates inputs per Spec 01 before submitting

import {
  sendReply,
  createDraft,
  updateDraft,
  deleteDraft,
  archiveThread,
} from "../auth/gmail-client";
import type { SendReplyPayload, DraftPayload } from "../auth/gmail-client";
import { useThreadStore } from "../../lib/stores";
import { useSyncStore } from "../../lib/stores/sync-store";
import { useAppStore } from "../../lib/stores";
import type { Thread, ThreadMessage } from "../../lib/types";

// --- Draft State Machine per Spec 01 ---
// None -> Unsaved: user begins typing
// Unsaved -> Saved: first explicit save to Gmail succeeds
// Saved -> Dirty: user modifies content after a save
// Dirty -> Saved: save to Gmail succeeds
// Saved/Dirty -> Sending: user triggers send
// Sending -> None: send succeeds
// Sending -> Saved: send fails, draft preserved
// Any -> Discarded -> None: user discards

export type DraftState = "none" | "unsaved" | "saved" | "dirty" | "sending" | "discarded";

export interface DraftRecord {
  threadId: string;
  gmailDraftId: string | null;
  body: string;
  state: DraftState;
}

// Per-thread draft tracking (module-level, not in Zustand because draft content
// is transient compose state, not application state that other components observe)
const draftRecords = new Map<string, DraftRecord>();

// Injectable functions for testing
let _sendReply = sendReply;
let _createDraft = createDraft;
let _updateDraft = updateDraft;
let _deleteDraft = deleteDraft;
let _archiveThread = archiveThread;

export function _setOutboundFns(fns: {
  sendReply?: typeof sendReply;
  createDraft?: typeof createDraft;
  updateDraft?: typeof updateDraft;
  deleteDraft?: typeof deleteDraft;
  archiveThread?: typeof archiveThread;
}): void {
  if (fns.sendReply) _sendReply = fns.sendReply;
  if (fns.createDraft) _createDraft = fns.createDraft;
  if (fns.updateDraft) _updateDraft = fns.updateDraft;
  if (fns.deleteDraft) _deleteDraft = fns.deleteDraft;
  if (fns.archiveThread) _archiveThread = fns.archiveThread;
}

export function _resetOutboundFns(): void {
  _sendReply = sendReply;
  _createDraft = createDraft;
  _updateDraft = updateDraft;
  _deleteDraft = deleteDraft;
  _archiveThread = archiveThread;
}

export function _clearDraftRecords(): void {
  draftRecords.clear();
}

// --- Draft State Queries ---

export function getDraftRecord(threadId: string): DraftRecord | undefined {
  return draftRecords.get(threadId);
}

export function getDraftState(threadId: string): DraftState {
  return draftRecords.get(threadId)?.state ?? "none";
}

// --- Draft Content Management ---

export function beginDraft(threadId: string, body: string): void {
  draftRecords.set(threadId, {
    threadId,
    gmailDraftId: null,
    body,
    state: "unsaved",
  });
}

export function updateDraftContent(threadId: string, body: string): void {
  const record = draftRecords.get(threadId);
  if (!record) {
    if (body.length > 0) {
      beginDraft(threadId, body);
    }
    return;
  }
  record.body = body;
  if (record.state === "saved") {
    record.state = "dirty";
  }
}

function clearDraftRecord(threadId: string): void {
  draftRecords.delete(threadId);
}

// --- Reply Action (Spec 01 Section 4) ---

export async function sendReplyAction(
  threadId: string,
  payload: SendReplyPayload,
): Promise<boolean> {
  const threadStore = useThreadStore.getState();
  const thread = threadStore.getThread(threadId);
  if (!thread) return false;

  // Validate per Spec 01: at least one recipient and non-empty body
  if (payload.to.length === 0) {
    useAppStore.getState().addNotification({
      message: "Reply requires at least one recipient.",
      severity: "warning",
    });
    return false;
  }
  if (!payload.body.trim()) {
    useAppStore.getState().addNotification({
      message: "Reply body cannot be empty.",
      severity: "warning",
    });
    return false;
  }

  // Check connectivity - if offline, queue per Spec 10 Section 8
  const connectivity = useSyncStore.getState().connectivityStatus;
  if (connectivity === "offline") {
    useSyncStore.getState().enqueueAction({
      type: "reply",
      threadId,
      payload,
      userInitiatedTimestamp: Date.now(),
    });
    // Optimistic update even when offline
    applyReplyOptimisticUpdate(threadId, thread, payload);
    useAppStore.getState().addNotification({
      message: "Reply queued. Will send when connection is restored.",
      severity: "info",
    });
    return true;
  }

  // Optimistic update per Spec 01: sent message appears immediately
  const snapshot = snapshotThread(thread);
  const optimisticMsgId = `optimistic-${Date.now()}`;
  applyReplyOptimisticUpdate(threadId, thread, payload, optimisticMsgId);

  // Update draft state to sending
  const draftRecord = draftRecords.get(threadId);
  if (draftRecord) {
    draftRecord.state = "sending";
  }

  try {
    const result = await _sendReply(payload);

    // Replace optimistic message ID with real Gmail message ID
    const updatedThread = useThreadStore.getState().getThread(threadId);
    if (updatedThread) {
      threadStore.updateThread(threadId, {
        messages: updatedThread.messages.map((m) =>
          m.id === optimisticMsgId ? { ...m, id: result.id } : m,
        ),
      });
    }

    // Clear draft on successful send per Spec 01: Sending -> None
    clearDraftRecord(threadId);

    return true;
  } catch {
    // Rollback per Spec 01: on failure, composed reply text is preserved
    threadStore.setThread(snapshot);

    // Draft transitions: Sending -> Saved (draft preserved)
    if (draftRecord) {
      draftRecord.state = draftRecord.gmailDraftId ? "saved" : "unsaved";
    }

    useAppStore.getState().addNotification({
      message: "Failed to send reply. Your draft has been preserved.",
      severity: "critical",
    });
    return false;
  }
}

function applyReplyOptimisticUpdate(
  threadId: string,
  thread: Thread,
  payload: SendReplyPayload,
  optimisticMsgId?: string,
): void {
  const now = Date.now();
  const optimisticMessage: ThreadMessage = {
    id: optimisticMsgId ?? `optimistic-${now}`,
    sender: "me",
    recipients: payload.to,
    cc: payload.cc ?? [],
    bcc: [],
    timestamp: now,
    bodyPlain: payload.body,
    bodyHtml: "",
    labelIds: ["SENT"],
    attachments: [],
  };

  useThreadStore.getState().updateThread(threadId, {
    messages: [...thread.messages, optimisticMessage],
    messageCount: thread.messageCount + 1,
    latestMessageTimestamp: now,
    // Per Spec 07: risk reset to safe + clock restart on reply
    riskTier: "safe",
    riskTimerStart: now,
    lastUserReplyTimestamp: now,
    neglectDuration: 0,
  });
}

// --- Draft Actions (Spec 01 Section 5) ---

export async function saveDraftAction(threadId: string, payload: DraftPayload): Promise<boolean> {
  const record = draftRecords.get(threadId);

  // Check connectivity - queue if offline
  const connectivity = useSyncStore.getState().connectivityStatus;
  if (connectivity === "offline") {
    useSyncStore.getState().enqueueAction({
      type: "draft-save",
      threadId,
      payload,
      userInitiatedTimestamp: Date.now(),
    });
    // Mark as saved optimistically
    if (record) {
      record.body = payload.body;
      record.state = "saved";
    } else {
      draftRecords.set(threadId, {
        threadId,
        gmailDraftId: null,
        body: payload.body,
        state: "saved",
      });
    }
    return true;
  }

  try {
    if (record?.gmailDraftId) {
      // Update existing draft per Spec 01: subsequent saves update the same draft
      const result = await _updateDraft(record.gmailDraftId, payload);
      record.gmailDraftId = result.id;
      record.body = payload.body;
      record.state = "saved";
    } else {
      // Create new draft per Spec 01: assigned a Gmail draft ID on first save
      const result = await _createDraft(payload);
      draftRecords.set(threadId, {
        threadId,
        gmailDraftId: result.id,
        body: payload.body,
        state: "saved",
      });
    }
    return true;
  } catch {
    useAppStore.getState().addNotification({
      message: "Failed to save draft.",
      severity: "warning",
    });
    return false;
  }
}

export async function discardDraftAction(threadId: string): Promise<boolean> {
  const record = draftRecords.get(threadId);
  if (!record) return true;

  // Check connectivity - queue if offline
  const connectivity = useSyncStore.getState().connectivityStatus;
  if (connectivity === "offline" && record.gmailDraftId) {
    useSyncStore.getState().enqueueAction({
      type: "draft-discard",
      threadId,
      payload: { draftId: record.gmailDraftId },
      userInitiatedTimestamp: Date.now(),
    });
    record.state = "discarded";
    draftRecords.delete(threadId);
    return true;
  }

  try {
    if (record.gmailDraftId) {
      // Per Spec 01: on discard, the draft is deleted from Gmail
      await _deleteDraft(record.gmailDraftId);
    }
    record.state = "discarded";
    draftRecords.delete(threadId);
    return true;
  } catch {
    useAppStore.getState().addNotification({
      message: "Failed to discard draft from Gmail.",
      severity: "warning",
    });
    return false;
  }
}

// --- Archive Action (Spec 01 Section 6) ---

export async function archiveThreadAction(threadId: string): Promise<boolean> {
  const threadStore = useThreadStore.getState();
  const thread = threadStore.getThread(threadId);
  if (!thread) return false;

  // Check connectivity - queue if offline
  const connectivity = useSyncStore.getState().connectivityStatus;
  if (connectivity === "offline") {
    useSyncStore.getState().enqueueAction({
      type: "archive",
      threadId,
      payload: null,
      userInitiatedTimestamp: Date.now(),
    });
    // Optimistic update even when offline per Spec 10 Section 8
    applyArchiveOptimisticUpdate(threadId, thread);
    useAppStore.getState().addNotification({
      message: "Archive queued. Will apply when connection is restored.",
      severity: "info",
    });
    return true;
  }

  // Optimistic update per Spec 01: thread immediately removed from Inbox view
  const snapshot = snapshotThread(thread);
  applyArchiveOptimisticUpdate(threadId, thread);

  try {
    await _archiveThread(threadId);
    return true;
  } catch {
    // Rollback per Spec 01: thread remains in Inbox view, user is informed
    threadStore.setThread(snapshot);
    useAppStore.getState().addNotification({
      message: "Failed to archive thread.",
      severity: "warning",
    });
    return false;
  }
}

function applyArchiveOptimisticUpdate(threadId: string, thread: Thread): void {
  useThreadStore.getState().updateThread(threadId, {
    gmailLabels: thread.gmailLabels.filter((l) => l !== "INBOX"),
    visualState: "archived",
  });
}

// Deep-copy thread for rollback (spread only does shallow copy of arrays)
function snapshotThread(thread: Thread): Thread {
  return {
    ...thread,
    participants: [...thread.participants],
    messages: thread.messages.map((m) => ({ ...m })),
    gmailLabels: [...thread.gmailLabels],
    stateHistory: [...thread.stateHistory],
  };
}
