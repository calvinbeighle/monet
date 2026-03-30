/**
 * views/TinderView.tsx
 * Email triage swipe view for Monet.
 *
 * Fetches the 5 most recent emails from the backend, drafts a reply for each
 * using Claude Haiku, and presents them as swipeable cards. The user can edit
 * the draft inline, then swipe right to send or left to skip. After all cards
 * are processed a summary screen is shown.
 *
 * Flow:
 * 1. Mount -> POST /triage-inbox -> receive cards
 * 2. Show one card at a time with editable draft reply
 * 3. Send/Skip -> POST /send-reply -> animate card out -> next card
 * 4. All done -> summary screen
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Send, SkipForward, Check } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AiLoader } from '@/components/ui/ai-loader';
import { useAppStore } from '@/stores/appStore';
import { BACKEND_URL } from '@/types';

/** Shape of a single email triage card returned by the backend */
interface EmailCard {
  id: string;
  sender: string;
  subject: string;
  body: string;
  draft: string;
  timestamp: string;
  to?: string;
}

/**
 * Sends a triage action (send or skip) to the backend for a given email card.
 *
 * @param action - 'send' to dispatch a reply, 'skip' to discard
 * @param card - The email card being acted on
 * @param replyText - The (possibly edited) draft reply text
 */
async function sendTriageAction(
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
 * Fetches triage cards from the backend.
 * Calls POST /triage-inbox and returns the card array.
 *
 * @returns Array of EmailCard objects
 */
async function fetchTriageCards(): Promise<EmailCard[]> {
  const res = await fetch(`${BACKEND_URL}/triage-inbox`, { method: 'POST' });
  if (!res.ok) throw new Error(`Triage inbox fetch failed: ${res.status}`);
  const data = await res.json();
  return data.cards ?? [];
}

/**
 * Full email triage view with swipeable cards.
 *
 * Loads cards on mount, shows one at a time with an editable draft,
 * and routes send/skip actions to the backend.
 */
export function TinderView() {
  const { setActiveView } = useAppStore();

  const [cards, setCards] = useState<EmailCard[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [editedDraft, setEditedDraft] = useState('');
  const [isLoadingCards, setIsLoadingCards] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [exitDirection, setExitDirection] = useState<'left' | 'right' | null>(null);
  const [results, setResults] = useState<{ sent: number; skipped: number }>({
    sent: 0,
    skipped: 0,
  });

  // Fetch emails on mount
  useEffect(() => {
    let cancelled = false;
    setIsLoadingCards(true);
    setLoadError(null);

    fetchTriageCards()
      .then((fetched) => {
        if (!cancelled) setCards(fetched);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(String(err));
      })
      .finally(() => {
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
   * Fires the backend call, updates result counts, and advances to the next card.
   *
   * @param action - 'send' or 'skip'
   */
  async function handleAction(action: 'send' | 'skip') {
    const card = cards[currentIndex];
    if (!card) return;

    setExitDirection(action === 'send' ? 'right' : 'left');

    // Fire-and-forget - we do not block the UI on the network response
    sendTriageAction(action, card, editedDraft).catch((err) =>
      console.error('send-reply failed:', err),
    );

    setResults((prev) => ({
      ...prev,
      [action === 'send' ? 'sent' : 'skipped']:
        prev[action === 'send' ? 'sent' : 'skipped'] + 1,
    }));

    // Wait for the exit animation then advance
    setTimeout(() => {
      setExitDirection(null);
      setCurrentIndex((prev) => prev + 1);
    }, 280);
  }

  const currentCard = cards[currentIndex];
  const isComplete = !isLoadingCards && currentIndex >= cards.length && cards.length > 0;
  const hasNoCards = !isLoadingCards && cards.length === 0 && !loadError;

  return (
    <div className="flex flex-col w-full h-full p-8">
      {/* Back navigation */}
      <button
        onClick={() => setActiveView('home')}
        className="flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-300 transition-colors mb-8 w-fit"
      >
        <ArrowLeft size={15} strokeWidth={1.5} />
        Back
      </button>

      {/* Loading state */}
      {isLoadingCards && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <AiLoader text="reading" size={120} />
          <p className="text-sm text-zinc-500 mt-4">Checking your inbox...</p>
        </div>
      )}

      {/* Error state */}
      {loadError && (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-center max-w-xs">
            <p className="text-sm text-red-400">Failed to load inbox</p>
            <p className="text-xs text-zinc-600">{loadError}</p>
            <Button
              variant="outline"
              className="mt-2"
              onClick={() => {
                setLoadError(null);
                setCards([]);
                setCurrentIndex(0);
                setIsLoadingCards(true);
                fetchTriageCards()
                  .then(setCards)
                  .catch((e) => setLoadError(String(e)))
                  .finally(() => setIsLoadingCards(false));
              }}
            >
              Retry
            </Button>
          </div>
        </div>
      )}

      {/* Completion screen */}
      {isComplete && (
        <div className="flex-1 flex items-center justify-center">
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
        </div>
      )}

      {/* No emails state */}
      {hasNoCards && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-zinc-500">No emails to triage</p>
        </div>
      )}

      {/* Active card */}
      {!isLoadingCards && !loadError && currentCard && (
        <div className="flex-1 flex flex-col items-center max-w-2xl mx-auto w-full">
          {/* Progress counter */}
          <p className="text-xs text-zinc-500 mb-6 tabular-nums">
            {currentIndex + 1} of {cards.length}
          </p>

          {/* Swipeable card */}
          <AnimatePresence mode="wait">
            <motion.div
              key={currentCard.id}
              initial={{ opacity: 0, y: 18, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{
                opacity: 0,
                x: exitDirection === 'right' ? 260 : exitDirection === 'left' ? -260 : 0,
                scale: 0.95,
                transition: { duration: 0.28, ease: 'easeInOut' },
              }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              className="w-full"
            >
              <Card className="bg-zinc-900 border-zinc-800 overflow-hidden">
                {/* Email header */}
                <div className="p-5 border-b border-zinc-800">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge
                      variant="outline"
                      className="text-[10px] bg-violet-500/10 text-violet-400 border-violet-500/20 px-2 py-0"
                    >
                      Email
                    </Badge>
                    <span className="text-xs text-zinc-500 truncate max-w-[260px]">
                      {currentCard.sender}
                    </span>
                  </div>
                  <h3 className="text-base font-medium text-zinc-100 leading-snug">
                    {currentCard.subject}
                  </h3>
                </div>

                {/* Email body preview */}
                <div className="p-5 border-b border-zinc-800 max-h-44 overflow-y-auto">
                  <p className="text-sm text-zinc-400 leading-relaxed whitespace-pre-wrap">
                    {currentCard.body}
                  </p>
                </div>

                {/* Editable draft reply */}
                <div className="p-5">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500 mb-3">
                    Suggested Reply
                  </p>
                  <textarea
                    value={editedDraft}
                    onChange={(e) => setEditedDraft(e.target.value)}
                    className="w-full bg-zinc-800/50 border border-zinc-700 rounded-lg p-4 text-sm text-zinc-200 resize-none focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-zinc-600 transition-all"
                    rows={4}
                    placeholder="Edit the reply before sending..."
                  />
                </div>
              </Card>
            </motion.div>
          </AnimatePresence>

          {/* Skip / Send buttons */}
          <div className="flex gap-3 mt-6 w-full max-w-sm mx-auto">
            <Button
              variant="outline"
              className="flex-1 h-11 border-zinc-700 hover:border-red-500/40 hover:text-red-400 transition-all"
              onClick={() => handleAction('skip')}
            >
              <SkipForward size={15} className="mr-2" />
              Skip
            </Button>
            <Button
              className="flex-1 h-11 bg-violet-600 hover:bg-violet-500 text-white transition-all"
              onClick={() => handleAction('send')}
            >
              <Send size={15} className="mr-2" />
              Send Reply
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
