// Tests for Feature 1: Quota-disabled UI (Spec 01)
// When Gmail API daily quota is exhausted, send/archive/draft buttons should be disabled.

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { useAppStore } from "../lib/stores/app-store";
import { useThreadStore } from "../lib/stores/thread-store";
import { DetailPanel } from "../components/detail-panel";
import { BatchActionBar } from "../components/batch-action-bar";
import { createThread } from "../lib/types/thread";

function resetStores() {
  useAppStore.setState({
    selectedThreadId: null,
    quotaExhausted: false,
    activePanel: "none",
  });
  useThreadStore.setState({
    threads: new Map(),
    selectedThreadIds: new Set(),
  });
}

function seedThread() {
  const thread = createThread("t1", "Test Subject", "snippet");
  thread.gmailLabels = ["INBOX"];
  thread.participants = [
    {
      email: "alice@example.com",
      displayName: "Alice",
      organization: "",
      vipFlag: false,
      relationshipScore: 0,
      responseHistory: { avgResponseTimeMs: 0, threadFrequency: 0 },
    },
  ];
  useThreadStore.setState({
    threads: new Map([["t1", thread]]),
  });
  useAppStore.setState({
    selectedThreadId: "t1",
    activePanel: "detail",
  });
}

describe("Quota-disabled UI - App Store", () => {
  beforeEach(resetStores);

  it("quotaExhausted defaults to false", () => {
    expect(useAppStore.getState().quotaExhausted).toBe(false);
  });

  it("setQuotaExhausted sets the flag", () => {
    useAppStore.getState().setQuotaExhausted(true);
    expect(useAppStore.getState().quotaExhausted).toBe(true);
  });

  it("setQuotaExhausted can be toggled back", () => {
    useAppStore.getState().setQuotaExhausted(true);
    useAppStore.getState().setQuotaExhausted(false);
    expect(useAppStore.getState().quotaExhausted).toBe(false);
  });
});

describe("Quota-disabled UI - Detail Panel", () => {
  beforeEach(() => {
    resetStores();
    seedThread();
  });

  it("send button is enabled when quota is not exhausted", () => {
    render(<DetailPanel />);
    const sendBtn = screen.getByTestId("send-reply-btn");
    // Button is disabled because body is empty, but not because of quota
    expect(sendBtn).toBeDisabled();
    expect(sendBtn).not.toHaveAttribute("title");
  });

  it("send button has quota tooltip when exhausted", () => {
    useAppStore.setState({ quotaExhausted: true });
    render(<DetailPanel />);
    const sendBtn = screen.getByTestId("send-reply-btn");
    expect(sendBtn).toBeDisabled();
    expect(sendBtn).toHaveAttribute("title", "Daily Gmail quota exhausted");
  });

  it("save draft button has quota tooltip when exhausted", () => {
    useAppStore.setState({ quotaExhausted: true });
    render(<DetailPanel />);
    const draftBtn = screen.getByTestId("save-draft-btn");
    expect(draftBtn).toBeDisabled();
    expect(draftBtn).toHaveAttribute("title", "Daily Gmail quota exhausted");
  });

  it("archive button is disabled when quota exhausted", () => {
    useAppStore.setState({ quotaExhausted: true });
    render(<DetailPanel />);
    const archiveBtn = screen.getByTestId("archive-btn");
    expect(archiveBtn).toBeDisabled();
    expect(archiveBtn).toHaveAttribute("title", "Daily Gmail quota exhausted");
  });

  it("archive button is enabled when quota is not exhausted", () => {
    render(<DetailPanel />);
    const archiveBtn = screen.getByTestId("archive-btn");
    expect(archiveBtn).not.toBeDisabled();
  });

  it("shows quota exhaustion warning text", () => {
    useAppStore.setState({ quotaExhausted: true });
    render(<DetailPanel />);
    expect(screen.getByTestId("quota-exhausted-warning")).toBeInTheDocument();
    expect(screen.getByText(/Daily Gmail quota exhausted/)).toBeInTheDocument();
  });

  it("does not show quota warning when quota is OK", () => {
    render(<DetailPanel />);
    expect(screen.queryByTestId("quota-exhausted-warning")).not.toBeInTheDocument();
  });
});

describe("Quota-disabled UI - Batch Action Bar", () => {
  beforeEach(() => {
    resetStores();
    useThreadStore.setState({
      selectedThreadIds: new Set(["t1", "t2"]),
    });
  });

  it("mark handled is disabled when quota exhausted", () => {
    useAppStore.setState({ quotaExhausted: true });
    render(<BatchActionBar />);
    const btn = screen.getByTestId("batch-mark-handled");
    expect(btn).toBeDisabled();
  });

  it("mark handled is enabled when quota is OK", () => {
    render(<BatchActionBar />);
    const btn = screen.getByTestId("batch-mark-handled");
    expect(btn).not.toBeDisabled();
  });

  it("apply label is disabled when quota exhausted", () => {
    useAppStore.setState({ quotaExhausted: true });
    render(<BatchActionBar />);
    const btn = screen.getByTestId("batch-apply-label");
    expect(btn).toBeDisabled();
  });

  it("shows quota warning badge when exhausted", () => {
    useAppStore.setState({ quotaExhausted: true });
    render(<BatchActionBar />);
    expect(screen.getByTestId("batch-quota-warning")).toBeInTheDocument();
  });

  it("does not show quota warning when quota is OK", () => {
    render(<BatchActionBar />);
    expect(screen.queryByTestId("batch-quota-warning")).not.toBeInTheDocument();
  });
});
