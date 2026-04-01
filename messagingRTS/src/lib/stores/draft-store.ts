// Reactive draft state store per Spec 01
// Moves draft lifecycle state from module-level Map in outbound-actions.ts
// into a Zustand store so React components can reactively subscribe to
// draft state changes (e.g., the detail panel draft indicator).

import { create } from "zustand";
import type { DraftState } from "../../features/sync/outbound-actions";

export interface DraftRecord {
  threadId: string;
  gmailDraftId: string | null;
  body: string;
  state: DraftState;
}

interface DraftStore {
  drafts: Map<string, DraftRecord>;

  // Actions
  setDraft: (threadId: string, record: DraftRecord) => void;
  updateDraftState: (threadId: string, state: DraftState) => void;
  updateDraftBody: (threadId: string, body: string) => void;
  updateDraftGmailId: (threadId: string, gmailDraftId: string) => void;
  removeDraft: (threadId: string) => void;
  clearAllDrafts: () => void;

  // Queries
  getDraftState: (threadId: string) => DraftState;
  getDraftRecord: (threadId: string) => DraftRecord | undefined;
  hasDraft: (threadId: string) => boolean;
}

export const useDraftStore = create<DraftStore>((set, get) => ({
  drafts: new Map(),

  setDraft: (threadId, record) =>
    set((state) => {
      const updated = new Map(state.drafts);
      updated.set(threadId, record);
      return { drafts: updated };
    }),

  updateDraftState: (threadId, draftState) =>
    set((state) => {
      const existing = state.drafts.get(threadId);
      if (!existing) return state;
      const updated = new Map(state.drafts);
      updated.set(threadId, { ...existing, state: draftState });
      return { drafts: updated };
    }),

  updateDraftBody: (threadId, body) =>
    set((state) => {
      const existing = state.drafts.get(threadId);
      if (!existing) return state;
      const updated = new Map(state.drafts);
      const newState = existing.state === "saved" ? "dirty" : existing.state;
      updated.set(threadId, { ...existing, body, state: newState as DraftState });
      return { drafts: updated };
    }),

  updateDraftGmailId: (threadId, gmailDraftId) =>
    set((state) => {
      const existing = state.drafts.get(threadId);
      if (!existing) return state;
      const updated = new Map(state.drafts);
      updated.set(threadId, { ...existing, gmailDraftId });
      return { drafts: updated };
    }),

  removeDraft: (threadId) =>
    set((state) => {
      const updated = new Map(state.drafts);
      updated.delete(threadId);
      return { drafts: updated };
    }),

  clearAllDrafts: () => set({ drafts: new Map() }),

  getDraftState: (threadId) => {
    return get().drafts.get(threadId)?.state ?? "none";
  },

  getDraftRecord: (threadId) => {
    return get().drafts.get(threadId);
  },

  hasDraft: (threadId) => {
    const record = get().drafts.get(threadId);
    return record !== undefined && record.state !== "none" && record.state !== "discarded";
  },
}));
