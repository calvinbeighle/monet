// Detail panel per Spec 12, Spec 08, and Spec 01 (reply/draft/archive)
// Slides in from right when a thread is selected, shows thread conversation,
// metadata (zone, risk, opportunity, scores), participants, and reply composer.
// At narrow viewports (< RESPONSIVE_BREAKPOINT), overlays instead of shrinking map.

import { useState, useCallback, useEffect } from "react";
import { useAppStore, useThreadStore } from "../lib/stores";
import { useDraftStore } from "../lib/stores/draft-store";
import { useNavigationStore } from "../features/navigation/navigation-store";
import type { Thread, RiskTier, OpportunityState } from "../lib/types";
import type { TrustTier } from "../lib/types/game-mechanics";
import {
  sendReplyAction,
  saveDraftAction,
  discardDraftAction,
  archiveThreadAction,
  updateDraftContent,
} from "../features/sync/outbound-actions";
import type { SendReplyPayload, DraftPayload } from "../features/auth/gmail-client";

const RISK_COLORS: Record<RiskTier, string> = {
  safe: "text-green-400",
  elevated: "text-yellow-400",
  critical: "text-red-400",
  lost: "text-gray-500",
};

const OPPORTUNITY_COLORS: Record<OpportunityState, string> = {
  none: "text-gray-500",
  ripe: "text-green-400",
  fading: "text-yellow-400",
  expired: "text-gray-600",
  captured: "text-blue-400",
};

const TRUST_COLORS: Record<TrustTier, string> = {
  new: "text-gray-500",
  building: "text-yellow-400",
  established: "text-blue-400",
  "high-trust": "text-green-400",
};

function ThreadMetadata({ thread }: { thread: Thread }) {
  return (
    <div className="grid grid-cols-2 gap-1.5" data-testid="thread-metadata">
      <div className="rounded bg-gray-800/40 px-2 py-1">
        <div className="text-[10px] text-gray-500">Zone</div>
        <div className="text-xs text-gray-300">{thread.zone}</div>
      </div>
      <div className="rounded bg-gray-800/40 px-2 py-1">
        <div className="text-[10px] text-gray-500">State</div>
        <div className="text-xs text-gray-300">{thread.lifecycleState}</div>
      </div>
      <div className="rounded bg-gray-800/40 px-2 py-1">
        <div className="text-[10px] text-gray-500">Risk</div>
        <div className={`text-xs ${RISK_COLORS[thread.riskTier]}`}>{thread.riskTier}</div>
      </div>
      <div className="rounded bg-gray-800/40 px-2 py-1">
        <div className="text-[10px] text-gray-500">Opportunity</div>
        <div className={`text-xs ${OPPORTUNITY_COLORS[thread.opportunityState]}`}>
          {thread.opportunityState}
        </div>
      </div>
      <div className="rounded bg-gray-800/40 px-2 py-1">
        <div className="text-[10px] text-gray-500">Urgency</div>
        <div className="text-xs text-gray-300">{(thread.urgencyScore * 100).toFixed(0)}%</div>
      </div>
      <div className="rounded bg-gray-800/40 px-2 py-1">
        <div className="text-[10px] text-gray-500">Value</div>
        <div className="text-xs text-gray-300">{(thread.valueScore * 100).toFixed(0)}%</div>
      </div>
    </div>
  );
}

function ReplyComposer({ thread }: { thread: Thread }) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const quotaExhausted = useAppStore((s) => s.quotaExhausted);
  const draftState = useDraftStore((s) => s.getDraftState(thread.id));
  const lastMessage = thread.messages[thread.messages.length - 1];

  // Build reply payload from thread context per Spec 01 Section 4
  const buildReplyPayload = useCallback((): SendReplyPayload => {
    const recipients = lastMessage
      ? [lastMessage.sender, ...lastMessage.recipients].filter(
          (addr) => addr !== "me" && addr.length > 0,
        )
      : thread.participants.map((p) => p.email).filter((e) => e.length > 0);

    return {
      threadId: thread.id,
      to: [...new Set(recipients)],
      subject: thread.subject.startsWith("Re:") ? thread.subject : `Re: ${thread.subject}`,
      body,
      inReplyTo: lastMessage?.id ?? "",
      references: thread.messages.map((m) => m.id),
    };
  }, [body, thread, lastMessage]);

  const buildDraftPayload = useCallback((): DraftPayload => {
    const reply = buildReplyPayload();
    return {
      threadId: reply.threadId,
      to: reply.to,
      subject: reply.subject,
      body: reply.body,
      inReplyTo: reply.inReplyTo,
      references: reply.references,
    };
  }, [buildReplyPayload]);

  const handleSend = useCallback(async () => {
    if (!body.trim() || sending) return;
    setSending(true);
    const success = await sendReplyAction(thread.id, buildReplyPayload());
    setSending(false);
    if (success) {
      setBody("");
    }
  }, [body, sending, thread.id, buildReplyPayload]);

  const handleSaveDraft = useCallback(async () => {
    if (!body.trim() || saving) return;
    setSaving(true);
    await saveDraftAction(thread.id, buildDraftPayload());
    setSaving(false);
  }, [body, saving, thread.id, buildDraftPayload]);

  const handleDiscardDraft = useCallback(async () => {
    await discardDraftAction(thread.id);
    setBody("");
  }, [thread.id]);

  const handleBodyChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      setBody(value);
      updateDraftContent(thread.id, value);
    },
    [thread.id],
  );

  const hasDraft = draftState !== "none" && draftState !== "discarded";

  return (
    <div className="mt-4" data-testid="reply-composer">
      <textarea
        className="w-full rounded border border-gray-700 bg-[#14142a] px-3 py-2 text-xs text-gray-300 placeholder-gray-600 focus:border-gray-500 focus:outline-none"
        placeholder="Type a reply..."
        rows={3}
        value={body}
        onChange={handleBodyChange}
        onFocus={() => useNavigationStore.getState().setComposerActive(true)}
        onBlur={() => useNavigationStore.getState().setComposerActive(false)}
        disabled={sending}
        data-testid="reply-textarea"
      />

      {/* Draft state indicator */}
      {hasDraft && (
        <div className="mt-1 text-[10px] text-gray-600" data-testid="draft-state">
          Draft: {draftState}
        </div>
      )}

      {/* Quota exhaustion warning per Spec 01 */}
      {quotaExhausted && (
        <div className="mt-1 text-[10px] text-yellow-500" data-testid="quota-exhausted-warning">
          Daily Gmail quota exhausted. Send, draft, and archive actions are disabled until reset.
        </div>
      )}

      {/* Action buttons */}
      <div className="mt-2 flex gap-2">
        <button
          className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-500 disabled:opacity-40"
          onClick={handleSend}
          disabled={!body.trim() || sending || quotaExhausted}
          data-testid="send-reply-btn"
          title={quotaExhausted ? "Daily Gmail quota exhausted" : undefined}
        >
          {sending ? "Sending..." : "Send"}
        </button>
        <button
          className="rounded bg-gray-700 px-3 py-1 text-xs text-gray-300 hover:bg-gray-600 disabled:opacity-40"
          onClick={handleSaveDraft}
          disabled={!body.trim() || saving || quotaExhausted}
          data-testid="save-draft-btn"
          title={quotaExhausted ? "Daily Gmail quota exhausted" : undefined}
        >
          {saving ? "Saving..." : "Save Draft"}
        </button>
        {hasDraft && (
          <button
            className="rounded bg-gray-800 px-3 py-1 text-xs text-gray-400 hover:bg-gray-700"
            onClick={handleDiscardDraft}
            data-testid="discard-draft-btn"
          >
            Discard
          </button>
        )}
      </div>
    </div>
  );
}

function ParticipantTrust({ thread }: { thread: Thread }) {
  const trustRecords = useAppStore((s) => s.trustRecords);
  const participants = thread.participants.filter((p) => p.email.length > 0);
  if (participants.length === 0) return null;

  const hasTrust = participants.some((p) => trustRecords[p.email]);
  if (!hasTrust) return null;

  return (
    <div className="mb-3" data-testid="participant-trust">
      <div className="mb-1 text-[10px] text-gray-500">Trust</div>
      <div className="space-y-1">
        {participants.map((p) => {
          const record = trustRecords[p.email];
          if (!record) return null;
          // Tier-crossing visual per Spec 07: highlight when tier recently changed
          const tierRecentlyCrossed =
            record.tierEntryDate > 0 && Date.now() - record.tierEntryDate < 5000;
          return (
            <div key={p.email} className="flex items-center justify-between text-xs">
              <span className="text-gray-400 truncate max-w-[140px]">
                {p.displayName || p.email}
              </span>
              <span
                className={`${TRUST_COLORS[record.tier]}${tierRecentlyCrossed ? " animate-pulse ring-1 ring-current rounded px-1" : ""}`}
                data-testid={tierRecentlyCrossed ? "tier-crossing" : undefined}
              >
                {record.tier} ({record.score})
                {record.consecutiveStreak >= 3 && (
                  <span
                    className="ml-1 inline-block h-2 w-2 rounded-full bg-yellow-400"
                    title="3+ on-time replies"
                    data-testid="consecutive-streak-indicator"
                  />
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DetailPanel() {
  const selectedThreadId = useAppStore((s) => s.selectedThreadId);
  const setSelectedThread = useAppStore((s) => s.setSelectedThread);
  const quotaExhausted = useAppStore((s) => s.quotaExhausted);
  const threads = useThreadStore((s) => s.threads);

  // Slide animation state per Spec 12 Section 5
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (!selectedThreadId) return;
    // Trigger slide-in on next frame so the initial translate-x-full is painted first
    const frame = requestAnimationFrame(() => setIsVisible(true));
    return () => {
      cancelAnimationFrame(frame);
      setIsVisible(false);
    };
  }, [selectedThreadId]);

  if (!selectedThreadId) return null;

  const thread = threads.get(selectedThreadId);

  const handleArchive = async () => {
    if (!thread) return;
    await archiveThreadAction(thread.id);
  };

  return (
    <div
      className={`flex h-full w-80 shrink-0 flex-col border-l border-gray-800 bg-[#0e0e1a] transition-transform duration-300 ease-out ${isVisible ? "translate-x-0" : "translate-x-full"}`}
      data-testid="detail-panel"
      role="complementary"
      aria-label="Thread detail"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
        <span className="text-sm font-medium text-gray-200">Thread Detail</span>
        <div className="flex gap-2">
          {thread && thread.gmailLabels.includes("INBOX") && (
            <button
              className="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-400 hover:bg-gray-700 disabled:opacity-40"
              onClick={handleArchive}
              disabled={quotaExhausted}
              data-testid="archive-btn"
              aria-label="Archive thread"
              title={quotaExhausted ? "Daily Gmail quota exhausted" : undefined}
            >
              Archive
            </button>
          )}
          <button
            className="text-xs text-gray-500 hover:text-gray-300"
            onClick={() => setSelectedThread(null)}
            data-testid="detail-panel-close"
            aria-label="Close detail panel"
          >
            Close
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {thread ? (
          <>
            <h3 className="mb-2 text-sm font-medium text-gray-200" data-testid="detail-subject">
              {thread.subject || "(no subject)"}
            </h3>
            <div className="mb-3 text-xs text-gray-500">
              {thread.participants.length > 0
                ? thread.participants.map((p) => p.displayName || p.email).join(", ")
                : "No participants"}
            </div>
            <div className="mb-3 text-xs text-gray-600">
              {thread.messageCount} message{thread.messageCount !== 1 ? "s" : ""}
            </div>

            {/* Thread metadata - zone, risk, opportunity, scores */}
            <div className="mb-3">
              <ThreadMetadata thread={thread} />
            </div>

            {/* Trust scores per participant per Spec 07 */}
            <ParticipantTrust thread={thread} />

            <div className="text-xs text-gray-400">{thread.snippet}</div>

            {/* Messages */}
            <div className="mt-4 space-y-3" data-testid="detail-messages">
              {thread.messages.map((msg) => (
                <div key={msg.id} className="rounded border border-gray-800 p-2">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-300">{msg.sender}</span>
                    <span className="text-[10px] text-gray-600">
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="text-xs text-gray-400 whitespace-pre-wrap">
                    {msg.bodyPlain || "(no content)"}
                  </div>
                </div>
              ))}
            </div>

            {/* Reply composer per Spec 01 Sections 4-5 */}
            <ReplyComposer thread={thread} />
          </>
        ) : (
          <div className="text-xs text-gray-600">Thread not found</div>
        )}
      </div>
    </div>
  );
}
