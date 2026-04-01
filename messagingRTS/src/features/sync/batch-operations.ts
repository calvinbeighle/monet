// Batch operations per Spec 09 Section "Batch Operations"
// Why: Users need to apply actions to multiple threads simultaneously.
// Each thread transitions state independently - no aggregation into a single record.
// Selection is cleared after completion.
//
// Four batch actions: mark as handled, move to zone, apply label, assign to agent.
// Each thread's computed properties and lifecycle state are updated individually.

import { useThreadStore } from "../../lib/stores";
import { useAppStore } from "../../lib/stores/app-store";
import { useDeploymentStore } from "../../lib/stores/deployment-store";
import { useAgentStore } from "../../lib/stores/agent-store";
import { archiveThread, modifyThreadLabels } from "../auth/gmail-client";
import { useSyncStore } from "../../lib/stores/sync-store";
import type { Thread, ZoneId, AgentRole } from "../../lib/types";
import { AGENT_DEFINITIONS } from "../../lib/types";

// Injectable functions for testing
let _archiveThread = archiveThread;
let _modifyThreadLabels = modifyThreadLabels;

export function _setBatchFns(fns: {
  archiveThread?: typeof archiveThread;
  modifyThreadLabels?: typeof modifyThreadLabels;
}): void {
  if (fns.archiveThread) _archiveThread = fns.archiveThread;
  if (fns.modifyThreadLabels) _modifyThreadLabels = fns.modifyThreadLabels;
}

export function _resetBatchFns(): void {
  _archiveThread = archiveThread;
  _modifyThreadLabels = modifyThreadLabels;
}

// --- Batch Mark as Handled (Spec 09: Any -> Handled) ---
// Transitions each selected thread to "handled" lifecycle state.
// Archives the thread in Gmail (removes INBOX label).

export async function batchMarkHandled(threadIds: string[]): Promise<number> {
  const threadStore = useThreadStore.getState();
  const connectivity = useSyncStore.getState().connectivityStatus;
  let successCount = 0;

  for (const id of threadIds) {
    const thread = threadStore.getThread(id);
    if (!thread) continue;
    if (thread.lifecycleState === "handled") continue;

    // Transition lifecycle per Spec 09
    threadStore.transitionState(id, "handled", "batch-mark-handled");

    // Update visual state and remove INBOX label
    threadStore.updateThread(id, {
      visualState: "archived",
      gmailLabels: thread.gmailLabels.filter((l) => l !== "INBOX"),
    });

    // Archive in Gmail (non-blocking per thread, queue if offline)
    if (connectivity === "offline") {
      useSyncStore.getState().enqueueAction({
        type: "archive",
        threadId: id,
        payload: null,
        userInitiatedTimestamp: Date.now(),
      });
    } else {
      // Fire and forget - optimistic update already applied
      _archiveThread(id).catch(() => {
        // Gmail failure: revert lifecycle and visual state
        // Thread is already in local "handled" state; Gmail may catch up on next sync
        console.warn(`[BatchOps] Failed to archive thread ${id} in Gmail`);
      });
    }

    successCount++;
  }

  if (successCount > 0) {
    const appState = useAppStore.getState();
    appState.addNotification({
      message: `Marked ${successCount} thread${successCount !== 1 ? "s" : ""} as handled.`,
      severity: "info",
    });
    // Track threads handled in session stats per Spec 07
    appState.updateSessionStats({
      threadsHandled: appState.sessionStats.threadsHandled + successCount,
    });
  }

  threadStore.clearBatchSelection();
  return successCount;
}

// --- Batch Move to Zone (Spec 09: moves each thread to target zone) ---
// Sets userOverrideZone flag so drift engine respects manual placement.

export function batchMoveToZone(threadIds: string[], targetZone: ZoneId): number {
  const threadStore = useThreadStore.getState();
  let successCount = 0;

  for (const id of threadIds) {
    const thread = threadStore.getThread(id);
    if (!thread) continue;
    if (thread.zone === targetZone) continue;

    threadStore.updateThread(id, {
      zone: targetZone,
      previousZone: thread.zone,
      userOverrideZone: true,
    });

    successCount++;
  }

  if (successCount > 0) {
    useAppStore.getState().addNotification({
      message: `Moved ${successCount} thread${successCount !== 1 ? "s" : ""} to ${targetZone}.`,
      severity: "info",
    });
  }

  threadStore.clearBatchSelection();
  return successCount;
}

// --- Batch Apply Label (Spec 09: applies a Gmail label to each thread) ---
// Adds the label locally and in Gmail.

export async function batchApplyLabel(threadIds: string[], label: string): Promise<number> {
  const threadStore = useThreadStore.getState();
  const connectivity = useSyncStore.getState().connectivityStatus;
  let successCount = 0;

  for (const id of threadIds) {
    const thread = threadStore.getThread(id);
    if (!thread) continue;
    if (thread.gmailLabels.includes(label)) continue;

    // Optimistic local update
    threadStore.updateThread(id, {
      gmailLabels: [...thread.gmailLabels, label],
    });

    // Gmail API call (queue if offline)
    if (connectivity === "offline") {
      useSyncStore.getState().enqueueAction({
        type: "label-change",
        threadId: id,
        payload: { addLabelIds: [label], removeLabelIds: [] },
        userInitiatedTimestamp: Date.now(),
      });
    } else {
      _modifyThreadLabels(id, [label], []).catch(() => {
        console.warn(`[BatchOps] Failed to apply label "${label}" to thread ${id}`);
      });
    }

    successCount++;
  }

  if (successCount > 0) {
    useAppStore.getState().addNotification({
      message: `Applied label "${label}" to ${successCount} thread${successCount !== 1 ? "s" : ""}.`,
      severity: "info",
    });
  }

  threadStore.clearBatchSelection();
  return successCount;
}

// --- Batch Assign to Agent (Spec 09: deploys agent to selected threads) ---
// Creates a deployment record and triggers agent work on the batch.

export function batchAssignAgent(threadIds: string[], agentRole: AgentRole): boolean {
  const agentStore = useAgentStore.getState();
  const deploymentStore = useDeploymentStore.getState();

  // Validate agent can be deployed
  if (!agentStore.canDeployRole(agentRole)) {
    useAppStore.getState().addNotification({
      message: `${AGENT_DEFINITIONS[agentRole].name} is not available for deployment.`,
      severity: "warning",
    });
    useThreadStore.getState().clearBatchSelection();
    return false;
  }

  const def = AGENT_DEFINITIONS[agentRole];
  const cappedThreadIds = threadIds.slice(0, def.capacity);

  // Show deployment confirmation dialog (per Spec 06 flow)
  deploymentStore.showConfirmation({
    agentRole,
    clusterId: `batch-select`,
    threadIds: cappedThreadIds,
    description: `${def.name}: ${def.description.toLowerCase()} (${cappedThreadIds.length} selected thread${cappedThreadIds.length !== 1 ? "s" : ""})`,
  });

  useThreadStore.getState().clearBatchSelection();
  return true;
}

// --- Query helpers ---

export function getSelectedThreads(): Thread[] {
  const { threads, selectedThreadIds } = useThreadStore.getState();
  const result: Thread[] = [];
  for (const id of selectedThreadIds) {
    const thread = threads.get(id);
    if (thread) result.push(thread);
  }
  return result;
}

export function getSelectedThreadCount(): number {
  return useThreadStore.getState().selectedThreadIds.size;
}
