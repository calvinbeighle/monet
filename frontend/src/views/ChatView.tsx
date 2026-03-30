/**
 * views/ChatView.tsx
 * iMessage-style chat interface for Monet general conversation.
 *
 * Shown when the user submits a general question via the command bar.
 * Streams Claude responses in real-time via SSE from POST /chat.
 * Supports multi-turn conversation with full message history in state.
 * User messages: right-aligned violet bubbles.
 * Agent messages: left-aligned zinc-800 bubbles with streaming cursor.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, ArrowUp } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '@/stores/appStore';
import { AiLoader } from '@/components/ui/ai-loader';
import { BACKEND_URL } from '@/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single message in the conversation */
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** True when the assistant is still streaming this message */
  isStreaming: boolean;
}

/** A prior message sent to the backend for multi-turn context */
interface HistoryEntry {
  role: 'user' | 'assistant';
  content: string;
}

// ---------------------------------------------------------------------------
// Streaming logic
// ---------------------------------------------------------------------------

/**
 * Sends a POST /chat request and reads the SSE stream.
 * Calls onChunk for each text token and onDone when the stream ends.
 * Uses fetch + ReadableStream instead of EventSource because EventSource
 * only supports GET and cannot send a body.
 *
 * @param text - The current user message
 * @param history - Prior messages for multi-turn context
 * @param onChunk - Called with each token string as it arrives
 * @param onDone - Called when the stream completes
 * @param onError - Called if an error occurs
 * @returns An AbortController so the caller can cancel
 */
function streamChatResponse(
  text: string,
  history: HistoryEntry[],
  onChunk: (chunk: string) => void,
  onDone: () => void,
  onError: (err: string) => void
): AbortController {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, history }),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!res.body) throw new Error('No response body');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE messages are separated by double newlines
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';

        for (const part of parts) {
          const lines = part.split('\n');
          let eventName = '';
          let dataLine = '';

          for (const line of lines) {
            if (line.startsWith('event:')) eventName = line.slice(6).trim();
            if (line.startsWith('data:')) dataLine = line.slice(5).trim();
          }

          if (eventName === 'text' && dataLine) {
            try {
              const parsed = JSON.parse(dataLine);
              if (parsed.text) onChunk(parsed.text);
            } catch {
              // Ignore malformed JSON chunks
            }
          } else if (eventName === 'done') {
            onDone();
            return;
          } else if (eventName === 'error' && dataLine) {
            try {
              const parsed = JSON.parse(dataLine);
              onError(parsed.error ?? 'Stream error');
            } catch {
              onError('Stream error');
            }
            return;
          }
        }
      }

      // Stream ended without a done event - treat as done
      onDone();
    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') return;
      onError((err as Error).message ?? 'Connection failed');
    }
  })();

  return controller;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/**
 * Three-dot typing indicator shown while waiting for the first token.
 * Dots animate with a staggered bounce.
 */
function TypingIndicator() {
  return (
    <div className="flex items-end gap-1 px-4 py-3 bg-zinc-800 rounded-2xl rounded-bl-sm w-fit">
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-zinc-400"
          animate={{ y: [0, -5, 0] }}
          transition={{
            duration: 0.6,
            repeat: Infinity,
            delay: i * 0.15,
            ease: 'easeInOut',
          }}
        />
      ))}
    </div>
  );
}

/**
 * A blinking cursor appended to streaming agent messages.
 */
function StreamingCursor() {
  return (
    <motion.span
      className="inline-block w-[2px] h-[1em] bg-violet-400 ml-[1px] align-middle"
      animate={{ opacity: [1, 0, 1] }}
      transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
    />
  );
}

interface MessageBubbleProps {
  message: ChatMessage;
}

/**
 * Renders a single chat message bubble.
 * User messages: right-aligned, violet background.
 * Assistant messages: left-aligned, zinc-800 background with streaming cursor.
 */
function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      <div
        className={`max-w-[70%] px-4 py-3 rounded-2xl text-[14px] leading-relaxed whitespace-pre-wrap break-words ${
          isUser
            ? 'bg-violet-600 text-white rounded-br-sm'
            : 'bg-zinc-800 text-zinc-100 rounded-bl-sm'
        }`}
      >
        {message.text}
        {message.isStreaming && message.text.length > 0 && <StreamingCursor />}
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

/**
 * Full chat interface for general conversation with Monet.
 *
 * On mount, reads the pending message from the store, sends it to /chat,
 * and streams the response. Subsequent messages append to the conversation
 * and send the full history for multi-turn context.
 */
export function ChatView() {
  const { setActiveView, pendingChatMessage, setPendingChatMessage } = useAppStore();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  /** True while waiting for the very first token from a stream */
  const [isWaiting, setIsWaiting] = useState(false);
  /** True when actively streaming (after first token) */
  const [isStreaming, setIsStreaming] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const hasSentInitial = useRef(false);

  /** Scrolls the message list to the bottom. */
  function scrollToBottom() {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }

  useEffect(() => {
    scrollToBottom();
  }, [messages, isWaiting]);

  /**
   * Builds the history array from current messages for multi-turn context.
   * Excludes the last user message (it will be sent as 'text').
   */
  function buildHistory(msgs: ChatMessage[]): HistoryEntry[] {
    return msgs
      .filter((m) => !m.isStreaming)
      .map((m) => ({ role: m.role, content: m.text }));
  }

  /**
   * Sends a message to /chat and streams the response into a new assistant bubble.
   *
   * @param text - The user's message text
   * @param priorMessages - All messages before this one (for context)
   */
  const sendMessage = useCallback((text: string, priorMessages: ChatMessage[]) => {
    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text,
      isStreaming: false,
    };

    const assistantId = `a-${Date.now()}`;
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      text: '',
      isStreaming: true,
    };

    const updatedMessages = [...priorMessages, userMsg];
    setMessages([...updatedMessages, assistantMsg]);
    setIsWaiting(true);
    setIsStreaming(false);

    // Cancel any in-flight stream
    abortRef.current?.abort();

    const history = buildHistory(priorMessages);

    abortRef.current = streamChatResponse(
      text,
      history,
      // onChunk - append text token to the assistant bubble
      (chunk) => {
        setIsWaiting(false);
        setIsStreaming(true);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, text: m.text + chunk } : m
          )
        );
      },
      // onDone - mark the assistant bubble as complete
      () => {
        setIsWaiting(false);
        setIsStreaming(false);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, isStreaming: false } : m
          )
        );
      },
      // onError - show error text in the bubble
      (err) => {
        setIsWaiting(false);
        setIsStreaming(false);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, text: `Error: ${err}`, isStreaming: false }
              : m
          )
        );
      }
    );
  }, []);

  // On mount: consume the pending message from the store and send it
  useEffect(() => {
    if (hasSentInitial.current) return;
    if (!pendingChatMessage) return;

    hasSentInitial.current = true;
    const initial = pendingChatMessage;
    setPendingChatMessage(null);
    sendMessage(initial, []);
  }, [pendingChatMessage, setPendingChatMessage, sendMessage]);

  // Cleanup any in-flight stream on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  function handleSubmit() {
    const trimmed = inputValue.trim();
    if (!trimmed || isWaiting || isStreaming) return;
    setInputValue('');
    sendMessage(trimmed, messages);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  const canSend = inputValue.trim().length > 0 && !isWaiting && !isStreaming;

  return (
    <div className="flex flex-col w-full h-full bg-zinc-950">
      {/* Header */}
      <div className="flex items-center px-6 pt-6 pb-3 shrink-0">
        <button
          onClick={() => setActiveView('home')}
          className="flex items-center gap-1.5 text-zinc-500 hover:text-zinc-300 transition-colors duration-150 text-[13px]"
        >
          <ArrowLeft size={14} strokeWidth={1.5} />
          Back
        </button>
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-3 scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent">
        {messages.length === 0 && !isWaiting && (
          <div className="flex-1 flex items-center justify-center">
            <AiLoader text="monet" size={120} />
          </div>
        )}

        <AnimatePresence initial={false}>
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
        </AnimatePresence>

        {/* Typing indicator - shown while waiting for the first token */}
        <AnimatePresence>
          {isWaiting && (
            <motion.div
              key="typing"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: 0.15 }}
              className="flex justify-start"
            >
              <TypingIndicator />
            </motion.div>
          )}
        </AnimatePresence>

        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <div
        className="shrink-0 px-6 pb-5 pt-3"
        style={{
          background: 'linear-gradient(to top, rgba(9,9,11,1) 70%, rgba(9,9,11,0))',
        }}
      >
        <div
          className={`flex items-center gap-3 px-4 w-full rounded-xl bg-zinc-900 border transition-all duration-200 ${
            inputFocused
              ? 'border-zinc-700 ring-2 ring-violet-500/20'
              : 'border-zinc-800'
          }`}
          style={{ height: '48px' }}
        >
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            placeholder="Ask a follow-up..."
            className="flex-1 bg-transparent outline-none text-[14px] text-zinc-100 placeholder:text-zinc-500"
            disabled={isWaiting || isStreaming}
          />

          <button
            onClick={handleSubmit}
            disabled={!canSend}
            className={`w-7 h-7 flex items-center justify-center rounded-lg shrink-0 transition-all duration-150 ${
              canSend
                ? 'bg-violet-600 text-white cursor-pointer hover:bg-violet-500'
                : 'bg-zinc-800 text-zinc-500 cursor-default'
            }`}
          >
            {isWaiting ? (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
                className="w-3 h-3 rounded-full border-2 border-violet-500 border-t-transparent"
              />
            ) : (
              <ArrowUp size={14} strokeWidth={2} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
