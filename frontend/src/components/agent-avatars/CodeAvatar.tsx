/**
 * components/agent-avatars/CodeAvatar.tsx
 * Animated SVG avatar for the Code agent.
 *
 * States:
 *   running        - cursor blinks inside terminal, code lines scroll in from bottom
 *   needs-attention / has decisions - brackets pulse violet glow
 *   idle           - static muted brackets, very slow breathe
 *   error          - red tint, X overlay on the brackets
 *
 * Uses pure CSS keyframe animations - no external deps.
 * Size: 48x48px container.
 */

import type { Agent } from '@/types';

interface CodeAvatarProps {
  status: Agent['status'];
  hasDecisions?: boolean;
}

const ID = 'code-avatar';

/**
 * Animated code-brackets / terminal icon for the code agent.
 * Cursor blinks and lines appear during running state.
 */
export function CodeAvatar({ status, hasDecisions = false }: CodeAvatarProps) {
  const isRunning = status === 'running';
  const isError = status === 'error';
  const isAttention = hasDecisions;

  const bracketColor = isError ? '#ef4444' : isRunning || isAttention ? '#8b5cf6' : '#52525b';
  const lineColor = isError ? '#fca5a5' : isRunning ? '#c4b5fd' : isAttention ? '#a78bfa' : '#3f3f46';

  return (
    <div
      style={{ width: 48, height: 48, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      aria-label="Code agent avatar"
    >
      <style>{`
        @keyframes ${ID}-cursor-blink {
          0%, 49%  { opacity: 1; }
          50%, 100% { opacity: 0; }
        }
        @keyframes ${ID}-line-in-1 {
          0%   { opacity: 0; transform: translateY(5px); }
          20%  { opacity: 1; transform: translateY(0); }
          80%  { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes ${ID}-line-in-2 {
          0%   { opacity: 0; transform: translateY(5px); }
          30%  { opacity: 1; transform: translateY(0); }
          80%  { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes ${ID}-line-in-3 {
          0%   { opacity: 0; transform: translateY(5px); }
          45%  { opacity: 1; transform: translateY(0); }
          80%  { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes ${ID}-pulse-glow {
          0%, 100% { filter: drop-shadow(0 0 0px #8b5cf6); opacity: 1; }
          50%       { filter: drop-shadow(0 0 7px #8b5cf6); opacity: 0.88; }
        }
        @keyframes ${ID}-idle-breathe {
          0%, 100% { opacity: 0.5; }
          50%       { opacity: 0.65; }
        }
        @keyframes ${ID}-error-flash {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.7; }
        }

        .${ID}-brackets {
          animation: ${
            isError ? `${ID}-error-flash 0.6s ease-in-out infinite` :
            isRunning ? 'none' :
            isAttention ? `${ID}-pulse-glow 2s ease-in-out infinite` :
            `${ID}-idle-breathe 3.5s ease-in-out infinite`
          };
        }
        .${ID}-cursor {
          animation: ${isRunning ? `${ID}-cursor-blink 0.9s step-start infinite` : 'none'};
        }
        .${ID}-code-l1 {
          animation: ${isRunning ? `${ID}-line-in-1 2s ease-out infinite` : 'none'};
          animation-delay: 0s;
        }
        .${ID}-code-l2 {
          animation: ${isRunning ? `${ID}-line-in-2 2s ease-out infinite` : 'none'};
          animation-delay: 0.3s;
        }
        .${ID}-code-l3 {
          animation: ${isRunning ? `${ID}-line-in-3 2s ease-out infinite` : 'none'};
          animation-delay: 0.6s;
        }
      `}</style>

      <svg
        width="48"
        height="48"
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Outer terminal background */}
        <rect
          x="5" y="9" width="38" height="30"
          rx="4"
          fill={isRunning || isAttention ? '#8b5cf620' : '#27272a'}
          stroke={bracketColor}
          strokeWidth="1.4"
          className={`${ID}-brackets`}
        />

        {/* Terminal top bar dot indicators */}
        <circle cx="12" cy="15.5" r="1.8" fill={isError ? '#ef4444' : '#ef4444'} opacity="0.7" />
        <circle cx="18" cy="15.5" r="1.8" fill="#f59e0b" opacity="0.7" />
        <circle cx="24" cy="15.5" r="1.8" fill="#22c55e" opacity="0.7" />

        {/* Divider line */}
        <line x1="5" y1="20" x2="43" y2="20" stroke={bracketColor} strokeWidth="0.8" opacity="0.4" />

        {/* Code lines - animated when running */}
        <rect
          className={`${ID}-code-l1`}
          x="10" y="24" width="18" height="2"
          rx="1"
          fill={lineColor}
          opacity={isRunning ? 0 : 0.5}
        />
        <rect
          className={`${ID}-code-l2`}
          x="10" y="28.5" width="24" height="2"
          rx="1"
          fill={lineColor}
          opacity={isRunning ? 0 : 0.35}
        />
        <rect
          className={`${ID}-code-l3`}
          x="10" y="33" width="14" height="2"
          rx="1"
          fill={lineColor}
          opacity={isRunning ? 0 : 0.25}
        />

        {/* Blinking cursor - running only */}
        {isRunning && (
          <rect
            className={`${ID}-cursor`}
            x="10" y="24" width="2.5" height="9"
            rx="0.5"
            fill={lineColor}
          />
        )}

        {/* Error X overlay */}
        {isError && (
          <>
            <line x1="16" y1="24" x2="32" y2="36" stroke="#fca5a5" strokeWidth="2" strokeLinecap="round" />
            <line x1="32" y1="24" x2="16" y2="36" stroke="#fca5a5" strokeWidth="2" strokeLinecap="round" />
          </>
        )}

        {/* Notification dot */}
        {isAttention && (
          <circle cx="37" cy="12" r="5" fill="#8b5cf6" />
        )}
      </svg>
    </div>
  );
}
