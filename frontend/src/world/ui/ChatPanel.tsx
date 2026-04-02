/**
 * ChatPanel.tsx - Agent chat panel that renders structured Claude Code stream-json events.
 *
 * Dual delivery: WebSocket for live streaming + HTTP polling fallback to guarantee
 * the user always sees agent responses even if the WS connection drops or misses events.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Trash2, ChevronDown, ChevronRight, Terminal, Wrench, Copy, Check, Brain, FileCode, Zap, Activity } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { useWorldStore } from '../stores/worldStore';
import { SPRITE_CONFIG, SPRITE_ANIMATIONS, buildAgentVisuals } from '../constants';

const WS_BASE = 'ws://localhost:8000';
const HTTP_BASE = 'http://localhost:8000';
const WS_MAX_RETRIES = 5;
const WS_RETRY_BASE_MS = 300;

// ---------------------------------------------------------------------------
// Tool label mapping (matches backend TOOL_LABELS)
// ---------------------------------------------------------------------------

const TOOL_LABELS: Record<string, string> = {
  Read: 'Read file',
  Write: 'Write file',
  Edit: 'Edit file',
  MultiEdit: 'Edit files',
  Bash: 'Run command',
  TodoRead: 'Check tasks',
  TodoWrite: 'Update tasks',
  WebSearch: 'Search web',
  WebFetch: 'Fetch URL',
  Glob: 'Find files',
  Grep: 'Search code',
  LS: 'List directory',
  Task: 'Run subtask',
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatEvent {
  type: 'user' | 'assistant_text' | 'tool_call' | 'result' | 'system';
  text?: string;
  toolName?: string;
  toolInput?: string;
  userText?: string;
  id: number;
  raw: unknown;
}

// ---------------------------------------------------------------------------
// Event parser
// ---------------------------------------------------------------------------

let _eventCounter = 0;

/**
 * Parse raw claude stream-json events into renderable ChatEvents.
 * Extracts assistant text blocks and tool_use blocks. Skips system/rate_limit noise.
 */
function parseEvent(event: unknown): ChatEvent[] {
  const e = event as Record<string, unknown>;

  if (e.type === 'assistant') {
    const message = e.message as Record<string, unknown> | undefined;
    const content = message?.content as Array<Record<string, unknown>> | undefined;
    if (!content) return [];

    const results: ChatEvent[] = [];
    for (const block of content) {
      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        results.push({
          type: 'assistant_text',
          text: block.text,
          id: ++_eventCounter,
          raw: event,
        });
      } else if (block.type === 'tool_use') {
        results.push({
          type: 'tool_call',
          toolName: typeof block.name === 'string' ? block.name : 'Tool',
          toolInput: JSON.stringify(block.input, null, 2),
          id: ++_eventCounter,
          raw: event,
        });
      }
    }
    return results;
  }

  if (e.type === 'result') {
    return [];
  }

  return [];
}

/**
 * Build a content fingerprint for deduplication.
 * Two events with the same fingerprint are considered duplicates.
 * Fingerprints are scoped per-agent (stored in fingerprintsCacheRef),
 * so content-based matching is safe.
 */
function eventFingerprint(evt: ChatEvent): string {
  if (evt.type === 'user') return `user:${evt.userText}`;
  if (evt.type === 'assistant_text') return `text:${evt.text}`;
  if (evt.type === 'tool_call') return `tool:${evt.toolName}:${(evt.toolInput ?? '').slice(0, 100)}`;
  return `other:${evt.id}`;
}

// ---------------------------------------------------------------------------
// Markdown theme (dark, minimal, code-forward)
// ---------------------------------------------------------------------------

/** Custom Prism theme — dark base with muted accents, no jarring colors */
const codeTheme: Record<string, React.CSSProperties> = {
  'pre[class*="language-"]': {
    color: '#c9d1d9', background: 'rgba(0,0,0,0.4)', fontSize: '12px',
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace',
    lineHeight: '1.55', margin: 0, padding: '14px 16px', overflow: 'auto',
    borderRadius: '0 0 8px 8px',
  },
  'code[class*="language-"]': {
    color: '#c9d1d9', background: 'none', fontSize: '12px',
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace',
    lineHeight: '1.55',
  },
  comment: { color: '#6b7280', fontStyle: 'italic' },
  prolog: { color: '#6b7280' },
  doctype: { color: '#6b7280' },
  cdata: { color: '#6b7280' },
  punctuation: { color: '#8b949e' },
  property: { color: '#7dd3fc' },
  tag: { color: '#7dd3fc' },
  boolean: { color: '#f0abfc' },
  number: { color: '#f0abfc' },
  constant: { color: '#f0abfc' },
  symbol: { color: '#f0abfc' },
  deleted: { color: '#fca5a5' },
  selector: { color: '#86efac' },
  'attr-name': { color: '#86efac' },
  string: { color: '#86efac' },
  char: { color: '#86efac' },
  builtin: { color: '#86efac' },
  inserted: { color: '#86efac' },
  operator: { color: '#c9d1d9' },
  entity: { color: '#c9d1d9' },
  url: { color: '#c9d1d9' },
  atrule: { color: '#93c5fd' },
  'attr-value': { color: '#93c5fd' },
  keyword: { color: '#c4b5fd' },
  function: { color: '#93c5fd' },
  'class-name': { color: '#fcd34d' },
  regex: { color: '#fcd34d' },
  important: { color: '#fcd34d', fontWeight: 'bold' },
  variable: { color: '#c9d1d9' },
};

/** Copy-to-clipboard button for code blocks */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      style={{
        position: 'absolute', top: '6px', right: '6px',
        background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '6px', padding: '4px 6px', cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: '4px',
        color: copied ? '#86efac' : 'rgba(255,255,255,0.35)',
        fontSize: '10px', fontFamily: 'ui-monospace, monospace',
        transition: 'all 0.15s',
      }}
      onMouseEnter={e => { if (!copied) e.currentTarget.style.color = 'rgba(255,255,255,0.6)'; }}
      onMouseLeave={e => { if (!copied) e.currentTarget.style.color = 'rgba(255,255,255,0.35)'; }}
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

/** Markdown components map for react-markdown */
const markdownComponents: Record<string, React.ComponentType<any>> = {
  code({ className, children, ...props }: any) {
    const match = /language-(\w+)/.exec(className || '');
    const codeString = String(children).replace(/\n$/, '');
    if (match) {
      return (
        <div style={{ position: 'relative', margin: '8px 0' }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '6px 12px',
            background: 'rgba(255,255,255,0.03)',
            borderRadius: '8px 8px 0 0',
            border: '1px solid rgba(255,255,255,0.06)',
            borderBottom: 'none',
          }}>
            <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', fontFamily: 'ui-monospace, monospace', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {match[1]}
            </span>
          </div>
          <div style={{ position: 'relative', border: '1px solid rgba(255,255,255,0.06)', borderTop: 'none', borderRadius: '0 0 8px 8px', overflow: 'hidden' }}>
            <CopyButton text={codeString} />
            <SyntaxHighlighter
              style={codeTheme}
              language={match[1]}
              PreTag="div"
            >
              {codeString}
            </SyntaxHighlighter>
          </div>
        </div>
      );
    }
    // Inline code
    return (
      <code style={{
        background: 'rgba(255,255,255,0.07)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '4px',
        padding: '1px 5px',
        fontSize: '0.88em',
        fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace',
        color: '#93c5fd',
      }} {...props}>
        {children}
      </code>
    );
  },
  p({ children }: any) {
    return <p style={{ margin: '0 0 10px 0', lineHeight: '1.65' }}>{children}</p>;
  },
  h1({ children }: any) {
    return <h1 style={{ fontSize: '18px', fontWeight: 700, margin: '16px 0 8px 0', color: '#f4f4f5', letterSpacing: '-0.01em' }}>{children}</h1>;
  },
  h2({ children }: any) {
    return <h2 style={{ fontSize: '16px', fontWeight: 650, margin: '14px 0 6px 0', color: '#f4f4f5', letterSpacing: '-0.01em' }}>{children}</h2>;
  },
  h3({ children }: any) {
    return <h3 style={{ fontSize: '14px', fontWeight: 600, margin: '12px 0 4px 0', color: '#e4e4e7' }}>{children}</h3>;
  },
  ul({ children }: any) {
    return <ul style={{ margin: '4px 0 10px 0', paddingLeft: '20px', listStyleType: 'disc' }}>{children}</ul>;
  },
  ol({ children }: any) {
    return <ol style={{ margin: '4px 0 10px 0', paddingLeft: '20px' }}>{children}</ol>;
  },
  li({ children }: any) {
    return <li style={{ marginBottom: '3px', lineHeight: '1.55' }}>{children}</li>;
  },
  blockquote({ children }: any) {
    return (
      <blockquote style={{
        margin: '8px 0', padding: '6px 14px',
        borderLeft: '3px solid rgba(59, 130, 246, 0.35)',
        background: 'rgba(59, 130, 246, 0.04)',
        borderRadius: '0 6px 6px 0',
        color: 'rgba(255,255,255,0.7)',
        fontSize: '13px',
      }}>
        {children}
      </blockquote>
    );
  },
  a({ href, children }: any) {
    return <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: '#93c5fd', textDecoration: 'none', borderBottom: '1px solid rgba(147,197,253,0.3)' }}>{children}</a>;
  },
  hr() {
    return <hr style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.06)', margin: '12px 0' }} />;
  },
  table({ children }: any) {
    return (
      <div style={{ overflowX: 'auto', margin: '8px 0', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>{children}</table>
      </div>
    );
  },
  thead({ children }: any) {
    return <thead style={{ background: 'rgba(255,255,255,0.04)' }}>{children}</thead>;
  },
  th({ children }: any) {
    return <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: '#e4e4e7', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>{children}</th>;
  },
  td({ children }: any) {
    return <td style={{ padding: '6px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.7)' }}>{children}</td>;
  },
  strong({ children }: any) {
    return <strong style={{ fontWeight: 600, color: '#f4f4f5' }}>{children}</strong>;
  },
  em({ children }: any) {
    return <em style={{ color: 'rgba(255,255,255,0.8)' }}>{children}</em>;
  },
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function AgentHeadshot({ agentId, size = 48 }: { agentId: string; size?: number }) {
  const agents = useWorldStore(s => s.agents);
  const visuals = buildAgentVisuals(agents);
  const cfg = visuals[agentId];
  if (!cfg) return null;
  const { frameWidth, frameHeight } = SPRITE_CONFIG;
  const isPlayer = cfg.spriteSheet === '/sprites/characters/player.png';
  const cols = isPlayer ? 4 : 6;
  const anim = SPRITE_ANIMATIONS['idle-down'];
  const sc = size / frameHeight;
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', overflow: 'hidden',
      background: `${cfg.accentColor}20`,
      border: `2px solid ${cfg.accentColor}60`,
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    }}>
      <div style={{
        width: frameWidth * sc, height: frameHeight * sc,
        backgroundImage: `url(${cfg.spriteSheet})`,
        backgroundPosition: `0px ${-(anim.row * frameHeight * sc)}px`,
        backgroundSize: `${cols * frameWidth * sc}px ${6 * frameHeight * sc}px`,
        backgroundRepeat: 'no-repeat',
        imageRendering: 'pixelated',
        transform: 'scale(1.8)',
        transformOrigin: 'center 30%',
      }} />
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '14px' }}>
      <div style={{
        maxWidth: '80%',
        background: 'rgba(59, 130, 246, 0.12)',
        border: '1px solid rgba(59, 130, 246, 0.18)',
        borderRadius: '16px 16px 4px 16px',
        padding: '10px 16px',
        color: '#e2e8f0',
        fontSize: '13.5px',
        lineHeight: '1.6',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        fontWeight: 400,
        letterSpacing: '0.01em',
      }}>
        {text}
      </div>
    </div>
  );
}

function AssistantMessage({ text }: { text: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: '14px' }}>
      <div className="chat-markdown" style={{
        maxWidth: '88%',
        background: 'rgba(255, 255, 255, 0.035)',
        border: '1px solid rgba(255, 255, 255, 0.06)',
        borderRadius: '4px 16px 16px 16px',
        padding: '12px 16px',
        color: '#cbd5e1',
        fontSize: '13.5px',
        lineHeight: '1.65',
        fontFamily: 'inherit',
      }}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={markdownComponents}
        >
          {text}
        </ReactMarkdown>
      </div>
    </div>
  );
}

function ResultMessage({ text }: { text: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: '12px' }}>
      <div style={{
        maxWidth: '90%',
        background: 'rgba(34,197,94,0.06)',
        border: '1px solid rgba(34,197,94,0.15)',
        borderRadius: '4px 14px 14px 14px',
        padding: '8px 14px',
        color: 'rgba(34,197,94,0.8)',
        fontSize: '12px',
        lineHeight: '1.5',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        fontFamily: 'inherit',
      }}>
        {text}
      </div>
    </div>
  );
}

function ToolCallCard({ name, input }: { name: string; input?: string }) {
  const [expanded, setExpanded] = useState(false);
  const label = TOOL_LABELS[name] || name;

  return (
    <div style={{ marginBottom: '4px', marginLeft: '4px' }}>
      <button
        onClick={() => setExpanded(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          padding: '3px 8px', background: 'none', border: 'none', cursor: 'pointer',
          textAlign: 'left', borderRadius: '6px',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'none')}
      >
        <div style={{
          width: '14px', height: '14px', borderRadius: '4px',
          background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.18)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <Wrench size={8} style={{ color: 'rgba(59, 130, 246, 0.55)' }} />
        </div>
        <span style={{
          color: 'rgba(255,255,255,0.3)', fontSize: '11px', fontWeight: 500,
          fontFamily: 'ui-monospace, monospace',
        }}>
          {label}
        </span>
        {input && (
          expanded
            ? <ChevronDown size={10} style={{ color: 'rgba(255,255,255,0.12)', flexShrink: 0 }} />
            : <ChevronRight size={10} style={{ color: 'rgba(255,255,255,0.12)', flexShrink: 0 }} />
        )}
      </button>

      {expanded && input && (
        <div style={{
          padding: '6px 10px',
          background: 'rgba(0,0,0,0.25)',
          border: '1px solid rgba(255,255,255,0.04)',
          borderRadius: '6px',
          margin: '2px 8px 4px 28px',
          overflowX: 'auto',
        }}>
          <pre style={{
            margin: 0, color: 'rgba(148,163,184,0.55)',
            fontSize: '10px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
            lineHeight: '1.5', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>
            {input}
          </pre>
        </div>
      )}
    </div>
  );
}

/** Animated thinking indicator shown while agent is processing */
function ThinkingIndicator({ agentName, mood }: { agentName: string; mood?: string }) {
  let label = 'Thinking...';
  if (mood?.includes('Responding')) label = 'Writing response...';
  else if (mood?.includes('Reading')) label = 'Reading files...';
  else if (mood?.includes('Editing') || mood?.includes('Writing')) label = 'Making changes...';
  else if (mood?.includes('Running')) label = 'Running command...';
  else if (mood?.includes('Searching')) label = 'Searching code...';
  else if (mood?.includes('Working')) label = 'Working...';

  return (
    <div style={{
      display: 'flex', justifyContent: 'flex-start', marginBottom: '14px',
      alignItems: 'center', gap: '10px',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '10px',
        background: 'rgba(255, 255, 255, 0.025)',
        border: '1px solid rgba(255, 255, 255, 0.05)',
        borderRadius: '4px 16px 16px 16px',
        padding: '10px 16px',
      }}>
        {/* Animated dots */}
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              width: 5, height: 5, borderRadius: '50%',
              background: 'rgba(59, 130, 246, 0.6)',
              animation: `pulse-dot 1.4s ease-in-out ${i * 0.2}s infinite`,
            }} />
          ))}
        </div>
        <span style={{
          color: 'rgba(148, 163, 184, 0.7)',
          fontSize: '12px',
          fontWeight: 500,
          fontStyle: 'italic',
        }}>
          {label}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Insight Panel - shows LLM-generated analysis of agent activity
// ---------------------------------------------------------------------------

function InsightPanel({ agentId }: { agentId: string }) {
  const agents = useWorldStore(s => s.agents);
  const agent = agents.find(a => a.id === agentId);
  const [expanded, setExpanded] = useState(true);

  const insight = agent?.insights;
  const activityLog = agent?.activityLog ?? [];
  const filesTouched = agent?.filesTouched ?? {};
  const isRunning = agent?.status === 'running';

  // Show live activity when running, insights when idle
  const hasContent = insight || (isRunning && activityLog.length > 0);
  if (!hasContent) return null;

  const fileEntries = Object.entries(filesTouched);
  const actionColors: Record<string, string> = {
    read: 'rgba(96,165,250,0.7)',
    write: 'rgba(52,211,153,0.7)',
    edit: 'rgba(251,191,36,0.7)',
  };

  return (
    <div style={{
      borderBottom: '1px solid rgba(255,255,255,0.06)',
      background: 'rgba(255,255,255,0.015)',
    }}>
      <button
        onClick={() => setExpanded(v => !v)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: '6px',
          padding: '8px 16px', background: 'none', border: 'none', cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <Brain size={12} style={{ color: 'rgba(59, 130, 246, 0.5)', flexShrink: 0 }} />
        <span style={{
          fontSize: '11px', fontWeight: 600, color: 'rgba(255,255,255,0.45)',
          letterSpacing: '0.03em', textTransform: 'uppercase', flex: 1,
        }}>
          {isRunning ? 'Live Activity' : 'Insights'}
        </span>
        {insight?.taskLabel && !isRunning && (
          <span style={{
            fontSize: '10px', color: 'rgba(59, 130, 246, 0.6)', fontWeight: 500,
            background: 'rgba(59, 130, 246, 0.08)', padding: '1px 6px', borderRadius: '4px',
          }}>
            {insight.taskLabel}
          </span>
        )}
        {insight?.complexity && !isRunning && (
          <span style={{
            fontSize: '9px', color: 'rgba(255,255,255,0.25)',
            background: 'rgba(255,255,255,0.04)', padding: '1px 5px', borderRadius: '3px',
            fontFamily: 'ui-monospace, monospace',
          }}>
            {insight.complexity}
          </span>
        )}
        {expanded
          ? <ChevronDown size={11} style={{ color: 'rgba(255,255,255,0.2)', flexShrink: 0 }} />
          : <ChevronRight size={11} style={{ color: 'rgba(255,255,255,0.2)', flexShrink: 0 }} />
        }
      </button>

      {expanded && (
        <div style={{ padding: '0 16px 10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {/* Summary */}
          {insight?.summary && !isRunning && (
            <div style={{
              fontSize: '12px', color: 'rgba(255,255,255,0.55)', lineHeight: '1.5',
            }}>
              {insight.summary}
            </div>
          )}

          {/* Thinking process */}
          {insight?.thinkingProcess && insight.thinkingProcess.length > 0 && !isRunning && (
            <div>
              <div style={{
                display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '4px',
              }}>
                <Zap size={10} style={{ color: 'rgba(251,191,36,0.5)' }} />
                <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', fontWeight: 500 }}>
                  Approach
                </span>
              </div>
              {insight.thinkingProcess.map((step, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'flex-start', gap: '6px', marginLeft: '4px',
                  marginBottom: '2px',
                }}>
                  <span style={{
                    width: '3px', height: '3px', borderRadius: '50%',
                    background: 'rgba(59, 130, 246, 0.4)', marginTop: '5px', flexShrink: 0,
                  }} />
                  <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', lineHeight: '1.4' }}>
                    {step}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Files changed (from insights or live tracking) */}
          {(insight?.filesChanged?.length || fileEntries.length > 0) && (
            <div>
              <div style={{
                display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '4px',
              }}>
                <FileCode size={10} style={{ color: 'rgba(96,165,250,0.5)' }} />
                <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', fontWeight: 500 }}>
                  Files
                </span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {insight?.filesChanged && !isRunning ? (
                  insight.filesChanged.map((f, i) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: '4px',
                      background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)',
                      borderRadius: '5px', padding: '2px 7px',
                    }}>
                      <span style={{
                        width: '4px', height: '4px', borderRadius: '50%',
                        background: actionColors[f.action] || 'rgba(255,255,255,0.3)',
                      }} />
                      <span style={{
                        fontSize: '10px', fontFamily: 'ui-monospace, monospace',
                        color: 'rgba(255,255,255,0.5)',
                      }}>
                        {f.file}
                      </span>
                      {f.why && (
                        <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.2)' }}>
                          {f.why}
                        </span>
                      )}
                    </div>
                  ))
                ) : (
                  fileEntries.map(([path, action], i) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: '4px',
                      background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)',
                      borderRadius: '5px', padding: '2px 7px',
                    }}>
                      <span style={{
                        width: '4px', height: '4px', borderRadius: '50%',
                        background: actionColors[action] || 'rgba(255,255,255,0.3)',
                      }} />
                      <span style={{
                        fontSize: '10px', fontFamily: 'ui-monospace, monospace',
                        color: 'rgba(255,255,255,0.5)',
                      }}>
                        {path.split('/').pop()}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Live activity log when running */}
          {isRunning && activityLog.length > 0 && (
            <div>
              <div style={{
                display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '4px',
              }}>
                <Activity size={10} style={{ color: 'rgba(34,197,94,0.5)' }} />
                <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', fontWeight: 500 }}>
                  Steps
                </span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', alignItems: 'center' }}>
                {activityLog.slice(-6).map((entry, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: '3px',
                  }}>
                    {i > 0 && (
                      <span style={{ color: 'rgba(255,255,255,0.1)', fontSize: '8px' }}>
                        {'\u2192'}
                      </span>
                    )}
                    <span style={{
                      fontSize: '10px', fontFamily: 'ui-monospace, monospace',
                      color: 'rgba(255,255,255,0.35)',
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.04)',
                      borderRadius: '4px', padding: '1px 5px',
                    }}>
                      {TOOL_LABELS[entry.tool] || entry.tool}
                      {entry.detail ? `: ${entry.detail}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ChatPanel() {
  const { isChatOpen, selectedAgentId, closeChat, deleteAgent, startAgent, stopAgent } = useWorldStore();
  const [isConnected, setIsConnected] = useState(false);
  const [events, setEvents] = useState<ChatEvent[]>([]);
  const [inputValue, setInputValue] = useState('');

  const agents = useWorldStore(s => s.agents);
  const currentAgent = agents.find(a => a.id === selectedAgentId);
  const isAgentRunning = currentAgent?.status === 'running';

  const allVisuals = buildAgentVisuals(agents);
  const cfg = selectedAgentId ? allVisuals[selectedAgentId] : null;
  const agentName = cfg?.name ?? 'Agent';

  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track the previous running state to detect running -> idle transitions
  const wasRunningRef = useRef(false);
  // Track fingerprints of already-displayed events for deduplication
  const seenFingerprintsRef = useRef<Set<string>>(new Set());
  // Per-agent message cache so switching agents preserves history
  const eventsCacheRef = useRef<Record<string, ChatEvent[]>>({});
  const fingerprintsCacheRef = useRef<Record<string, Set<string>>>({});
  // AbortController to cancel stale HTTP polls when switching agents
  const pollAbortRef = useRef<AbortController | null>(null);
  // Track which agent the current events belong to
  const activeAgentRef = useRef<string | null>(null);

  /** Auto-scroll to bottom whenever events change, and keep cache in sync. */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    // Keep the per-agent cache up to date
    if (activeAgentRef.current) {
      eventsCacheRef.current[activeAgentRef.current] = events;
      fingerprintsCacheRef.current[activeAgentRef.current] = new Set(seenFingerprintsRef.current);
    }
  }, [events]);

  /**
   * Save current agent's events to cache before switching, then restore
   * the new agent's cached events (or start fresh).
   *
   * IMPORTANT: We close any existing WebSocket BEFORE updating the active
   * agent ref so that late-arriving WS messages from the old agent cannot
   * sneak into the new agent's event list.
   */
  useEffect(() => {
    const prevAgent = activeAgentRef.current;

    // 1. Close the old WebSocket immediately so no stale messages can arrive
    //    while we swap the activeAgentRef. The WS setup effect will open a
    //    new one for the incoming agent.
    if (wsRef.current) {
      wsRef.current.onmessage = null; // prevent any final queued messages
      wsRef.current.onclose = null;   // prevent reconnect attempts
      wsRef.current.onerror = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    retryCountRef.current = 0;

    // 2. Save previous agent's state to cache
    if (prevAgent) {
      eventsCacheRef.current[prevAgent] = events;
      fingerprintsCacheRef.current[prevAgent] = new Set(seenFingerprintsRef.current);
    }

    // Cancel any in-flight polls from the previous agent
    pollAbortRef.current?.abort();
    pollAbortRef.current = null;

    if (selectedAgentId) {
      activeAgentRef.current = selectedAgentId;
      // Restore cached events for the new agent, or start fresh
      const cached = eventsCacheRef.current[selectedAgentId];
      const cachedFp = fingerprintsCacheRef.current[selectedAgentId];
      if (cached && cached.length > 0) {
        setEvents(cached);
        seenFingerprintsRef.current = cachedFp ? new Set(cachedFp) : new Set();
      } else {
        setEvents([]);
        seenFingerprintsRef.current = new Set();
      }
    } else {
      activeAgentRef.current = null;
      setEvents([]);
      seenFingerprintsRef.current = new Set();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAgentId]);

  /**
   * HTTP fallback: fetch all events from the backend and merge any
   * that weren't delivered via WebSocket. This guarantees the user
   * always sees agent responses regardless of WS reliability.
   */
  const fetchAndReconcileEvents = useCallback(async (agentId: string, signal?: AbortSignal) => {
    // Guard: only merge events if this agent is still active
    if (activeAgentRef.current !== agentId) return;
    try {
      const res = await fetch(`${HTTP_BASE}/agents/${agentId}/output`, { signal });
      if (!res.ok) return;
      // Re-check after await in case agent switched during fetch
      if (activeAgentRef.current !== agentId) return;
      const data = await res.json();
      const rawEvents: unknown[] = data.events ?? [];

      // Parse all backend events
      const allParsed: ChatEvent[] = [];
      for (const raw of rawEvents) {
        const items = parseEvent(raw);
        allParsed.push(...items);
      }

      if (allParsed.length === 0) return;

      // Final guard before setting state
      if (activeAgentRef.current !== agentId) return;

      // Merge: add any events whose fingerprint we haven't seen yet
      setEvents(prev => {
        // Build fingerprint set from current events
        const currentFingerprints = new Set<string>();
        for (const e of prev) {
          currentFingerprints.add(eventFingerprint(e));
        }

        const newEvents: ChatEvent[] = [];
        for (const e of allParsed) {
          const fp = eventFingerprint(e);
          if (!currentFingerprints.has(fp)) {
            currentFingerprints.add(fp);
            newEvents.push(e);
          }
        }

        if (newEvents.length > 0) {
          console.log('[ChatPanel] HTTP fallback added', newEvents.length, 'missed events');
          return [...prev, ...newEvents];
        }
        return prev;
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      console.warn('[ChatPanel] HTTP event fetch failed:', err);
    }
  }, []);

  /**
   * Detect running -> idle transitions and trigger HTTP fallback.
   * This ensures we always show the response even if WS missed events.
   */
  useEffect(() => {
    if (isAgentRunning) {
      wasRunningRef.current = true;
    } else if (wasRunningRef.current && selectedAgentId) {
      // Agent just went from running -> idle
      wasRunningRef.current = false;
      // Give WS a moment to deliver the last events, then reconcile via HTTP
      const timer = setTimeout(() => {
        if (selectedAgentId) {
          console.log('[ChatPanel] Agent went idle — reconciling via HTTP');
          fetchAndReconcileEvents(selectedAgentId);
        }
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [isAgentRunning, selectedAgentId, fetchAndReconcileEvents]);

  /**
   * Establish a WebSocket connection to the agent's event stream.
   * Replays buffered events from the backend on connect, then streams live.
   * Automatically retries on failure with exponential backoff.
   */
  const setupWebSocket = useCallback((agentId: string, isRetry = false) => {
    if (!isRetry) {
      // Fresh connection - events are managed by the selectedAgentId effect
      wsRef.current?.close();
      setIsConnected(false);
      retryCountRef.current = 0;
    }

    const ws = new WebSocket(`${WS_BASE}/agents/${agentId}/terminal`);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[ChatPanel] WS connected to', agentId);
      setIsConnected(true);
      retryCountRef.current = 0;
    };

    ws.onclose = (e) => {
      console.log('[ChatPanel] WS closed for', agentId, 'code:', e.code, 'reason:', e.reason);
      // Only process if this WS is still current (prevents cascading reconnect loops)
      if (wsRef.current !== ws) return;
      setIsConnected(false);
      const { isChatOpen: stillOpen, selectedAgentId: stillSelected } = useWorldStore.getState();
      if (stillOpen && stillSelected === agentId && retryCountRef.current < WS_MAX_RETRIES) {
        const delay = WS_RETRY_BASE_MS * Math.pow(2, retryCountRef.current);
        retryCountRef.current++;
        retryTimerRef.current = setTimeout(() => {
          setupWebSocket(agentId, true);
        }, delay);
      }
    };

    ws.onerror = (err) => {
      console.error('[ChatPanel] WS error for', agentId, err);
    };

    ws.onmessage = (msgEvent) => {
      try {
        // Guard: ignore WS messages if we've switched to a different agent
        if (activeAgentRef.current !== agentId) return;

        const raw = JSON.parse(msgEvent.data as string);

        // Handle monet_notification events
        if (raw.type === 'monet_notification' && raw.notification) {
          const { addNotification } = useWorldStore.getState();
          addNotification(raw.notification);
          return;
        }

        const parsed = parseEvent(raw);
        if (parsed.length > 0) {
          // Deduplicate against already-seen events
          const fresh = parsed.filter(e => {
            const fp = eventFingerprint(e);
            if (seenFingerprintsRef.current.has(fp)) return false;
            seenFingerprintsRef.current.add(fp);
            return true;
          });
          if (fresh.length > 0) {
            setEvents(prev => [...prev, ...fresh]);
          }
        }
      } catch {
        // Non-JSON frame - ignore
      }
    };
  }, []);

  /** Connect/disconnect when panel opens or agent changes. */
  useEffect(() => {
    if (isChatOpen && selectedAgentId) {
      // Small delay to let the agent-switch effect (which clears the old WS) finish
      const timer = setTimeout(() => {
        // Double-check the agent hasn't changed since the timeout was scheduled
        if (activeAgentRef.current === selectedAgentId) {
          setupWebSocket(selectedAgentId);
        }
      }, 100);
      return () => {
        clearTimeout(timer);
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
        retryCountRef.current = 0;
        if (wsRef.current) {
          wsRef.current.onmessage = null;
          wsRef.current.onclose = null;
          wsRef.current.onerror = null;
          wsRef.current.close();
          wsRef.current = null;
        }
      };
    }
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
      retryCountRef.current = 0;
      if (wsRef.current) {
        wsRef.current.onmessage = null;
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [isChatOpen, selectedAgentId, setupWebSocket]);

  /**
   * Send the input text to the agent, then clear the field.
   * Sends via HTTP POST only (not WS) to prevent double-sends - the backend
   * spawns the claude process from the HTTP handler and broadcasts events to
   * all WS subscribers automatically.
   * Inserts a local user bubble immediately for instant feedback.
   */
  function handleSend() {
    const text = inputValue.trim();
    if (!text || !selectedAgentId) return;

    // Don't send if agent is still processing
    if (isAgentRunning) {
      console.log('[ChatPanel] Agent is busy, not sending');
      return;
    }

    // Optimistic: show user bubble immediately
    const userEvent: ChatEvent = {
      type: 'user',
      userText: text,
      id: ++_eventCounter,
      raw: {},
    };
    seenFingerprintsRef.current.add(eventFingerprint(userEvent));
    setEvents(prev => [...prev, userEvent]);
    setInputValue('');

    // Send via HTTP POST only (WS is for receiving events, not sending commands)
    fetch(`${HTTP_BASE}/agents/${selectedAgentId}/input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }).catch((err) => console.error('[ChatPanel] HTTP send failed:', err));

    // Poll for response events since WebSocket delivery can be unreliable
    const agentId = selectedAgentId;
    // Cancel any previous poll and create a new abort controller
    pollAbortRef.current?.abort();
    const abortController = new AbortController();
    pollAbortRef.current = abortController;
    const pollForResponse = async () => {
      for (let i = 0; i < 30; i++) { // poll for up to 30 seconds
        await new Promise(r => setTimeout(r, 1000));
        if (abortController.signal.aborted) break;
        if (activeAgentRef.current !== agentId) break;
        await fetchAndReconcileEvents(agentId, abortController.signal);
        // Check if agent went idle (response complete)
        const state = useWorldStore.getState();
        const agent = state.agents.find(a => a.id === agentId);
        if (agent && agent.status !== 'running') break;
      }
    };
    pollForResponse();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <AnimatePresence>
      {isChatOpen && (
        <motion.div
          initial={{ x: 400, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 400, opacity: 0 }}
          transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
          style={{
            position: 'fixed', top: '16px', right: '16px', bottom: '16px',
            width: '480px', background: '#0a0a0a',
            border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
            zIndex: 10000, boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
          }}
        >
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {selectedAgentId && <AgentHeadshot agentId={selectedAgentId} size={38} />}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <span style={{ color: '#fff', fontSize: '14px', fontWeight: 600 }}>{agentName}</span>
                <span style={{
                  fontSize: '10px', fontFamily: 'monospace',
                  color: isAgentRunning ? '#3b82f6' : 'rgba(255,255,255,0.3)',
                }}>
                  {isAgentRunning ? (isConnected ? 'running - live' : 'running - connecting...') : (isConnected ? 'idle - connected' : 'idle')}
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {selectedAgentId && (
                <button
                  onClick={() => isAgentRunning ? stopAgent(selectedAgentId) : startAgent(selectedAgentId)}
                  style={{
                    padding: '4px 10px', borderRadius: '8px', fontSize: '11px', fontWeight: 500, cursor: 'pointer',
                    background: isAgentRunning ? 'rgba(239,68,68,0.12)' : 'rgba(59, 130, 246, 0.12)',
                    border: `1px solid ${isAgentRunning ? 'rgba(239,68,68,0.25)' : 'rgba(59, 130, 246, 0.25)'}`,
                    color: isAgentRunning ? '#ef4444' : '#60a5fa',
                    display: 'flex', alignItems: 'center', gap: '4px',
                  }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: isAgentRunning ? '#ef4444' : '#60a5fa' }} />
                  {isAgentRunning ? 'Stop' : 'Start'}
                </button>
              )}
              <button
                onClick={() => selectedAgentId && confirm(`Delete ${agentName}?`) && deleteAgent(selectedAgentId)}
                style={{ background: 'none', border: 'none', color: 'rgba(239,68,68,0.4)', cursor: 'pointer', padding: '4px', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'rgba(239,68,68,0.8)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'rgba(239,68,68,0.4)')}
              >
                <Trash2 size={14} strokeWidth={1.5} />
              </button>
              <button
                onClick={closeChat}
                style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', padding: '4px', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.7)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.3)')}
              >
                <X size={18} strokeWidth={1.5} />
              </button>
            </div>
          </div>

          {/* Chat body */}
          <>
            {/* Insight panel - shows between header and messages */}
            {selectedAgentId && <InsightPanel agentId={selectedAgentId} />}

            {/* Messages area */}
            <div
              className="chat-scroll"
              style={{ flex: 1, overflowY: 'auto', padding: '20px 18px', display: 'flex', flexDirection: 'column' }}
            >
              {events.length === 0 && (
                <div style={{
                  flex: 1, display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center',
                  color: 'rgba(255,255,255,0.15)', fontSize: '13px', gap: '8px',
                }}>
                  <Terminal size={24} style={{ opacity: 0.3 }} />
                  <span>Send a message to start</span>
                </div>
              )}

                {events.map(evt => {
                  if (evt.type === 'user') {
                    return <UserBubble key={evt.id} text={evt.userText ?? ''} />;
                  }
                  if (evt.type === 'assistant_text') {
                    return <AssistantMessage key={evt.id} text={evt.text ?? ''} />;
                  }
                  if (evt.type === 'tool_call') {
                    return <ToolCallCard key={evt.id} name={evt.toolName ?? 'Tool'} input={evt.toolInput} />;
                  }
                  if (evt.type === 'result') {
                    return <ResultMessage key={evt.id} text={evt.text ?? ''} />;
                  }
                  return null;
                })}

                {/* Thinking indicator - shown while agent is processing */}
                {isAgentRunning && events.length > 0 && (
                  <ThinkingIndicator agentName={agentName} mood={currentAgent?.mood} />
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* Input bar */}
              <div style={{
                padding: '12px 14px',
                borderTop: '1px solid rgba(255,255,255,0.06)',
                flexShrink: 0,
                display: 'flex', gap: '8px', alignItems: 'center',
              }}>
                <input
                  value={inputValue}
                  onChange={e => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={isAgentRunning ? `${agentName} is working...` : `Message ${agentName}...`}
                  disabled={isAgentRunning}
                  style={{
                    flex: 1, background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '10px', padding: '9px 12px',
                    color: '#e4e4e7', fontSize: '13px', outline: 'none',
                    fontFamily: 'inherit',
                    opacity: isAgentRunning ? 0.5 : 1,
                  }}
                  onFocus={e => (e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.45)')}
                  onBlur={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)')}
                />
                <button
                  onClick={handleSend}
                  disabled={!inputValue.trim() || !selectedAgentId || isAgentRunning}
                  style={{
                    padding: '9px 14px', borderRadius: '10px', fontSize: '12px', fontWeight: 600,
                    background: inputValue.trim() && selectedAgentId && !isAgentRunning ? 'rgba(59, 130, 246, 0.2)' : 'rgba(255,255,255,0.05)',
                    border: `1px solid ${inputValue.trim() && selectedAgentId && !isAgentRunning ? 'rgba(59, 130, 246, 0.4)' : 'rgba(255,255,255,0.08)'}`,
                    color: inputValue.trim() && selectedAgentId && !isAgentRunning ? '#93c5fd' : 'rgba(255,255,255,0.2)',
                    cursor: inputValue.trim() && selectedAgentId && !isAgentRunning ? 'pointer' : 'default',
                    flexShrink: 0, transition: 'all 0.15s',
                  }}
                >
                  {isAgentRunning ? '...' : 'Send'}
                </button>
              </div>
            </>

        </motion.div>
      )}
    </AnimatePresence>
  );
}
