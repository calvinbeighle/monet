/**
 * components/agent-avatars/EmailAvatar.tsx
 * Animated SVG avatar for the Email agent.
 *
 * States:
 *   running        - envelope flap opens/closes, small particles float out
 *   needs-attention / has decisions - envelope pulses violet, notification dot bounces
 *   idle           - static envelope, muted zinc colors
 *   error          - envelope turns red with subtle shake
 *
 * Uses pure CSS keyframe animations injected via a <style> tag - no external deps.
 * Size: 48x48px container.
 */

import type { Agent } from '@/types';

interface EmailAvatarProps {
  /** Current agent status */
  status: Agent['status'];
  /** Whether the agent has pending decisions (triggers attention state) */
  hasDecisions?: boolean;
}

/** Unique id prefix to avoid keyframe collisions when multiple avatars exist */
const ID = 'email-avatar';

/**
 * Animated envelope/mail icon that reflects the email agent's current state.
 * The flap is a separate SVG path so it can be animated independently.
 */
export function EmailAvatar({ status, hasDecisions = false }: EmailAvatarProps) {
  const isRunning = status === 'running';
  const isError = status === 'error';
  const isAttention = hasDecisions;

  /* Body and flap colors per state */
  const bodyColor = isError ? '#ef4444' : isRunning || isAttention ? '#8b5cf6' : '#52525b';
  const lineColor = isError ? '#fca5a5' : isRunning || isAttention ? '#c4b5fd' : '#71717a';
  const dotColor = '#8b5cf6';

  return (
    <div
      style={{ width: 48, height: 48, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      aria-label="Email agent avatar"
    >
      <style>{`
        @keyframes ${ID}-flap {
          0%, 100% { transform-origin: top center; transform: rotateX(0deg); }
          40%       { transform-origin: top center; transform: rotateX(-28deg); }
          60%       { transform-origin: top center; transform: rotateX(-20deg); }
        }
        @keyframes ${ID}-pulse {
          0%, 100% { opacity: 1; filter: drop-shadow(0 0 0px #8b5cf6); }
          50%       { opacity: 0.85; filter: drop-shadow(0 0 6px #8b5cf6); }
        }
        @keyframes ${ID}-shake {
          0%, 100% { transform: translateX(0); }
          20%       { transform: translateX(-2px); }
          40%       { transform: translateX(2px); }
          60%       { transform: translateX(-2px); }
          80%       { transform: translateX(1px); }
        }
        @keyframes ${ID}-dot-bounce {
          0%, 100% { transform: translateY(0) scale(1); }
          45%       { transform: translateY(-3px) scale(1.15); }
        }
        @keyframes ${ID}-particle-1 {
          0%   { opacity: 0; transform: translate(0, 0) scale(0.6); }
          20%  { opacity: 1; }
          100% { opacity: 0; transform: translate(-8px, -12px) scale(0.3); }
        }
        @keyframes ${ID}-particle-2 {
          0%   { opacity: 0; transform: translate(0, 0) scale(0.6); }
          20%  { opacity: 1; }
          100% { opacity: 0; transform: translate(6px, -14px) scale(0.3); }
        }
        @keyframes ${ID}-particle-3 {
          0%   { opacity: 0; transform: translate(0, 0) scale(0.6); }
          30%  { opacity: 1; }
          100% { opacity: 0; transform: translate(10px, -10px) scale(0.3); }
        }
        @keyframes ${ID}-idle-breathe {
          0%, 100% { opacity: 0.55; }
          50%       { opacity: 0.7; }
        }

        .${ID}-body {
          animation: ${isError ? `${ID}-shake 0.55s ease-in-out infinite` : isRunning ? 'none' : isAttention ? `${ID}-pulse 2s ease-in-out infinite` : `${ID}-idle-breathe 3.5s ease-in-out infinite`};
        }
        .${ID}-flap {
          transform-box: fill-box;
          animation: ${isRunning ? `${ID}-flap 1.8s ease-in-out infinite` : 'none'};
        }
        .${ID}-dot {
          animation: ${isAttention ? `${ID}-dot-bounce 1.1s ease-in-out infinite` : 'none'};
          transform-box: fill-box;
          transform-origin: center;
        }
        .${ID}-p1 {
          animation: ${isRunning ? `${ID}-particle-1 1.6s ease-out infinite` : 'none'};
          animation-delay: 0.1s;
        }
        .${ID}-p2 {
          animation: ${isRunning ? `${ID}-particle-2 1.6s ease-out infinite` : 'none'};
          animation-delay: 0.5s;
        }
        .${ID}-p3 {
          animation: ${isRunning ? `${ID}-particle-3 1.6s ease-out infinite` : 'none'};
          animation-delay: 0.85s;
        }
      `}</style>

      <svg
        width="48"
        height="48"
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`${ID}-body`}
      >
        {/* Envelope body */}
        <rect
          x="6" y="16" width="36" height="24"
          rx="3"
          fill={bodyColor}
          opacity="0.18"
          stroke={bodyColor}
          strokeWidth="1.5"
        />

        {/* V-fold lines (closed envelope bottom half) */}
        <path
          d="M6 28 L24 36 L42 28"
          stroke={lineColor}
          strokeWidth="1.2"
          fill="none"
          opacity="0.55"
        />

        {/* Envelope flap (top triangle) - animated open/close when running */}
        <path
          d="M6 16 L24 28 L42 16"
          stroke={bodyColor}
          strokeWidth="1.5"
          fill="none"
          className={`${ID}-flap`}
        />

        {/* Particles - only rendered when running, animated via CSS */}
        {isRunning && (
          <>
            <circle className={`${ID}-p1`} cx="22" cy="20" r="1.8" fill={lineColor} opacity="0" />
            <circle className={`${ID}-p2`} cx="26" cy="18" r="1.4" fill={lineColor} opacity="0" />
            <circle className={`${ID}-p3`} cx="30" cy="21" r="1.6" fill={lineColor} opacity="0" />
          </>
        )}

        {/* Notification dot - visible when has decisions */}
        {isAttention && (
          <circle
            className={`${ID}-dot`}
            cx="36" cy="13" r="5"
            fill={dotColor}
          />
        )}

        {/* Error X mark */}
        {isError && (
          <>
            <line x1="18" y1="22" x2="30" y2="34" stroke="#fca5a5" strokeWidth="1.8" strokeLinecap="round" />
            <line x1="30" y1="22" x2="18" y2="34" stroke="#fca5a5" strokeWidth="1.8" strokeLinecap="round" />
          </>
        )}
      </svg>
    </div>
  );
}
