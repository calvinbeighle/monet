// Detail panel per Spec 12 and Spec 08
// Slides in from right when a thread is selected, shows thread conversation,
// metadata (zone, risk, opportunity, scores), participants, and reply placeholder.
// At narrow viewports (< RESPONSIVE_BREAKPOINT), overlays instead of shrinking map.

import { useAppStore, useThreadStore } from "../lib/stores";
import type { Thread, RiskTier, OpportunityState } from "../lib/types";

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

export function DetailPanel() {
  const selectedThreadId = useAppStore((s) => s.selectedThreadId);
  const setSelectedThread = useAppStore((s) => s.setSelectedThread);
  const threads = useThreadStore((s) => s.threads);

  if (!selectedThreadId) return null;

  const thread = threads.get(selectedThreadId);

  return (
    <div
      className="flex h-full w-80 shrink-0 flex-col border-l border-gray-800 bg-[#0e0e1a]"
      data-testid="detail-panel"
      role="complementary"
      aria-label="Thread detail"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
        <span className="text-sm font-medium text-gray-200">Thread Detail</span>
        <button
          className="text-xs text-gray-500 hover:text-gray-300"
          onClick={() => setSelectedThread(null)}
          data-testid="detail-panel-close"
          aria-label="Close detail panel"
        >
          Close
        </button>
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

            {/* Reply composer placeholder - actual compose comes with 1.6 */}
            <div className="mt-4" data-testid="reply-composer">
              <textarea
                className="w-full rounded border border-gray-700 bg-[#14142a] px-3 py-2 text-xs text-gray-300 placeholder-gray-600 focus:border-gray-500 focus:outline-none"
                placeholder="Type a reply..."
                rows={3}
              />
            </div>
          </>
        ) : (
          <div className="text-xs text-gray-600">Thread not found</div>
        )}
      </div>
    </div>
  );
}
