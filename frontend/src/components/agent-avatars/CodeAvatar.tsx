/**
 * components/agent-avatars/CodeAvatar.tsx
 * "Kai" - the precise engineer character for the Code agent.
 *
 * An angular robot face with a visor-like eye bar and geometric features:
 *   running     - visor sweeps/scans with green glow effect, head bobs
 *   hasDecisions - one brow raises, thinking expression, blue pulse
 *   idle        - neutral face with slow blink
 *   error       - red warning triangle overlays the face
 *
 * Uses pure CSS keyframe animations - no external dependencies.
 * Renders at 48x48px container.
 */

import type { Agent } from '@/types';

interface CodeAvatarProps {
  /** Current agent status */
  status: Agent['status'];
  /** Whether the agent has pending decisions requiring attention */
  hasDecisions?: boolean;
}

const ID = 'kai';

/**
 * Kai - a blue-toned angular robot face for the Code agent.
 * Geometric, precise, and analytical - visor eyes that scan and analyze.
 */
export function CodeAvatar({ status, hasDecisions = false }: CodeAvatarProps) {
  const isRunning = status === 'running';
  const isError = status === 'error';
  const isAttention = hasDecisions;
  const isIdle = !isRunning && !isError && !isAttention;

  /* Color palette - blue tones */
  const primary = isError ? '#ef4444' : '#3b82f6';
  const faceStroke = isError ? '#ef4444' : isRunning ? '#60a5fa' : isAttention ? '#93c5fd' : '#2563eb';
  const faceFill = isError ? 'rgba(239,68,68,0.1)' : isRunning ? 'rgba(59,130,246,0.16)' : isAttention ? 'rgba(59,130,246,0.20)' : 'rgba(59,130,246,0.09)';
  const visorColor = isError ? '#fca5a5' : isRunning ? '#22c55e' : isAttention ? '#93c5fd' : '#60a5fa';
  const visorGlow = isRunning ? '#22c55e' : '#3b82f6';

  return (
    <div
      style={{ width: 48, height: 48, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      aria-label="Kai - Code agent"
    >
      <style>{`
        /* Head slow breathe */
        @keyframes ${ID}-breathe {
          0%, 100% { opacity: 0.85; transform: translateY(0); }
          50%       { opacity: 1; transform: translateY(-0.5px); }
        }
        /* Running - focused bob */
        @keyframes ${ID}-process {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          25%       { transform: translateY(-1px) rotate(-0.5deg); }
          75%       { transform: translateY(-0.5px) rotate(0.5deg); }
        }
        /* Visor scan sweep left-to-right */
        @keyframes ${ID}-visor-scan {
          0%   { transform: translateX(-6px); opacity: 0.4; }
          50%  { transform: translateX(6px); opacity: 1; }
          100% { transform: translateX(-6px); opacity: 0.4; }
        }
        /* Visor glow pulse when running */
        @keyframes ${ID}-visor-glow {
          0%, 100% { filter: drop-shadow(0 0 1px #22c55e); }
          50%       { filter: drop-shadow(0 0 6px #22c55e) drop-shadow(0 0 12px #16a34a50); }
        }
        /* Idle slow blink - visor dims */
        @keyframes ${ID}-visor-blink {
          0%, 85%, 100% { transform: scaleY(1); opacity: 0.9; }
          90%            { transform: scaleY(0.1); opacity: 0.3; }
        }
        /* Attention: raised brow pulse */
        @keyframes ${ID}-brow-raise {
          0%, 100% { transform: translateY(0); }
          50%       { transform: translateY(-2px); }
        }
        /* Attention glow */
        @keyframes ${ID}-attention-glow {
          0%, 100% { filter: drop-shadow(0 0 2px #3b82f6); }
          50%       { filter: drop-shadow(0 0 8px #3b82f6) drop-shadow(0 0 16px #1d4ed860); }
        }
        /* Error shake */
        @keyframes ${ID}-shake {
          0%, 100% { transform: translateX(0) rotate(0deg); }
          20%       { transform: translateX(-2px) rotate(-2deg); }
          40%       { transform: translateX(2px) rotate(2deg); }
          60%       { transform: translateX(-1.5px); }
          80%       { transform: translateX(1px); }
        }
        /* Warning triangle pulse */
        @keyframes ${ID}-warn-pulse {
          0%, 100% { opacity: 0.9; transform: scale(1); }
          50%       { opacity: 0.6; transform: scale(0.95); }
        }
        /* Thinking dot bounce when attention */
        @keyframes ${ID}-think-dot {
          0%, 100% { transform: translateY(0) scale(1); opacity: 1; }
          50%       { transform: translateY(-4px) scale(1.15); opacity: 0.8; }
        }
        /* Bolt/vent marks pulse */
        @keyframes ${ID}-bolt {
          0%, 100% { opacity: 0.4; }
          50%       { opacity: 0.7; }
        }

        .${ID}-head {
          animation: ${
            isError     ? `${ID}-shake 0.5s ease-in-out infinite` :
            isRunning   ? `${ID}-process 1.8s ease-in-out infinite` :
            isAttention ? `${ID}-attention-glow 2s ease-in-out infinite` :
            `${ID}-breathe 4s ease-in-out infinite`
          };
        }
        .${ID}-visor {
          transform-box: fill-box;
          transform-origin: center;
          animation: ${
            isError   ? 'none' :
            isRunning ? `${ID}-visor-blink 0.1s step-start 0s, ${ID}-visor-glow 1.6s ease-in-out infinite` :
            isIdle    ? `${ID}-visor-blink 5s ease-in-out infinite` :
            'none'
          };
        }
        .${ID}-visor-scan-bar {
          animation: ${isRunning ? `${ID}-visor-scan 1.2s ease-in-out infinite` : 'none'};
        }
        .${ID}-brow-left {
          transform-box: fill-box;
          transform-origin: center;
          animation: ${isAttention ? `${ID}-brow-raise 1.5s ease-in-out infinite` : 'none'};
          animation-delay: 0s;
        }
        .${ID}-brow-right {
          transform-box: fill-box;
          transform-origin: center;
          /* Only left brow raises on thinking */
          animation: none;
        }
        .${ID}-think {
          animation: ${isAttention ? `${ID}-think-dot 1.2s ease-in-out infinite` : 'none'};
          transform-box: fill-box;
          transform-origin: center bottom;
        }
        .${ID}-bolt {
          animation: ${isRunning ? `${ID}-bolt 1.2s ease-in-out infinite` : 'none'};
        }
        .${ID}-warn {
          animation: ${isError ? `${ID}-warn-pulse 0.8s ease-in-out infinite` : 'none'};
          transform-box: fill-box;
          transform-origin: center;
        }
      `}</style>

      <svg
        width="48"
        height="48"
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`${ID}-head`}
      >
        {/* Head - square with slightly rounded corners, geometric */}
        <rect
          x="8" y="10"
          width="32" height="30"
          rx="5"
          fill={faceFill}
          stroke={faceStroke}
          strokeWidth="1.6"
        />

        {/* Neck connector */}
        <rect x="20" y="40" width="8" height="3" rx="1.5" fill={faceStroke} opacity="0.5" />

        {/* Side ear-vents (horizontal lines on sides) */}
        <line x1="8" y1="19" x2="4" y2="19" stroke={faceStroke} strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
        <line x1="8" y1="23" x2="4" y2="23" stroke={faceStroke} strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />
        <line x1="40" y1="19" x2="44" y2="19" stroke={faceStroke} strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
        <line x1="40" y1="23" x2="44" y2="23" stroke={faceStroke} strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />

        {/* Top antenna nubs */}
        <rect x="15" y="7" width="4" height="4" rx="1" fill={faceStroke} opacity="0.7" />
        <rect x="29" y="7" width="4" height="4" rx="1" fill={faceStroke} opacity="0.7" />
        <circle className={`${ID}-bolt`} cx="17" cy="9" r="1" fill={isRunning ? '#22c55e' : primary} />
        <circle className={`${ID}-bolt`} cx="31" cy="9" r="1" fill={isRunning ? '#22c55e' : primary} />

        {/* --- EYEBROWS --- angular lines above visor */}
        <line
          className={`${ID}-brow-left`}
          x1="12" y1="17.5" x2="21" y2="17.5"
          stroke={isAttention ? '#93c5fd' : faceStroke}
          strokeWidth={isAttention ? 2.2 : 1.6}
          strokeLinecap="square"
          opacity="0.8"
        />
        <line
          className={`${ID}-brow-right`}
          x1="27" y1="17.5" x2="36" y2="17.5"
          stroke={faceStroke}
          strokeWidth="1.6"
          strokeLinecap="square"
          opacity="0.8"
        />

        {/* --- VISOR (main eye bar) --- */}
        {isError ? (
          /* Error: X eyes */
          <>
            <line x1="12" y1="21" x2="21" y2="29" stroke="#fca5a5" strokeWidth="2" strokeLinecap="round" />
            <line x1="21" y1="21" x2="12" y2="29" stroke="#fca5a5" strokeWidth="2" strokeLinecap="round" />
            <line x1="27" y1="21" x2="36" y2="29" stroke="#fca5a5" strokeWidth="2" strokeLinecap="round" />
            <line x1="36" y1="21" x2="27" y2="29" stroke="#fca5a5" strokeWidth="2" strokeLinecap="round" />
          </>
        ) : (
          /* Normal visor bar */
          <>
            <rect
              className={`${ID}-visor`}
              x="11" y="20"
              width="26" height="10"
              rx="2.5"
              fill={isRunning ? 'rgba(34,197,94,0.15)' : isAttention ? 'rgba(59,130,246,0.2)' : 'rgba(59,130,246,0.12)'}
              stroke={visorColor}
              strokeWidth="1.4"
            />
            {/* Visor interior scan highlight */}
            <rect
              className={`${ID}-visor-scan-bar`}
              x="14" y="22"
              width="8" height="6"
              rx="1"
              fill={isRunning ? 'rgba(34,197,94,0.5)' : 'rgba(59,130,246,0.3)'}
            />
            {/* Visor divider center line */}
            <line
              x1="24" y1="20" x2="24" y2="30"
              stroke={visorColor}
              strokeWidth="0.8"
              opacity="0.4"
            />
          </>
        )}

        {/* --- MOUTH --- panel-like slot */}
        {isError ? (
          /* Frown grill */
          <path
            d="M15 36 Q24 32.5 33 36"
            stroke="#fca5a5"
            strokeWidth="1.6"
            fill="none"
            strokeLinecap="round"
          />
        ) : isRunning ? (
          /* Focused narrow line - concentrating */
          <rect
            x="17" y="34.5" width="14" height="2"
            rx="1"
            fill={visorColor}
            opacity="0.7"
          />
        ) : isAttention ? (
          /* Slight asymmetric smirk - thinking */
          <path
            d="M16 35 Q20 36.5 24 35 Q28 33.5 32 34.5"
            stroke={visorColor}
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
          />
        ) : (
          /* Idle neutral grill */
          <>
            <rect x="17" y="34" width="14" height="2.5" rx="1.2" fill={faceStroke} opacity="0.3" />
            <line x1="21" y1="34" x2="21" y2="36.5" stroke={faceStroke} strokeWidth="0.8" opacity="0.4" />
            <line x1="24" y1="34" x2="24" y2="36.5" stroke={faceStroke} strokeWidth="0.8" opacity="0.4" />
            <line x1="27" y1="34" x2="27" y2="36.5" stroke={faceStroke} strokeWidth="0.8" opacity="0.4" />
          </>
        )}

        {/* Thinking bubble when hasDecisions */}
        {isAttention && (
          <g className={`${ID}-think`} transform="translate(34, 8)">
            <circle cx="0" cy="0" r="5.5" fill="#3b82f6" opacity="0.95" />
            {/* Question mark */}
            <path
              d="M-1.5 -3 Q-1.5 -5 0 -5 Q2 -5 2 -3 Q2 -1.5 0 -1 L0 0.5"
              stroke="white"
              strokeWidth="1.4"
              fill="none"
              strokeLinecap="round"
            />
            <circle cx="0" cy="2" r="0.8" fill="white" />
          </g>
        )}
      </svg>
    </div>
  );
}
