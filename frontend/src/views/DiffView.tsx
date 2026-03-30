/**
 * views/DiffView.tsx
 * Code review diff view for Monet.
 *
 * Shows a PR diff with two side-by-side panels (original vs proposed),
 * line numbers, color-coded additions/removals, an agent review summary,
 * and Approve/Reject actions at the bottom.
 *
 * Uses hardcoded mock diff data since the code agent is idle.
 * Synced scrolling keeps both panels in step as the user scrolls.
 */
import { useRef, useCallback } from 'react';
import { ArrowLeft, Check, X } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Type of a single diff line */
type DiffLineType = 'added' | 'removed' | 'context';

/** A single line in the diff with its type and content */
interface DiffLine {
  type: DiffLineType;
  lineNumber: number | null;
  content: string;
}

/** One file's worth of diff data */
interface DiffFile {
  path: string;
  originalLines: DiffLine[];
  proposedLines: DiffLine[];
}

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

/**
 * Sample PR diff showing an auth utility refactor.
 * Original = left panel (removed/context lines).
 * Proposed = right panel (added/context lines).
 */
const MOCK_PR_TITLE = 'PR #47 - Refactor auth token validation';

const MOCK_AGENT_REVIEW =
  'The changes look correct. The null-check guard added on line 14 prevents a crash ' +
  'when the token is undefined, and extracting the helper function improves readability. ' +
  'No logic regressions detected. Safe to approve.';

const MOCK_DIFF_FILES: DiffFile[] = [
  {
    path: 'src/lib/auth.ts',
    originalLines: [
      { type: 'context', lineNumber: 1, content: 'import { jwtDecode } from "jwt-decode";' },
      { type: 'context', lineNumber: 2, content: '' },
      { type: 'context', lineNumber: 3, content: 'export function validateToken(token: string) {' },
      { type: 'removed', lineNumber: 4, content: '  const decoded = jwtDecode(token);' },
      { type: 'removed', lineNumber: 5, content: '  return decoded.exp > Date.now() / 1000;' },
      { type: 'context', lineNumber: 6, content: '}' },
      { type: 'context', lineNumber: 7, content: '' },
      { type: 'context', lineNumber: 8, content: 'export function getUser(token: string) {' },
      { type: 'removed', lineNumber: 9, content: '  return jwtDecode(token).sub;' },
      { type: 'context', lineNumber: 10, content: '}' },
    ],
    proposedLines: [
      { type: 'context', lineNumber: 1, content: 'import { jwtDecode } from "jwt-decode";' },
      { type: 'context', lineNumber: 2, content: '' },
      { type: 'context', lineNumber: 3, content: 'export function validateToken(token: string) {' },
      { type: 'added', lineNumber: 4, content: '  if (!token) return false;' },
      { type: 'added', lineNumber: 5, content: '  const decoded = jwtDecode(token);' },
      { type: 'added', lineNumber: 6, content: '  return decoded.exp > Date.now() / 1000;' },
      { type: 'context', lineNumber: 7, content: '}' },
      { type: 'context', lineNumber: 8, content: '' },
      { type: 'context', lineNumber: 9, content: 'export function getUser(token: string) {' },
      { type: 'added', lineNumber: 10, content: '  if (!token) return null;' },
      { type: 'added', lineNumber: 11, content: '  return jwtDecode(token).sub ?? null;' },
      { type: 'context', lineNumber: 12, content: '}' },
    ],
  },
  {
    path: 'src/middleware/authMiddleware.ts',
    originalLines: [
      { type: 'context', lineNumber: 1, content: 'import { validateToken } from "@/lib/auth";' },
      { type: 'context', lineNumber: 2, content: '' },
      { type: 'context', lineNumber: 3, content: 'export async function authMiddleware(req, res, next) {' },
      { type: 'context', lineNumber: 4, content: '  const token = req.headers.authorization;' },
      { type: 'removed', lineNumber: 5, content: '  if (!validateToken(token)) {' },
      { type: 'removed', lineNumber: 6, content: '    return res.status(401).json({ error: "Unauthorized" });' },
      { type: 'context', lineNumber: 7, content: '  }' },
      { type: 'context', lineNumber: 8, content: '  next();' },
      { type: 'context', lineNumber: 9, content: '}' },
    ],
    proposedLines: [
      { type: 'context', lineNumber: 1, content: 'import { validateToken } from "@/lib/auth";' },
      { type: 'context', lineNumber: 2, content: '' },
      { type: 'context', lineNumber: 3, content: 'export async function authMiddleware(req, res, next) {' },
      { type: 'context', lineNumber: 4, content: '  const token = req.headers.authorization;' },
      { type: 'added', lineNumber: 5, content: '  const bearer = token?.replace("Bearer ", "") ?? "";' },
      { type: 'added', lineNumber: 6, content: '  if (!validateToken(bearer)) {' },
      { type: 'added', lineNumber: 7, content: '    return res.status(401).json({ error: "Unauthorized" });' },
      { type: 'context', lineNumber: 8, content: '  }' },
      { type: 'context', lineNumber: 9, content: '  next();' },
      { type: 'context', lineNumber: 10, content: '}' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Background color for a diff line based on its type */
function lineBackground(type: DiffLineType): string {
  if (type === 'added') return 'rgba(34,197,94,0.08)';
  if (type === 'removed') return 'rgba(239,68,68,0.08)';
  return 'transparent';
}

/** Prefix glyph for a diff line */
function lineGlyph(type: DiffLineType): string {
  if (type === 'added') return '+';
  if (type === 'removed') return '-';
  return ' ';
}

/** Text color for the glyph */
function glyphColor(type: DiffLineType): string {
  if (type === 'added') return 'rgba(34,197,94,0.8)';
  if (type === 'removed') return 'rgba(239,68,68,0.7)';
  return 'transparent';
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface DiffPanelProps {
  label: string;
  lines: DiffLine[];
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onScroll: (e: React.UIEvent<HTMLDivElement>) => void;
}

/**
 * One side of the side-by-side diff panel (original or proposed).
 * Renders line numbers, glyph, and code content in monospace.
 */
function DiffPanel({ label, lines, scrollRef, onScroll }: DiffPanelProps) {
  return (
    <div className="flex flex-col flex-1 min-w-0 rounded-xl overflow-hidden border" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
      {/* Panel header */}
      <div
        className="px-4 py-2.5 shrink-0 border-b"
        style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.06)' }}
      >
        <span className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
          {label}
        </span>
      </div>

      {/* Scrollable code area */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 overflow-auto"
        style={{ background: '#0f0f0f' }}
      >
        <table className="w-full border-collapse font-mono text-[12.5px] leading-6">
          <tbody>
            {lines.map((line, idx) => (
              <tr
                key={idx}
                style={{ background: lineBackground(line.type) }}
              >
                {/* Line number */}
                <td
                  className="select-none text-right pr-3 pl-4 text-zinc-600 w-10 shrink-0"
                  style={{ minWidth: '2.5rem' }}
                >
                  {line.lineNumber ?? ''}
                </td>

                {/* Glyph column */}
                <td
                  className="select-none pr-2 w-4 shrink-0 font-bold"
                  style={{ color: glyphColor(line.type), minWidth: '1rem' }}
                >
                  {lineGlyph(line.type)}
                </td>

                {/* Code content */}
                <td className="pr-6 text-zinc-200 whitespace-pre">
                  {line.content}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface FileDiffProps {
  file: DiffFile;
}

/**
 * Renders one file's diff with synced-scroll side-by-side panels.
 */
function FileDiff({ file }: FileDiffProps) {
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const isSyncing = useRef(false);

  /**
   * Keeps the opposite panel in sync when the user scrolls one side.
   * Uses a guard flag to prevent infinite sync loops.
   */
  const handleLeftScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (isSyncing.current) return;
    isSyncing.current = true;
    if (rightRef.current) {
      rightRef.current.scrollTop = (e.target as HTMLDivElement).scrollTop;
      rightRef.current.scrollLeft = (e.target as HTMLDivElement).scrollLeft;
    }
    isSyncing.current = false;
  }, []);

  const handleRightScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (isSyncing.current) return;
    isSyncing.current = true;
    if (leftRef.current) {
      leftRef.current.scrollTop = (e.target as HTMLDivElement).scrollTop;
      leftRef.current.scrollLeft = (e.target as HTMLDivElement).scrollLeft;
    }
    isSyncing.current = false;
  }, []);

  return (
    <div className="flex flex-col gap-2">
      {/* File path label */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-mono text-zinc-500 px-2 py-1 rounded-md bg-zinc-900 border" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          {file.path}
        </span>
      </div>

      {/* Side-by-side panels */}
      <div className="flex gap-3" style={{ height: '280px' }}>
        <DiffPanel
          label="Original"
          lines={file.originalLines}
          scrollRef={leftRef}
          onScroll={handleLeftScroll}
        />
        <DiffPanel
          label="Proposed"
          lines={file.proposedLines}
          scrollRef={rightRef}
          onScroll={handleRightScroll}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

/**
 * Full PR diff review view.
 *
 * Shows mock PR diff data in a two-panel layout with synced scrolling,
 * an agent review summary, and Approve/Reject action buttons.
 */
export function DiffView() {
  const { setOverlayView } = useAppStore();

  return (
    <div className="flex flex-col w-full h-full bg-black overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 pt-5 pb-4 shrink-0">
        <button
          onClick={() => setOverlayView(null)}
          className="flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <ArrowLeft size={16} />
          Back
        </button>
        <span className="text-sm text-zinc-500">{MOCK_PR_TITLE}</span>
      </div>

      {/* Divider */}
      <div className="h-px mx-6 shrink-0" style={{ background: 'rgba(255,255,255,0.06)' }} />

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-6">
        {/* File diffs */}
        {MOCK_DIFF_FILES.map((file) => (
          <FileDiff key={file.path} file={file} />
        ))}

        {/* Agent review */}
        <div
          className="rounded-xl border p-5"
          style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.06)' }}
        >
          <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500 mb-2">
            Agent Review
          </p>
          <p className="text-sm text-zinc-300 leading-relaxed">
            {MOCK_AGENT_REVIEW}
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex items-center justify-between pb-2">
          <button
            className="flex items-center gap-2 h-10 px-6 rounded-xl border border-zinc-700 text-zinc-400 text-sm font-medium transition-all hover:border-red-500/50 hover:text-red-400 bg-transparent cursor-pointer"
            onClick={() => setOverlayView(null)}
          >
            <X size={14} />
            Reject
          </button>

          <button
            className="flex items-center gap-2 h-10 px-6 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-all cursor-pointer"
            onClick={() => setOverlayView(null)}
          >
            <Check size={14} />
            Approve &amp; Merge
          </button>
        </div>
      </div>
    </div>
  );
}
