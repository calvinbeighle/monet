/**
 * views/TinderView.tsx
 * Email triage swipe view for Monet.
 *
 * Loads email cards with a two-stage strategy:
 * 1. First checks GET /decisions?agent_id=email for pre-staged decisions
 *    produced by the background scheduler. If found, uses those instantly -
 *    no loading delay, no extra LLM calls needed.
 * 2. If no pre-staged decisions exist, falls back to POST /triage-inbox
 *    which fetches live emails and drafts replies on demand.
 *
 * Actions route through the appropriate endpoint:
 * - Pre-staged decisions: POST /decisions/{id}/resolve
 * - Live triage cards: POST /send-reply
 *
 * Flow:
 * 1. Mount -> check /decisions?agent_id=email -> use pre-staged OR /triage-inbox
 * 2. Show one centered card at a time with editable draft reply
 * 3. Send/Skip -> resolve or send-reply -> next card
 * 4. All done -> summary screen
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Send, SkipForward, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/stores/appStore';
import { BACKEND_URL } from '@/types';

/** Shape of a single email triage card shown in the UI */
interface EmailCard {
  id: string;
  /** Decision ID if this card came from the pre-staged queue, otherwise null */
  decisionId: string | null;
  sender: string;
  subject: string;
  body: string;
  draft: string;
  timestamp: string;
  to?: string;
}

/**
 * Strips HTML tags from a string using the browser's DOM parser.
 * Removes style and script elements first so their content is not included
 * in the resulting text. Used as a frontend safety net in case any HTML
 * slips through from the backend.
 *
 * @param html - Raw string that may contain HTML markup
 * @returns Plain text with all HTML and style/script content removed
 */
function stripHtml(html: string): string {
  if (!html) return '';
  const div = document.createElement('div');
  div.innerHTML = html;
  // Remove style and script elements so their content is not included
  div.querySelectorAll('style, script').forEach((el) => el.remove());
  return (div.textContent || div.innerText || '').replace(/\s+/g, ' ').trim();
}

/**
 * Attempts to load pre-staged email decisions from the decision queue.
 * Returns an empty array if none exist or if the request fails.
 *
 * @returns Array of EmailCard objects from the decision queue
 */
async function fetchPreStagedCards(): Promise<EmailCard[]> {
  try {
    const res = await fetch(`${BACKEND_URL}/decisions?agent_id=email`);
    if (!res.ok) return [];
    const data = await res.json();
    const decisions: Record<string, unknown>[] = data.decisions ?? [];
    if (!decisions.length) return [];

    return decisions.map((d) => {
      const emailData = (d.data as Record<string, unknown>)?.email as Record<string, unknown> ?? {};
      return {
        id: String(emailData.id ?? d.id),
        decisionId: String(d.id),
        sender: String(emailData.sender ?? ''),
        subject: String(emailData.subject ?? d.summary ?? ''),
        body: String(emailData.body ?? ''),
        draft: String(((d.data as Record<string, unknown>)?.draft) ?? ''),
        timestamp: String(emailData.timestamp ?? ''),
        to: String(emailData.to ?? ''),
      };
    });
  } catch {
    return [];
  }
}

/**
 * Fetches triage cards live from POST /triage-inbox.
 * Falls back to when no pre-staged decisions are available.
 *
 * @returns Array of EmailCard objects from live triage
 */
async function fetchLiveTriageCards(): Promise<EmailCard[]> {
  const res = await fetch(`${BACKEND_URL}/triage-inbox`, { method: 'POST' });
  if (!res.ok) throw new Error(`Triage inbox fetch failed: ${res.status}`);
  const data = await res.json();
  return (data.cards ?? []).map((c: Record<string, unknown>) => ({
    ...c,
    decisionId: null,
  }));
}

/**
 * Sends a triage action for a pre-staged decision (via /decisions/{id}/resolve).
 *
 * @param decisionId - The decision queue ID
 * @param action - 'send' or 'skip'
 * @param replyText - The draft reply text (used if action is 'send')
 */
async function resolveDecision(
  decisionId: string,
  action: 'send' | 'skip',
  replyText: string,
): Promise<void> {
  await fetch(`${BACKEND_URL}/decisions/${decisionId}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      resolution: action === 'send' ? 'approved' : 'skipped',
      reply_text: action === 'send' ? replyText : undefined,
    }),
  });
}

/**
 * Sends a triage action for a live (non-pre-staged) card via /send-reply.
 *
 * @param action - 'send' to dispatch a reply, 'skip' to discard
 * @param card - The email card being acted on
 * @param replyText - The (possibly edited) draft reply text
 */
async function sendLiveTriageAction(
  action: 'send' | 'skip',
  card: EmailCard,
  replyText: string,
): Promise<void> {
  await fetch(`${BACKEND_URL}/send-reply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action,
      email_id: card.id,
      reply_text: action === 'send' ? replyText : '',
      to: card.sender,
      subject: `Re: ${card.subject}`,
    }),
  });
}

/**
 * Full email triage view with a centered Tinder-style swipeable card.
 *
 * Loads cards on mount using the two-stage strategy (pre-staged then live),
 * shows one centered card at a time with an editable draft, and routes
 * send/skip actions to the appropriate backend endpoint.
 */
export function TinderView() {
  const { setActiveView, refreshAgents, refreshDecisions } = useAppStore();

  const [cards, setCards] = useState<EmailCard[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [editedDraft, setEditedDraft] = useState('');
  const [isLoadingCards, setIsLoadingCards] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [exitDirection, setExitDirection] = useState<'left' | 'right' | null>(null);
  const [isPreStaged, setIsPreStaged] = useState(false);
  const [results, setResults] = useState<{ sent: number; skipped: number }>({
    sent: 0,
    skipped: 0,
  });

  /**
   * Loads cards using the two-stage strategy.
   * Sets isPreStaged to true if pre-staged decisions were found.
   */
  async function loadCards(): Promise<void> {
    setIsLoadingCards(true);
    setLoadError(null);

    // Stage 1: try pre-staged decisions (instant - no LLM calls)
    const staged = await fetchPreStagedCards();
    if (staged.length > 0) {
      setCards(staged);
      setIsPreStaged(true);
      setIsLoadingCards(false);
      return;
    }

    // Stage 2: fall back to live triage (requires LLM drafting - takes a few seconds)
    setIsPreStaged(false);
    const live = await fetchLiveTriageCards();
    setCards(live);
    setIsLoadingCards(false);
  }

  // Load cards on mount
  useEffect(() => {
    let cancelled = false;

    loadCards()
      .catch((err) => {
        if (!cancelled) setLoadError(String(err));
        if (!cancelled) setIsLoadingCards(false);
      });

    return () => { cancelled = true; };
  }, []);

  // Sync the editable draft whenever the current card changes
  useEffect(() => {
    const card = cards[currentIndex];
    if (card) setEditedDraft(card.draft);
  }, [currentIndex, cards]);

  /**
   * Handles a send or skip action for the current card.
   *
   * Routes to /decisions/{id}/resolve for pre-staged cards, or /send-reply
   * for live triage cards. Updates result counts and advances to the next card.
   * Refreshes agent status after each action to keep decision counts accurate.
   *
   * @param action - 'send' or 'skip'
   */
  async function handleAction(action: 'send' | 'skip') {
    const card = cards[currentIndex];
    if (!card) return;

    setExitDirection(action === 'send' ? 'right' : 'left');

    // Fire-and-forget backend call - we do not block the UI on the response
    if (card.decisionId) {
      resolveDecision(card.decisionId, action, editedDraft).catch((err) =>
        console.error('resolve-decision failed:', err),
      );
    } else {
      sendLiveTriageAction(action, card, editedDraft).catch((err) =>
        console.error('send-reply failed:', err),
      );
    }

    setResults((prev) => ({
      ...prev,
      [action === 'send' ? 'sent' : 'skipped']:
        prev[action === 'send' ? 'sent' : 'skipped'] + 1,
    }));

    // Wait for the exit animation then advance
    setTimeout(() => {
      setExitDirection(null);
      setCurrentIndex((prev) => prev + 1);
      // Refresh store so agent card decision counts update immediately
      refreshAgents();
      refreshDecisions();
    }, 280);
  }

  const currentCard = cards[currentIndex];
  const isComplete = !isLoadingCards && currentIndex >= cards.length && cards.length > 0;
  const hasNoCards = !isLoadingCards && cards.length === 0 && !loadError;

  return (
    <div className="relative flex flex-col w-full h-full">
      {/* Top bar - back button and progress counter */}
      <div className="flex items-center justify-between px-6 pt-5 pb-0 shrink-0">
        <button
          onClick={() => setActiveView('home')}
          className="flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <ArrowLeft size={15} strokeWidth={1.5} />
          Back
        </button>
        {!isLoadingCards && cards.length > 0 && !isComplete && (
          <span className="text-xs text-zinc-500 tabular-nums">
            {currentIndex + 1} of {cards.length}
            {isPreStaged && (
              <span className="ml-2 text-emerald-500/70">pre-staged</span>
            )}
          </span>
        )}
      </div>

      {/* Center content area */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-4 min-h-0">

        {/* Loading state */}
        {isLoadingCards && (
          <div className="flex flex-col items-center gap-4">
            <div className="w-8 h-8 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
            <p className="text-sm text-zinc-500">Reading your inbox...</p>
          </div>
        )}

        {/* Error state */}
        {loadError && (
          <div className="flex flex-col items-center gap-3 text-center max-w-xs">
            <p className="text-sm text-red-400">Failed to load inbox</p>
            <p className="text-xs text-zinc-600">{loadError}</p>
            <Button
              variant="outline"
              className="mt-2"
              onClick={() => {
                setCards([]);
                setCurrentIndex(0);
                loadCards().catch((e) => setLoadError(String(e)));
              }}
            >
              Retry
            </Button>
          </div>
        )}

        {/* Completion screen */}
        {isComplete && (
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center">
              <Check size={28} className="text-emerald-500" />
            </div>
            <h2 className="text-xl font-light text-zinc-100">All done</h2>
            <p className="text-sm text-zinc-500">
              {results.sent} {results.sent === 1 ? 'reply' : 'replies'} sent -{' '}
              {results.skipped} skipped
            </p>
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => setActiveView('home')}
            >
              Back to home
            </Button>
          </div>
        )}

        {/* No emails state */}
        {hasNoCards && (
          <p className="text-sm text-zinc-500">No emails to triage</p>
        )}

        {/* Active card - centered Tinder card */}
        {!isLoadingCards && !loadError && currentCard && (
          <div className="flex flex-col items-center w-full max-w-[580px]">
            <AnimatePresence mode="wait">
              <motion.div
                key={currentCard.id}
                initial={{ opacity: 0, y: 30, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{
                  opacity: 0,
                  x: exitDirection === 'right' ? 300 : exitDirection === 'left' ? -300 : 0,
                  rotate: exitDirection === 'right' ? 8 : exitDirection === 'left' ? -8 : 0,
                  transition: { duration: 0.28, ease: 'easeInOut' },
                }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
                className="w-full"
              >
                {/* Card */}
                <div
                  className="w-full rounded-2xl border border-zinc-800 bg-zinc-900 shadow-[0_8px_32px_rgba(0,0,0,0.4)]"
                  style={{ minHeight: '400px' }}
                >
                  {/* From + Subject */}
                  <div className="px-7 pt-7 pb-5">
                    <div className="flex flex-col gap-1 mb-1">
                      <div className="flex items-baseline gap-2">
                        <span className="text-xs text-zinc-500 shrink-0">From</span>
                        <span className="text-sm text-zinc-100 truncate">{currentCard.sender}</span>
                      </div>
                      <div className="flex items-baseline gap-2">
                        <span className="text-xs text-zinc-500 shrink-0">Subject</span>
                        <span className="text-sm text-zinc-100 font-medium leading-snug">{currentCard.subject}</span>
                      </div>
                    </div>
                  </div>

                  {/* Divider */}
                  <div className="h-px bg-zinc-800 mx-7" />

                  {/* Email body preview */}
                  <div className="px-7 py-5 max-h-[200px] overflow-y-auto">
                    <p className="text-sm text-zinc-300 leading-relaxed">
                      {stripHtml(currentCard.body)}
                    </p>
                  </div>

                  {/* Divider */}
                  <div className="h-px bg-zinc-800 mx-7" />

                  {/* Suggested reply section */}
                  <div className="px-7 py-5">
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500 mb-3">
                      Suggested Reply
                    </p>
                    <textarea
                      value={editedDraft}
                      onChange={(e) => setEditedDraft(e.target.value)}
                      className="w-full bg-zinc-800/50 border border-zinc-700 rounded-lg p-4 text-sm text-zinc-200 resize-none focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-zinc-600 transition-all"
                      style={{ minHeight: '100px' }}
                      rows={4}
                      placeholder="Edit the reply before sending..."
                    />
                  </div>
                </div>
              </motion.div>
            </AnimatePresence>

            {/* Skip / Send buttons */}
            <div className="flex gap-4 mt-6">
              <button
                className="h-11 min-w-[140px] rounded-xl border border-zinc-700 text-zinc-400 text-sm font-medium px-6 transition-all hover:border-red-500/50 hover:text-red-400 bg-transparent cursor-pointer"
                onClick={() => handleAction('skip')}
              >
                <span className="flex items-center justify-center gap-2">
                  <SkipForward size={15} />
                  Skip
                </span>
              </button>
              <button
                className="h-11 min-w-[140px] rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium px-6 transition-all cursor-pointer"
                onClick={() => handleAction('send')}
              >
                <span className="flex items-center justify-center gap-2">
                  <Send size={15} />
                  Send Reply
                </span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
