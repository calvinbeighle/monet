/**
 * components/agent-avatars/PlanningAvatar.tsx
 * "Nova" - the creative thinker character for the Planning agent.
 *
 * A warm, rounded face with orbiting stars and dreamy expressions:
 *   running     - stars orbit around the head, eyes sparkle, gentle float
 *   hasDecisions - lightbulb appears above head, eyes wide and bright
 *   idle        - dreamy half-closed eyes, slow float animation
 *   error       - tiny cloud/rain above head, sad expression
 *
 * Uses pure CSS keyframe animations - no external dependencies.
 * Renders at 48x48px container.
 */

import type { Agent } from '@/types';

interface PlanningAvatarProps {
  /** Current agent status */
  status: Agent['status'];
  /** Whether the agent has pending decisions requiring attention */
  hasDecisions?: boolean;
}

const ID = 'nova';

/**
 * Nova - an amber/gold-toned rounded face for the Planning agent.
 * Warm, creative, imaginative - stars orbit when thinking.
 */
export function PlanningAvatar({ status, hasDecisions = false }: PlanningAvatarProps) {
  const isRunning = status === 'running';
  const isError = status === 'error';
  const isAttention = hasDecisions;
  const isIdle = !isRunning && !isError && !isAttention;

  /* Color palette - amber/gold tones */
  const primary = isError ? '#ef4444' : '#f59e0b';
  const faceStroke = isError ? '#ef4444' : isRunning ? '#fbbf24' : isAttention ? '#fcd34d' : '#d97706';
  const faceFill = isError ? 'rgba(239,68,68,0.1)' : isRunning ? 'rgba(245,158,11,0.18)' : isAttention ? 'rgba(245,158,11,0.22)' : 'rgba(245,158,11,0.10)';
  const eyeColor = isError ? '#fca5a5' : isRunning ? '#fef3c7' : isAttention ? '#ffffff' : '#fde68a';

  return (
    <div
      style={{ width: 48, height: 48, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      aria-label="Nova - Planning agent"
    >
      <style>{`
        /* Idle dreamy float */
        @keyframes ${ID}-float {
          0%, 100% { transform: translateY(0); opacity: 0.88; }
          50%       { transform: translateY(-1.5px); opacity: 1; }
        }
        /* Running active sparkle float */
        @keyframes ${ID}-sparkle-float {
          0%, 100% { transform: translateY(0) scale(1); }
          33%       { transform: translateY(-2px) scale(1.01); }
          66%       { transform: translateY(-1px) scale(1.005); }
        }
        /* Star orbit - 3 stars rotating around head */
        @keyframes ${ID}-orbit-1 {
          0%   { transform: rotate(0deg) translateX(18px); opacity: 0; }
          10%  { opacity: 1; }
          90%  { opacity: 1; }
          100% { transform: rotate(360deg) translateX(18px); opacity: 0; }
        }
        @keyframes ${ID}-orbit-2 {
          0%   { transform: rotate(120deg) translateX(18px); opacity: 0; }
          10%  { opacity: 1; }
          90%  { opacity: 1; }
          100% { transform: rotate(480deg) translateX(18px); opacity: 0; }
        }
        @keyframes ${ID}-orbit-3 {
          0%   { transform: rotate(240deg) translateX(18px); opacity: 0; }
          10%  { opacity: 1; }
          90%  { opacity: 1; }
          100% { transform: rotate(600deg) translateX(18px); opacity: 0; }
        }
        /* Eye sparkle when running */
        @keyframes ${ID}-eye-sparkle {
          0%, 100% { transform: scale(1); opacity: 0.95; }
          50%       { transform: scale(1.15); opacity: 1; }
        }
        /* Idle dreamy eyes - heavy blink with half-close */
        @keyframes ${ID}-dreamy-blink {
          0%, 75%, 100%  { transform: scaleY(1); }
          80%             { transform: scaleY(0.35); }
          95%             { transform: scaleY(0.7); }
        }
        /* Attention: eyes widen excitedly */
        @keyframes ${ID}-eye-wide {
          0%, 100% { transform: scale(1); }
          50%       { transform: scale(1.25); }
        }
        /* Lightbulb flash when attention */
        @keyframes ${ID}-bulb-flash {
          0%, 100% { opacity: 1; filter: drop-shadow(0 0 3px #fbbf24); }
          50%       { opacity: 0.75; filter: drop-shadow(0 0 10px #fbbf24) drop-shadow(0 0 18px #f59e0b60); }
        }
        /* Attention warm glow */
        @keyframes ${ID}-warm-glow {
          0%, 100% { filter: drop-shadow(0 0 2px #f59e0b); }
          50%       { filter: drop-shadow(0 0 9px #f59e0b) drop-shadow(0 0 18px #d97706_50); }
        }
        /* Error rain drop fall */
        @keyframes ${ID}-rain-drop {
          0%   { transform: translateY(-2px); opacity: 0; }
          20%  { opacity: 0.8; }
          100% { transform: translateY(8px); opacity: 0; }
        }
        /* Cloud sad sway */
        @keyframes ${ID}-cloud-sway {
          0%, 100% { transform: translateX(0); }
          50%       { transform: translateX(-1.5px); }
        }
        /* Cheek blush */
        @keyframes ${ID}-blush {
          0%, 100% { opacity: 0.2; }
          50%       { opacity: 0.35; }
        }

        .${ID}-face {
          animation: ${
            isError     ? 'none' :
            isRunning   ? `${ID}-sparkle-float 2s ease-in-out infinite` :
            isAttention ? `${ID}-warm-glow 2s ease-in-out infinite` :
            `${ID}-float 4s ease-in-out infinite`
          };
        }
        .${ID}-star-1 {
          transform-origin: 24px 24px;
          transform-box: view-box;
          animation: ${isRunning ? `${ID}-orbit-1 2.8s linear infinite` : 'none'};
        }
        .${ID}-star-2 {
          transform-origin: 24px 24px;
          transform-box: view-box;
          animation: ${isRunning ? `${ID}-orbit-2 2.8s linear infinite` : 'none'};
          animation-delay: 0.1s;
        }
        .${ID}-star-3 {
          transform-origin: 24px 24px;
          transform-box: view-box;
          animation: ${isRunning ? `${ID}-orbit-3 2.8s linear infinite` : 'none'};
          animation-delay: 0.2s;
        }
        .${ID}-eye-left {
          transform-box: fill-box;
          transform-origin: center;
          animation: ${
            isError     ? 'none' :
            isRunning   ? `${ID}-eye-sparkle 1.4s ease-in-out infinite` :
            isAttention ? `${ID}-eye-wide 1.8s ease-in-out infinite` :
            `${ID}-dreamy-blink 5s ease-in-out infinite`
          };
        }
        .${ID}-eye-right {
          transform-box: fill-box;
          transform-origin: center;
          animation: ${
            isError     ? 'none' :
            isRunning   ? `${ID}-eye-sparkle 1.4s ease-in-out infinite` :
            isAttention ? `${ID}-eye-wide 1.8s ease-in-out infinite` :
            `${ID}-dreamy-blink 5s ease-in-out infinite`
          };
          animation-delay: ${isRunning ? '0.12s' : '0.1s'};
        }
        .${ID}-bulb {
          animation: ${isAttention ? `${ID}-bulb-flash 1.5s ease-in-out infinite` : 'none'};
          transform-box: fill-box;
          transform-origin: center;
        }
        .${ID}-cloud {
          animation: ${isError ? `${ID}-cloud-sway 2.5s ease-in-out infinite` : 'none'};
        }
        .${ID}-rain-1 {
          animation: ${isError ? `${ID}-rain-drop 1.4s ease-in infinite` : 'none'};
          animation-delay: 0s;
        }
        .${ID}-rain-2 {
          animation: ${isError ? `${ID}-rain-drop 1.4s ease-in infinite` : 'none'};
          animation-delay: 0.45s;
        }
        .${ID}-rain-3 {
          animation: ${isError ? `${ID}-rain-drop 1.4s ease-in infinite` : 'none'};
          animation-delay: 0.9s;
        }
        .${ID}-blush {
          animation: ${!isError ? `${ID}-blush 3s ease-in-out infinite` : 'none'};
        }
      `}</style>

      <svg
        width="48"
        height="48"
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* --- ORBITING STARS (running only) --- */}
        {isRunning && (
          <>
            {/* Star shape 1 */}
            <g className={`${ID}-star-1`}>
              <polygon
                points="24,6 24.7,8.4 27.2,8.4 25.3,9.8 26,12.2 24,10.8 22,12.2 22.7,9.8 20.8,8.4 23.3,8.4"
                fill="#fbbf24"
                opacity="0"
              />
            </g>
            {/* Star shape 2 */}
            <g className={`${ID}-star-2`}>
              <polygon
                points="24,6 24.6,7.9 26.6,7.9 25,9 25.6,11 24,9.9 22.4,11 23,9 21.4,7.9 23.4,7.9"
                fill="#fcd34d"
                opacity="0"
              />
            </g>
            {/* Star shape 3 */}
            <g className={`${ID}-star-3`}>
              <polygon
                points="24,6 24.5,7.5 26,7.5 24.8,8.5 25.3,10 24,9.2 22.7,10 23.2,8.5 22,7.5 23.5,7.5"
                fill="#fef3c7"
                opacity="0"
              />
            </g>
          </>
        )}

        {/* --- FACE --- big rounded circle */}
        <g className={`${ID}-face`}>
          <circle
            cx="24" cy="27"
            r="16"
            fill={faceFill}
            stroke={faceStroke}
            strokeWidth="1.6"
          />

          {/* Fluffy ear-cheek bumps */}
          <circle cx="9" cy="27" r="4.5" fill={faceFill} stroke={faceStroke} strokeWidth="1.2" opacity="0.7" />
          <circle cx="39" cy="27" r="4.5" fill={faceFill} stroke={faceStroke} strokeWidth="1.2" opacity="0.7" />

          {/* --- EYES --- */}
          {isError ? (
            /* Sad drooping eyes - UU shape */
            <>
              <path
                d="M15 23 Q18 27 21 23"
                stroke={eyeColor}
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
              />
              <path
                d="M27 23 Q30 27 33 23"
                stroke={eyeColor}
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
              />
            </>
          ) : isIdle ? (
            /* Dreamy half-moon eyes */
            <>
              <g className={`${ID}-eye-left`}>
                <ellipse cx="18.5" cy="24.5" rx="4" ry="3.5" fill={eyeColor} opacity="0.9" />
                <ellipse cx="18.5" cy="26" rx="4" ry="2" fill={faceFill} />
                <circle cx="18.5" cy="24.5" r="1.4" fill={primary} opacity="0.7" />
                <circle cx="19.8" cy="23.3" r="0.7" fill="rgba(255,255,255,0.8)" />
              </g>
              <g className={`${ID}-eye-right`}>
                <ellipse cx="29.5" cy="24.5" rx="4" ry="3.5" fill={eyeColor} opacity="0.9" />
                <ellipse cx="29.5" cy="26" rx="4" ry="2" fill={faceFill} />
                <circle cx="29.5" cy="24.5" r="1.4" fill={primary} opacity="0.7" />
                <circle cx="30.8" cy="23.3" r="0.7" fill="rgba(255,255,255,0.8)" />
              </g>
            </>
          ) : (
            /* Open bright eyes - running & attention */
            <>
              <ellipse
                className={`${ID}-eye-left`}
                cx="18.5" cy="24"
                rx={isAttention ? 4.5 : 3.8}
                ry={isAttention ? 5 : 4.2}
                fill={eyeColor}
                opacity="0.95"
              />
              <circle cx="18.5" cy="24.5" r="2" fill={primary} />
              <circle cx="19.8" cy="23" r="0.9" fill="rgba(255,255,255,0.85)" />
              {isRunning && <circle cx="17.5" cy="25" r="0.5" fill="rgba(255,255,255,0.5)" />}

              <ellipse
                className={`${ID}-eye-right`}
                cx="29.5" cy="24"
                rx={isAttention ? 4.5 : 3.8}
                ry={isAttention ? 5 : 4.2}
                fill={eyeColor}
                opacity="0.95"
              />
              <circle cx="29.5" cy="24.5" r="2" fill={primary} />
              <circle cx="30.8" cy="23" r="0.9" fill="rgba(255,255,255,0.85)" />
              {isRunning && <circle cx="28.5" cy="25" r="0.5" fill="rgba(255,255,255,0.5)" />}
            </>
          )}

          {/* --- MOUTH --- */}
          {isError ? (
            /* Sad trembling frown */
            <path
              d="M18 34 Q24 31 30 34"
              stroke="#fca5a5"
              strokeWidth="1.7"
              fill="none"
              strokeLinecap="round"
            />
          ) : isRunning ? (
            /* Open excited smile */
            <path
              d="M17 32.5 Q24 38 31 32.5"
              stroke={faceStroke}
              strokeWidth="1.6"
              fill="rgba(245,158,11,0.15)"
              strokeLinecap="round"
            />
          ) : isAttention ? (
            /* Big happy smile */
            <path
              d="M16 32 Q24 39 32 32"
              stroke={faceStroke}
              strokeWidth="1.8"
              fill="rgba(245,158,11,0.18)"
              strokeLinecap="round"
            />
          ) : (
            /* Soft dreamy smile */
            <path
              d="M18 32.5 Q24 36 30 32.5"
              stroke={faceStroke}
              strokeWidth="1.5"
              fill="none"
              strokeLinecap="round"
            />
          )}

          {/* Blush marks */}
          <ellipse className={`${ID}-blush`} cx="12.5" cy="29.5" rx="3" ry="1.5" fill={primary} />
          <ellipse className={`${ID}-blush`} cx="35.5" cy="29.5" rx="3" ry="1.5" fill={primary} />

          {/* Star freckles */}
          {!isError && (
            <>
              <circle cx="22" cy="31.5" r="0.7" fill={faceStroke} opacity="0.4" />
              <circle cx="26" cy="31.5" r="0.7" fill={faceStroke} opacity="0.4" />
              <circle cx="24" cy="32.8" r="0.5" fill={faceStroke} opacity="0.3" />
            </>
          )}
        </g>

        {/* --- LIGHTBULB (attention only) --- above head */}
        {isAttention && (
          <g className={`${ID}-bulb`} transform="translate(24, 6)">
            {/* Bulb glow */}
            <circle cx="0" cy="-1" r="7" fill="rgba(251,191,36,0.2)" />
            {/* Bulb glass */}
            <path
              d="M-4 -1 Q-4 -6 0 -6 Q4 -6 4 -1 Q4 1.5 2 3 L2 4 L-2 4 L-2 3 Q-4 1.5 -4 -1 Z"
              fill="rgba(253,230,138,0.6)"
              stroke="#fbbf24"
              strokeWidth="1.2"
            />
            {/* Filament */}
            <path d="M-1.5 1 Q0 -1.5 1.5 1" stroke="#fbbf24" strokeWidth="1" fill="none" />
            {/* Base */}
            <rect x="-2" y="4" width="4" height="1.5" rx="0.5" fill="#fbbf24" opacity="0.7" />
            <rect x="-1.5" y="5.8" width="3" height="1.2" rx="0.5" fill="#fbbf24" opacity="0.5" />
            {/* Sparkle rays */}
            <line x1="0" y1="-7.5" x2="0" y2="-9" stroke="#fbbf24" strokeWidth="1.2" strokeLinecap="round" opacity="0.7" />
            <line x1="5.5" y1="-5" x2="6.8" y2="-6" stroke="#fbbf24" strokeWidth="1.2" strokeLinecap="round" opacity="0.6" />
            <line x1="-5.5" y1="-5" x2="-6.8" y2="-6" stroke="#fbbf24" strokeWidth="1.2" strokeLinecap="round" opacity="0.6" />
          </g>
        )}

        {/* --- RAIN CLOUD (error only) --- above head */}
        {isError && (
          <g className={`${ID}-cloud`} transform="translate(24, 8)">
            {/* Cloud */}
            <ellipse cx="0" cy="0" rx="8" ry="4" fill="#374151" stroke="#6b7280" strokeWidth="1" />
            <circle cx="-4" cy="-1.5" r="3" fill="#374151" stroke="#6b7280" strokeWidth="1" />
            <circle cx="0" cy="-2.5" r="3.5" fill="#374151" stroke="#6b7280" strokeWidth="1" />
            <circle cx="4" cy="-1.5" r="2.8" fill="#374151" stroke="#6b7280" strokeWidth="1" />
            {/* Rain drops */}
            <line className={`${ID}-rain-1`} x1="-3" y1="4" x2="-3" y2="7" stroke="#60a5fa" strokeWidth="1.4" strokeLinecap="round" opacity="0" />
            <line className={`${ID}-rain-2`} x1="0" y1="4" x2="0" y2="7.5" stroke="#60a5fa" strokeWidth="1.4" strokeLinecap="round" opacity="0" />
            <line className={`${ID}-rain-3`} x1="3" y1="4" x2="3" y2="7" stroke="#60a5fa" strokeWidth="1.4" strokeLinecap="round" opacity="0" />
          </g>
        )}
      </svg>
    </div>
  );
}
