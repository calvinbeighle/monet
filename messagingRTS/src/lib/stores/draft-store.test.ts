// Tests for Feature 5: Draft state in reactive store (Spec 01)

import { describe, it, expect, beforeEach } from "vitest";
import { useDraftStore } from "./draft-store";
import {
  beginDraft,
  updateDraftContent,
  getDraftState,
  getDraftRecord,
  _clearDraftRecords,
  _setOutboundFns,
  _resetOutboundFns,
  saveDraftAction,
  discardDraftAction,
} from "../../features/sync/outbound-actions";
import { useSyncStore } from "./sync-store";

// Mock gmail-client functions
const mockCreateDraft = async () => ({ id: "gmail-draft-123" });
const mockUpdateDraft = async () => ({ id: "gmail-draft-123" });
const mockDeleteDraft = async () => {};

function resetStores() {
  useDraftStore.getState().clearAllDrafts();
  _clearDraftRecords();
  useSyncStore.setState({ connectivityStatus: "connected" });
}

describe("Draft store - basic operations", () => {
  beforeEach(resetStores);

  it("starts with empty drafts", () => {
    expect(useDraftStore.getState().drafts.size).toBe(0);
  });

  it("setDraft adds a draft record", () => {
    useDraftStore.getState().setDraft("t1", {
      threadId: "t1",
      gmailDraftId: null,
      body: "Hello",
      state: "unsaved",
    });
    expect(useDraftStore.getState().drafts.size).toBe(1);
    expect(useDraftStore.getState().getDraftState("t1")).toBe("unsaved");
  });

  it("getDraftState returns none for unknown thread", () => {
    expect(useDraftStore.getState().getDraftState("unknown")).toBe("none");
  });

  it("updateDraftState changes state", () => {
    useDraftStore.getState().setDraft("t1", {
      threadId: "t1",
      gmailDraftId: null,
      body: "Hello",
      state: "unsaved",
    });
    useDraftStore.getState().updateDraftState("t1", "saved");
    expect(useDraftStore.getState().getDraftState("t1")).toBe("saved");
  });

  it("updateDraftBody transitions saved to dirty", () => {
    useDraftStore.getState().setDraft("t1", {
      threadId: "t1",
      gmailDraftId: "gd1",
      body: "Hello",
      state: "saved",
    });
    useDraftStore.getState().updateDraftBody("t1", "Hello world");
    const record = useDraftStore.getState().getDraftRecord("t1");
    expect(record?.state).toBe("dirty");
    expect(record?.body).toBe("Hello world");
  });

  it("updateDraftBody does not change unsaved state", () => {
    useDraftStore.getState().setDraft("t1", {
      threadId: "t1",
      gmailDraftId: null,
      body: "Hello",
      state: "unsaved",
    });
    useDraftStore.getState().updateDraftBody("t1", "Hello world");
    expect(useDraftStore.getState().getDraftState("t1")).toBe("unsaved");
  });

  it("removeDraft deletes the record", () => {
    useDraftStore.getState().setDraft("t1", {
      threadId: "t1",
      gmailDraftId: null,
      body: "Hello",
      state: "unsaved",
    });
    useDraftStore.getState().removeDraft("t1");
    expect(useDraftStore.getState().drafts.size).toBe(0);
    expect(useDraftStore.getState().getDraftState("t1")).toBe("none");
  });

  it("hasDraft returns true for active drafts", () => {
    useDraftStore.getState().setDraft("t1", {
      threadId: "t1",
      gmailDraftId: null,
      body: "Hello",
      state: "unsaved",
    });
    expect(useDraftStore.getState().hasDraft("t1")).toBe(true);
  });

  it("hasDraft returns false for unknown threads", () => {
    expect(useDraftStore.getState().hasDraft("unknown")).toBe(false);
  });

  it("clearAllDrafts empties the store", () => {
    useDraftStore.getState().setDraft("t1", {
      threadId: "t1",
      gmailDraftId: null,
      body: "Hello",
      state: "unsaved",
    });
    useDraftStore.getState().setDraft("t2", {
      threadId: "t2",
      gmailDraftId: null,
      body: "World",
      state: "saved",
    });
    useDraftStore.getState().clearAllDrafts();
    expect(useDraftStore.getState().drafts.size).toBe(0);
  });

  it("updateDraftGmailId sets the Gmail draft ID", () => {
    useDraftStore.getState().setDraft("t1", {
      threadId: "t1",
      gmailDraftId: null,
      body: "Hello",
      state: "unsaved",
    });
    useDraftStore.getState().updateDraftGmailId("t1", "gd-123");
    expect(useDraftStore.getState().getDraftRecord("t1")?.gmailDraftId).toBe("gd-123");
  });
});

describe("Draft store - sync with outbound actions", () => {
  beforeEach(() => {
    resetStores();
    _setOutboundFns({
      createDraft: mockCreateDraft as never,
      updateDraft: mockUpdateDraft as never,
      deleteDraft: mockDeleteDraft as never,
    });
  });

  afterEach(() => {
    _resetOutboundFns();
  });

  it("beginDraft syncs to reactive store", () => {
    beginDraft("t1", "Hello");
    expect(useDraftStore.getState().getDraftState("t1")).toBe("unsaved");
    expect(useDraftStore.getState().getDraftRecord("t1")?.body).toBe("Hello");
  });

  it("updateDraftContent syncs to reactive store", () => {
    beginDraft("t1", "Hello");
    updateDraftContent("t1", "Hello world");
    expect(useDraftStore.getState().getDraftRecord("t1")?.body).toBe("Hello world");
  });

  it("updateDraftContent creates draft in store if new", () => {
    updateDraftContent("t1", "From scratch");
    expect(useDraftStore.getState().getDraftState("t1")).toBe("unsaved");
  });

  it("_clearDraftRecords clears the reactive store", () => {
    beginDraft("t1", "Hello");
    beginDraft("t2", "World");
    _clearDraftRecords();
    expect(useDraftStore.getState().drafts.size).toBe(0);
  });

  it("saveDraftAction syncs saved state to reactive store", async () => {
    beginDraft("t1", "Hello");
    await saveDraftAction("t1", {
      threadId: "t1",
      to: ["bob@example.com"],
      subject: "Re: Test",
      body: "Hello",
      inReplyTo: "",
      references: [],
    });
    expect(useDraftStore.getState().getDraftState("t1")).toBe("saved");
    expect(useDraftStore.getState().getDraftRecord("t1")?.gmailDraftId).toBe("gmail-draft-123");
  });

  it("discardDraftAction removes from reactive store", async () => {
    beginDraft("t1", "Hello");
    await discardDraftAction("t1");
    expect(useDraftStore.getState().getDraftState("t1")).toBe("none");
    expect(useDraftStore.getState().hasDraft("t1")).toBe(false);
  });

  it("module-level getDraftState stays in sync with store", () => {
    beginDraft("t1", "Hello");
    expect(getDraftState("t1")).toBe("unsaved");
    expect(useDraftStore.getState().getDraftState("t1")).toBe("unsaved");
  });

  it("module-level getDraftRecord stays in sync with store", () => {
    beginDraft("t1", "Hello");
    const moduleRecord = getDraftRecord("t1");
    const storeRecord = useDraftStore.getState().getDraftRecord("t1");
    expect(moduleRecord?.state).toBe(storeRecord?.state);
    expect(moduleRecord?.body).toBe(storeRecord?.body);
  });
});
