/**
 * SpriteCharacter — stationary agent card with sprite avatar and live status.
 *
 * Design philosophy:
 * - Agents stay in place — no wandering, no complex animation loops
 * - The sprite is a visual identifier / avatar, not a game character
 * - Status and activity are shown cleanly below the sprite
 * - Running agents get a subtle breathing animation for life
 * - Click to open the chat panel
 */
import { useState, useRef, useEffect } from 'react';
import { SPRITE_CONFIG, SPRITE_ANIMATIONS } from '../constants';

interface CharacterVisual {
  name: string;
  accentColor: string;
  spriteSheet: string;
}

interface SpriteCharacterProps {
  agentId: string;
  config: CharacterVisual;
  status: string;
  decisionCount: number;
  mood: string;
  insightLabel?: string;
  currentDetail?: string;
  toolCallCount?: number;
  elapsedSeconds?: number;
  onClick: () => void;
  isSelected?: boolean;
}

const { frameWidth, frameHeight, scale, animSpeed } = SPRITE_CONFIG;
const renderW = frameWidth * scale;
const renderH = frameHeight * scale;

function formatElapsed(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

export function SpriteCharacter({
  agentId,
  config,
  status,
  decisionCount,
  mood,
  insightLabel,
  currentDetail,
  toolCallCount,
  elapsedSeconds,
  onClick,
  isSelected,
}: SpriteCharacterProps) {
  const [hovered, setHovered] = useState(false);
  const frameRef = useRef(0);
  const spriteRef = useRef<HTMLDivElement>(null);

  const isRunning = status === 'running';
  const isError = status === 'error';
  const hasDecisions = decisionCount > 0;
  const isIdle = !isRunning && !isError && !hasDecisions;

  // Idle-down animation frame cycling for running agents (gives them life)
  useEffect(() => {
    if (!isRunning) {
      frameRef.current = 0;
      return;
    }
    const isPlayerSheet = config.spriteSheet === '/sprites/characters/player.png';
    const maxFrames = isPlayerSheet ? 4 : 6;
    const interval = setInterval(() => {
      frameRef.current = (frameRef.current + 1) % maxFrames;
      if (spriteRef.current) {
        const anim = SPRITE_ANIMATIONS['idle-down'];
        const cols = isPlayerSheet ? 4 : 6;
        spriteRef.current.style.backgroundPosition =
          `${-(frameRef.current * frameWidth * scale)}px ${-(anim.row * frameHeight * scale)}px`;
        spriteRef.current.style.backgroundSize =
          `${cols * frameWidth * scale}px ${6 * frameHeight * scale}px`;
      }
    }, animSpeed * 2);
    return () => clearInterval(interval);
  }, [isRunning, config.spriteSheet]);

  // Set initial sprite frame
  useEffect(() => {
    if (spriteRef.current) {
      const anim = SPRITE_ANIMATIONS['idle-down'];
      const isPlayerSheet = config.spriteSheet === '/sprites/characters/player.png';
      const cols = isPlayerSheet ? 4 : 6;
      spriteRef.current.style.backgroundPosition =
        `0px ${-(anim.row * frameHeight * scale)}px`;
      spriteRef.current.style.backgroundSize =
        `${cols * frameWidth * scale}px ${6 * frameHeight * scale}px`;
    }
  }, [config.spriteSheet]);

  const name = config?.name ?? agentId;
  const dotColor = isRunning ? '#3b82f6' : isError ? '#ef4444' : hasDecisions ? '#f59e0b' : '#4ade80';

  // Activity text
  let activityText = '';
  if (isRunning) {
    if (mood?.includes('Thinking')) {
      activityText = 'Thinking...';
    } else if (mood?.includes('Responding')) {
      activityText = 'Writing response...';
    } else if (mood?.includes('Reading')) {
      activityText = currentDetail ? `Reading ${currentDetail.split('/').pop()}` : 'Reading file...';
    } else if (mood?.includes('Editing') || mood?.includes('Writing')) {
      activityText = currentDetail ? `Editing ${currentDetail.split('/').pop()}` : 'Editing code...';
    } else if (mood?.includes('Running')) {
      activityText = currentDetail ? `$ ${currentDetail.slice(0, 30)}` : 'Running command...';
    } else if (mood?.includes('Searching')) {
      activityText = currentDetail ? `Searching "${currentDetail.slice(0, 20)}"` : 'Searching code...';
    } else if (mood) {
      activityText = mood;
    } else {
      activityText = 'Working...';
    }
  } else if (hasDecisions) {
    activityText = 'Needs your input';
  } else if (isError) {
    activityText = 'Error';
  } else if (insightLabel) {
    activityText = insightLabel;
  }

  return (
    <div
      data-clickable
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        cursor: 'pointer',
        gap: 0,
        transition: 'transform 0.2s ease',
        transform: hovered ? 'translateY(-4px)' : 'none',
      }}
    >
      {/* Sprite container with glow ring */}
      <div style={{
        position: 'relative',
        width: renderW + 16,
        height: renderW + 16,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '50%',
        background: isSelected
          ? `${config.accentColor}18`
          : hovered
            ? 'rgba(255,255,255,0.04)'
            : 'transparent',
        border: isSelected
          ? `2px solid ${config.accentColor}60`
          : '2px solid transparent',
        transition: 'all 0.2s ease',
      }}>
        {/* Running pulse ring */}
        {isRunning && (
          <div style={{
            position: 'absolute',
            inset: -4,
            borderRadius: '50%',
            border: `2px solid ${config.accentColor}30`,
            animation: 'pulse-ring 2s ease-in-out infinite',
          }} />
        )}

        {/* The sprite itself */}
        <div
          ref={spriteRef}
          style={{
            width: renderW,
            height: renderH,
            backgroundImage: `url(${config?.spriteSheet})`,
            backgroundRepeat: 'no-repeat',
            imageRendering: 'pixelated',
            transform: 'scale(1.1)',
            transformOrigin: 'center bottom',
          }}
        />
      </div>

      {/* Name + status dot */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        marginTop: 6,
        padding: '3px 10px',
        borderRadius: 8,
        background: 'rgba(15, 23, 42, 0.85)',
        backdropFilter: 'blur(8px)',
        border: isSelected ? `1px solid ${config.accentColor}40` : '1px solid rgba(255,255,255,0.06)',
      }}>
        <div style={{
          width: 6, height: 6, borderRadius: '50%',
          background: dotColor,
          boxShadow: isRunning || hasDecisions ? `0 0 6px ${dotColor}` : 'none',
          animation: isRunning ? 'pulse-dot 1.5s ease-in-out infinite' : 'none',
          flexShrink: 0,
        }} />
        <span style={{
          color: '#e2e8f0',
          fontSize: 11,
          fontWeight: 600,
          fontFamily: "'Inter', system-ui, sans-serif",
          letterSpacing: '0.01em',
        }}>{name}</span>
      </div>

      {/* Activity / status line */}
      {activityText && (
        <div style={{
          marginTop: 3,
          padding: '2px 8px',
          borderRadius: 6,
          background: isRunning
            ? 'rgba(59, 130, 246, 0.08)'
            : hasDecisions
              ? 'rgba(245, 158, 11, 0.08)'
              : 'rgba(255,255,255,0.03)',
          maxWidth: 180,
          textAlign: 'center',
        }}>
          <span style={{
            color: isRunning
              ? 'rgba(147, 197, 253, 0.8)'
              : hasDecisions
                ? 'rgba(245, 158, 11, 0.8)'
                : 'rgba(148, 163, 184, 0.5)',
            fontSize: 9,
            fontWeight: 500,
            fontFamily: "'Inter', system-ui, sans-serif",
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            display: 'block',
          }}>
            {activityText}
          </span>
        </div>
      )}

      {/* Stats: elapsed time + tool calls (only when running) */}
      {isRunning && ((toolCallCount ?? 0) > 0 || (elapsedSeconds ?? 0) > 0) && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginTop: 2,
          fontSize: 9,
          color: 'rgba(148, 163, 184, 0.45)',
          fontFamily: "'JetBrains Mono', 'SF Mono', ui-monospace, monospace",
        }}>
          {(elapsedSeconds ?? 0) > 0 && <span>{formatElapsed(elapsedSeconds ?? 0)}</span>}
          {(toolCallCount ?? 0) > 0 && <span>{toolCallCount} tools</span>}
        </div>
      )}

      {/* Shadow under the sprite */}
      <div style={{
        position: 'absolute',
        bottom: -2,
        width: renderW * 0.4,
        height: 6,
        borderRadius: '50%',
        background: 'rgba(0,0,0,0.15)',
        filter: 'blur(3px)',
        pointerEvents: 'none',
      }} />
    </div>
  );
}
