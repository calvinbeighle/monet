/**
 * components/agent-avatars/EmailAvatar.tsx
 * "Mira" - the efficient assistant character for the Email agent.
 *
 * A friendly robot face with expressive eyes and mouth that change per state:
 *   running     - eyes scan left-to-right (reading), slight smile
 *   hasDecisions - eyes widen with exclamation mark above, bouncy feel
 *   idle        - peaceful face with gentle breathing
 *   error       - X eyes and a frown
 *
 * Uses pure CSS keyframe animations - no external dependencies.
 * Renders at 48x48px, fills parent container via width/height 100%.
 */

import type { Agent } from '@/types';

interface EmailAvatarProps {
  /** Current agent status */
  status: Agent['status'];
  /** Whether the agent has pending decisions requiring attention */
  hasDecisions?: boolean;
}

const ID = 'mira';

/**
 * Mira - a violet-toned robot face character representing the Email agent.
 * Her eyes animate to reflect what she's currently doing.
 */
export function EmailAvatar({ status, hasDecisions = false }: EmailAvatarProps) {
  const isRunning = status === 'running';
  const isError = status === 'error';
  const isAttention = hasDecisions;
  const isIdle = !isRunning && !isError && !isAttention;

  /* Color palette */
  const primary = isError ? '#ef4444' : '#8b5cf6';
  const faceStroke = isError ? '#ef4444' : isRunning ? '#a78bfa' : isAttention ? '#c4b5fd' : '#7c3aed';
  const faceFill = isError ? 'rgba(239,68,68,0.12)' : isRunning ? 'rgba(139,92,246,0.18)' : isAttention ? 'rgba(139,92,246,0.22)' : 'rgba(139,92,246,0.10)';
  const eyeColor = isError ? '#fca5a5' : isRunning ? '#c4b5fd' : isAttention ? '#ffffff' : '#ddd6fe';
  const mouthColor = isError ? '#fca5a5' : '#c4b5fd';

  return (
    <div
      style={{ width: 48, height: 48, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      aria-label="Mira - Email agent"
    >
      <style>{`
        /* Face idle breathe */
        @keyframes ${ID}-breathe {
          0%, 100% { transform: scaleY(1) translateY(0); opacity: 0.85; }
          50%       { transform: scaleY(1.015) translateY(-0.4px); opacity: 1; }
        }
        /* Running: whole face does a tiny bob */
        @keyframes ${ID}-bob {
          0%, 100% { transform: translateY(0); }
          50%       { transform: translateY(-1px); }
        }
        /* Eyes scan left to right when running */
        @keyframes ${ID}-eye-scan {
          0%   { transform: translateX(-2px); }
          50%  { transform: translateX(2px); }
          100% { transform: translateX(-2px); }
        }
        /* Eyes widen (scale up) when attention needed */
        @keyframes ${ID}-eye-widen {
          0%, 100% { transform: scale(1); }
          50%       { transform: scale(1.3); }
        }
        /* Idle slow blink */
        @keyframes ${ID}-blink {
          0%, 88%, 100% { transform: scaleY(1); }
          92%            { transform: scaleY(0.08); }
        }
        /* Exclamation bounce when hasDecisions */
        @keyframes ${ID}-exclaim-bounce {
          0%, 100% { transform: translateY(0) scale(1); opacity: 1; }
          45%       { transform: translateY(-3px) scale(1.1); opacity: 1; }
          90%       { opacity: 0.7; }
        }
        /* Ear antenna blink */
        @keyframes ${ID}-antenna {
          0%, 80%, 100% { fill: #8b5cf6; }
          85%            { fill: #ffffff; }
        }
        /* Error shake */
        @keyframes ${ID}-shake {
          0%, 100% { transform: translateX(0); }
          20%       { transform: translateX(-2px) rotate(-2deg); }
          40%       { transform: translateX(2px) rotate(2deg); }
          60%       { transform: translateX(-1.5px); }
          80%       { transform: translateX(1px); }
        }
        /* Violet pulse glow when attention */
        @keyframes ${ID}-attention-glow {
          0%, 100% { filter: drop-shadow(0 0 2px #8b5cf6); }
          50%       { filter: drop-shadow(0 0 8px #8b5cf6) drop-shadow(0 0 14px #7c3aed60); }
        }

        .${ID}-face {
          animation: ${
            isError      ? `${ID}-shake 0.55s ease-in-out infinite` :
            isRunning    ? `${ID}-bob 1.4s ease-in-out infinite` :
            isAttention  ? `${ID}-attention-glow 2s ease-in-out infinite` :
            `${ID}-breathe 3.8s ease-in-out infinite`
          };
        }
        .${ID}-eye-left {
          transform-box: fill-box;
          transform-origin: center;
          animation: ${
            isError     ? 'none' :
            isRunning   ? `${ID}-eye-scan 1.6s ease-in-out infinite` :
            isAttention ? `${ID}-eye-widen 1.8s ease-in-out infinite` :
            `${ID}-blink 4.5s ease-in-out infinite`
          };
        }
        .${ID}-eye-right {
          transform-box: fill-box;
          transform-origin: center;
          animation: ${
            isError     ? 'none' :
            isRunning   ? `${ID}-eye-scan 1.6s ease-in-out infinite` :
            isAttention ? `${ID}-eye-widen 1.8s ease-in-out infinite` :
            `${ID}-blink 4.5s ease-in-out infinite`
          };
          animation-delay: ${isRunning ? '0s' : '0.08s'};
        }
        .${ID}-antenna-dot {
          animation: ${isRunning ? `${ID}-antenna 1.4s ease-in-out infinite` : 'none'};
        }
        .${ID}-exclaim {
          animation: ${isAttention ? `${ID}-exclaim-bounce 1.2s ease-in-out infinite` : 'none'};
          transform-box: fill-box;
          transform-origin: center bottom;
        }
      `}</style>

      <svg
        width="48"
        height="48"
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`${ID}-face`}
      >
        {/* Antenna / top protrusion */}
        <line
          x1="24" y1="5" x2="24" y2="11"
          stroke={faceStroke}
          strokeWidth="1.8"
          strokeLinecap="round"
          opacity="0.8"
        />
        <circle
          className={`${ID}-antenna-dot`}
          cx="24" cy="4.5" r="2"
          fill={isRunning ? '#8b5cf6' : primary}
          opacity="0.9"
        />

        {/* Face circle */}
        <circle
          cx="24" cy="26"
          r="16"
          fill={faceFill}
          stroke={faceStroke}
          strokeWidth="1.6"
        />

        {/* Ear stubs */}
        <rect x="7" y="22" width="3" height="8" rx="1.5" fill={faceStroke} opacity="0.55" />
        <rect x="38" y="22" width="3" height="8" rx="1.5" fill={faceStroke} opacity="0.55" />

        {/* --- EYES --- */}
        {isError ? (
          /* X eyes for error state */
          <>
            <line x1="17" y1="21.5" x2="20.5" y2="25" stroke={eyeColor} strokeWidth="1.8" strokeLinecap="round" />
            <line x1="20.5" y1="21.5" x2="17" y2="25" stroke={eyeColor} strokeWidth="1.8" strokeLinecap="round" />
            <line x1="27.5" y1="21.5" x2="31" y2="25" stroke={eyeColor} strokeWidth="1.8" strokeLinecap="round" />
            <line x1="31" y1="21.5" x2="27.5" y2="25" stroke={eyeColor} strokeWidth="1.8" strokeLinecap="round" />
          </>
        ) : (
          /* Normal oval/circle eyes */
          <>
            <ellipse
              className={`${ID}-eye-left`}
              cx="19" cy="23.5"
              rx={isAttention ? 4 : 3.2}
              ry={isAttention ? 4.5 : 3.8}
              fill={eyeColor}
              opacity="0.95"
            />
            {/* Pupil left */}
            <circle
              className={`${ID}-eye-left`}
              cx="19" cy="24"
              r="1.6"
              fill={primary}
            />
            <ellipse
              className={`${ID}-eye-right`}
              cx="29" cy="23.5"
              rx={isAttention ? 4 : 3.2}
              ry={isAttention ? 4.5 : 3.8}
              fill={eyeColor}
              opacity="0.95"
            />
            {/* Pupil right */}
            <circle
              className={`${ID}-eye-right`}
              cx="29" cy="24"
              r="1.6"
              fill={primary}
            />
            {/* Specular highlights */}
            <circle cx="20.2" cy="22.4" r="0.9" fill="rgba(255,255,255,0.8)" />
            <circle cx="30.2" cy="22.4" r="0.9" fill="rgba(255,255,255,0.8)" />
          </>
        )}

        {/* --- MOUTH --- */}
        {isError ? (
          /* Frown */
          <path
            d="M18 32.5 Q24 29 30 32.5"
            stroke={mouthColor}
            strokeWidth="1.6"
            fill="none"
            strokeLinecap="round"
          />
        ) : isRunning ? (
          /* Slight open smile - reading actively */
          <path
            d="M18 31 Q24 35 30 31"
            stroke={mouthColor}
            strokeWidth="1.6"
            fill="none"
            strokeLinecap="round"
          />
        ) : isAttention ? (
          /* Wide open O mouth - surprised */
          <ellipse
            cx="24" cy="32"
            rx="4.5" ry="3"
            fill="rgba(196,181,253,0.25)"
            stroke={mouthColor}
            strokeWidth="1.4"
          />
        ) : (
          /* Calm gentle smile - idle */
          <path
            d="M19 31.5 Q24 34.5 29 31.5"
            stroke={mouthColor}
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
          />
        )}

        {/* Cheek blush marks - idle and running */}
        {!isError && (
          <>
            <ellipse cx="13" cy="28" rx="2.5" ry="1.2" fill={primary} opacity="0.18" />
            <ellipse cx="35" cy="28" rx="2.5" ry="1.2" fill={primary} opacity="0.18" />
          </>
        )}

        {/* Exclamation mark when hasDecisions */}
        {isAttention && (
          <g className={`${ID}-exclaim`} transform="translate(34, 7)">
            <circle cx="0" cy="0" r="5.5" fill="#8b5cf6" opacity="0.95" />
            <rect x="-1" y="-3.5" width="2" height="4.5" rx="1" fill="white" />
            <circle cx="0" cy="2.8" r="1" fill="white" />
          </g>
        )}
      </svg>
    </div>
  );
}
