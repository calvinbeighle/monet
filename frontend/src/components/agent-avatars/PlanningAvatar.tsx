/**
 * components/agent-avatars/PlanningAvatar.tsx
 * Animated SVG avatar for the Planning agent.
 *
 * States:
 *   running        - lightbulb glows/pulses, three sparkle particles orbit around it
 *   needs-attention / has decisions - bright glow with animated rays
 *   idle           - dim bulb, very slow breathe
 *   error          - bulb goes dark with red tint overlay
 *
 * Uses pure CSS keyframe animations - no external deps.
 * Size: 48x48px container.
 */

import type { Agent } from '@/types';

interface PlanningAvatarProps {
  status: Agent['status'];
  hasDecisions?: boolean;
}

const ID = 'plan-avatar';

/**
 * Animated lightbulb icon for the planning agent.
 * Sparkles orbit when running; rays extend when attention is needed.
 */
export function PlanningAvatar({ status, hasDecisions = false }: PlanningAvatarProps) {
  const isRunning = status === 'running';
  const isError = status === 'error';
  const isAttention = hasDecisions;

  const bulbFill = isError ? '#27272a' : isRunning ? '#8b5cf630' : isAttention ? '#8b5cf625' : '#1c1c1e';
  const bulbStroke = isError ? '#ef4444' : isRunning || isAttention ? '#8b5cf6' : '#52525b';
  const glowColor = isRunning ? '#c4b5fd' : isAttention ? '#a78bfa' : '#71717a';

  return (
    <div
      style={{ width: 48, height: 48, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      aria-label="Planning agent avatar"
    >
      <style>{`
        @keyframes ${ID}-glow-pulse {
          0%, 100% { filter: drop-shadow(0 0 2px #8b5cf6); }
          50%       { filter: drop-shadow(0 0 9px #8b5cf6) drop-shadow(0 0 18px #7c3aed40); }
        }
        @keyframes ${ID}-attention-glow {
          0%, 100% { filter: drop-shadow(0 0 4px #8b5cf6); }
          50%       { filter: drop-shadow(0 0 12px #8b5cf6) drop-shadow(0 0 22px #8b5cf650); }
        }
        @keyframes ${ID}-sparkle-orbit-1 {
          0%   { transform: rotate(0deg) translateX(14px) rotate(0deg); opacity: 0; }
          15%  { opacity: 1; }
          85%  { opacity: 1; }
          100% { transform: rotate(360deg) translateX(14px) rotate(-360deg); opacity: 0; }
        }
        @keyframes ${ID}-sparkle-orbit-2 {
          0%   { transform: rotate(120deg) translateX(14px) rotate(-120deg); opacity: 0; }
          15%  { opacity: 1; }
          85%  { opacity: 1; }
          100% { transform: rotate(480deg) translateX(14px) rotate(-480deg); opacity: 0; }
        }
        @keyframes ${ID}-sparkle-orbit-3 {
          0%   { transform: rotate(240deg) translateX(14px) rotate(-240deg); opacity: 0; }
          15%  { opacity: 1; }
          85%  { opacity: 1; }
          100% { transform: rotate(600deg) translateX(14px) rotate(-600deg); opacity: 0; }
        }
        @keyframes ${ID}-ray-pulse {
          0%, 100% { opacity: 0.3; transform: scaleY(1); }
          50%       { opacity: 0.8; transform: scaleY(1.2); }
        }
        @keyframes ${ID}-idle-breathe {
          0%, 100% { opacity: 0.5; }
          50%       { opacity: 0.68; }
        }
        @keyframes ${ID}-error-dim {
          0%, 100% { opacity: 0.7; }
          50%       { opacity: 0.5; }
        }

        .${ID}-bulb {
          animation: ${
            isError ? `${ID}-error-dim 1.2s ease-in-out infinite` :
            isRunning ? `${ID}-glow-pulse 1.8s ease-in-out infinite` :
            isAttention ? `${ID}-attention-glow 2s ease-in-out infinite` :
            `${ID}-idle-breathe 4s ease-in-out infinite`
          };
        }
        .${ID}-sp1 {
          animation: ${isRunning ? `${ID}-sparkle-orbit-1 2.2s linear infinite` : 'none'};
          transform-origin: 24px 24px;
          transform-box: fill-box;
        }
        .${ID}-sp2 {
          animation: ${isRunning ? `${ID}-sparkle-orbit-2 2.2s linear infinite` : 'none'};
          transform-origin: 24px 24px;
          transform-box: fill-box;
          animation-delay: 0.1s;
        }
        .${ID}-sp3 {
          animation: ${isRunning ? `${ID}-sparkle-orbit-3 2.2s linear infinite` : 'none'};
          transform-origin: 24px 24px;
          transform-box: fill-box;
          animation-delay: 0.2s;
        }
        .${ID}-ray {
          transform-origin: center bottom;
          transform-box: fill-box;
          animation: ${isAttention ? `${ID}-ray-pulse 1.5s ease-in-out infinite` : 'none'};
        }
      `}</style>

      <svg
        width="48"
        height="48"
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`${ID}-bulb`}
      >
        {/* Attention rays - visible when hasDecisions */}
        {isAttention && (
          <>
            <line className={`${ID}-ray`} x1="24" y1="4" x2="24" y2="8" stroke={glowColor} strokeWidth="1.5" strokeLinecap="round" style={{ animationDelay: '0s' }} />
            <line className={`${ID}-ray`} x1="11" y1="8" x2="14" y2="11" stroke={glowColor} strokeWidth="1.5" strokeLinecap="round" style={{ animationDelay: '0.15s' }} />
            <line className={`${ID}-ray`} x1="37" y1="8" x2="34" y2="11" stroke={glowColor} strokeWidth="1.5" strokeLinecap="round" style={{ animationDelay: '0.3s' }} />
            <line className={`${ID}-ray`} x1="5" y1="22" x2="9" y2="22" stroke={glowColor} strokeWidth="1.5" strokeLinecap="round" style={{ animationDelay: '0.45s' }} />
            <line className={`${ID}-ray`} x1="43" y1="22" x2="39" y2="22" stroke={glowColor} strokeWidth="1.5" strokeLinecap="round" style={{ animationDelay: '0.6s' }} />
          </>
        )}

        {/* Bulb glass */}
        <path
          d="M24 9C18.477 9 14 13.477 14 19c0 3.6 1.84 6.76 4.64 8.66V30a1 1 0 001 1h8.72a1 1 0 001-1v-2.34C32.16 25.76 34 22.6 34 19c0-5.523-4.477-10-10-10z"
          fill={bulbFill}
          stroke={bulbStroke}
          strokeWidth="1.4"
        />

        {/* Bulb base / screw lines */}
        <rect x="19.5" y="31" width="9" height="2.2" rx="0.8" fill={bulbStroke} opacity="0.7" />
        <rect x="20.5" y="34" width="7" height="2" rx="0.8" fill={bulbStroke} opacity="0.5" />
        <rect x="21.5" y="36.5" width="5" height="1.8" rx="0.8" fill={bulbStroke} opacity="0.35" />

        {/* Inner glow filament */}
        {(isRunning || isAttention) && (
          <path
            d="M22 24 Q24 19 26 24"
            stroke={glowColor}
            strokeWidth="1.2"
            fill="none"
            opacity="0.8"
          />
        )}

        {/* Orbiting sparkle particles - running only */}
        {isRunning && (
          <>
            <circle className={`${ID}-sp1`} cx="24" cy="10" r="1.5" fill="#c4b5fd" opacity="0" />
            <circle className={`${ID}-sp2`} cx="24" cy="10" r="1.2" fill="#a78bfa" opacity="0" />
            <circle className={`${ID}-sp3`} cx="24" cy="10" r="1.8" fill="#ddd6fe" opacity="0" />
          </>
        )}

        {/* Error overlay */}
        {isError && (
          <>
            <line x1="18" y1="16" x2="30" y2="28" stroke="#ef4444" strokeWidth="1.8" strokeLinecap="round" opacity="0.8" />
            <line x1="30" y1="16" x2="18" y2="28" stroke="#ef4444" strokeWidth="1.8" strokeLinecap="round" opacity="0.8" />
          </>
        )}

        {/* Notification dot */}
        {isAttention && (
          <circle cx="37" cy="11" r="5" fill="#8b5cf6" />
        )}
      </svg>
    </div>
  );
}
