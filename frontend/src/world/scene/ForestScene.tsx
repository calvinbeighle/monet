/**
 * src/world/scene/ForestScene.tsx
 * 2D forest scene with procedural vegetation and wandering agent sprites.
 * Agents show live status above their heads. No cabin system.
 */

import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useWorldStore } from '../stores/worldStore';
import {
  SCENE_WIDTH, SCENE_HEIGHT,
  buildAgentVisuals, generateVegetation,
} from '../constants';
import { SpriteCharacter } from '../characters/SpriteCharacter';

const S = 3.5;

function Prop({ src, x, y, w, h, zIndex }: {
  src: string; x: number; y: number; w: number; h: number; zIndex?: number;
}) {
  return (
    <img src={src} alt="" draggable={false} style={{
      position: 'absolute', left: x, top: y, width: w, height: h,
      imageRendering: 'pixelated', pointerEvents: 'none',
      zIndex: zIndex ?? Math.round(y + h), userSelect: 'none',
    }} />
  );
}

/**
 * Structured home positions — agents are laid out in a gentle arc across the
 * clearing, well-spaced and easy to scan. Each agent has one "home" they
 * gently patrol around.
 */
function getHomePosition(agentIndex: number, totalAgents: number): { x: number; y: number } {
  const cx = SCENE_WIDTH / 2;
  const cy = SCENE_HEIGHT / 2 + 30;

  if (totalAgents <= 1) return { x: cx, y: cy };

  // Layout in a gentle arc across the clearing
  const maxSpread = Math.min(totalAgents * 200, SCENE_WIDTH * 0.6);
  const startX = cx - maxSpread / 2;
  const spacing = maxSpread / Math.max(1, totalAgents - 1);
  const x = startX + agentIndex * spacing;

  // Gentle vertical wave to avoid a flat line
  const wave = Math.sin((agentIndex / Math.max(1, totalAgents - 1)) * Math.PI) * 40;
  const y = cy - wave;

  return { x, y };
}

export function ForestScene() {
  const agents = useWorldStore(s => s.agents);
  const selectAgent = useWorldStore(s => s.selectAgent);
  const selectedAgentId = useWorldStore(s => s.selectedAgentId);
  const startPolling = useWorldStore(s => s.startPolling);

  useEffect(() => { const stop = startPolling(); return stop; }, [startPolling]);

  const agentIdKey = agents.map(a => a.id).join(',');
  const visuals = useMemo(() => buildAgentVisuals(agents), [agentIdKey]);
  const vegetation = useMemo(() => generateVegetation(42), []);

  // Pan + zoom state
  const [pan, setPan] = useState({ x: -(SCENE_WIDTH - window.innerWidth) / 2, y: -(SCENE_HEIGHT - window.innerHeight) / 2 });
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1); // mirror of zoom state for use inside rAF loop
  const dragRef = useRef({ active: false, moved: false, startX: 0, startY: 0, panX: 0, panY: 0 });

  // Keep zoomRef in sync
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);

  // Track agent positions reported by SpriteCharacter
  const agentPositions = useRef<Record<string, { x: number; y: number }>>({});
  const onAgentMove = useCallback((id: string, pos: { x: number; y: number }) => {
    agentPositions.current[id] = pos;
  }, []);

  // When user manually pans, stop auto-following temporarily
  const userOverrideRef = useRef(false);
  const overrideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Follow selected agent
  const followRef = useRef<number | null>(null);
  useEffect(() => {
    if (followRef.current) cancelAnimationFrame(followRef.current);
    if (overrideTimerRef.current) clearTimeout(overrideTimerRef.current);
    userOverrideRef.current = false;

    if (!selectedAgentId) {
      setZoom(1);
      zoomRef.current = 1;
      setPan({ x: -(SCENE_WIDTH - window.innerWidth) / 2, y: -(SCENE_HEIGHT - window.innerHeight) / 2 });
      return;
    }

    const initialZoom = 2;
    setZoom(initialZoom);
    zoomRef.current = initialZoom;

    const pos = agentPositions.current[selectedAgentId];
    if (pos) {
      const chatOffset = 180;
      setPan({
        x: -(pos.x * initialZoom) + (window.innerWidth - chatOffset) / 2,
        y: -(pos.y * initialZoom) + window.innerHeight / 2,
      });
    }

    const follow = () => {
      if (userOverrideRef.current) {
        followRef.current = requestAnimationFrame(follow);
        return;
      }
      const pos = agentPositions.current[selectedAgentId];
      if (pos) {
        const chatOffset = 180;
        const currentZoom = zoomRef.current;
        const targetX = -(pos.x * currentZoom) + (window.innerWidth - chatOffset) / 2;
        const targetY = -(pos.y * currentZoom) + window.innerHeight / 2;
        setPan(prev => ({
          x: prev.x + (targetX - prev.x) * 0.15,
          y: prev.y + (targetY - prev.y) * 0.15,
        }));
      }
      followRef.current = requestAnimationFrame(follow);
    };
    followRef.current = requestAnimationFrame(follow);

    return () => {
      if (followRef.current) cancelAnimationFrame(followRef.current);
      if (overrideTimerRef.current) clearTimeout(overrideTimerRef.current);
    };
  }, [selectedAgentId]);

  /** Temporarily pause auto-follow, then re-engage after a short idle period. */
  const pauseFollow = useCallback(() => {
    userOverrideRef.current = true;
    if (overrideTimerRef.current) clearTimeout(overrideTimerRef.current);
    // Re-engage auto-follow after 2 seconds of no user interaction (only if an agent is selected)
    if (selectedAgentId) {
      overrideTimerRef.current = setTimeout(() => {
        userOverrideRef.current = false;
      }, 2000);
    }
  }, [selectedAgentId]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('[data-clickable]')) return;
    dragRef.current = { active: true, moved: false, startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
  }, [pan.x, pan.y]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current.active) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      dragRef.current.moved = true;
      pauseFollow();
    }
    if (dragRef.current.moved) {
      setPan({ x: dragRef.current.panX + dx, y: dragRef.current.panY + dy });
    }
  }, [pauseFollow]);

  const onPointerUp = useCallback(() => { dragRef.current.active = false; }, []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    // Pinch-zoom: trackpad sends ctrlKey=true
    // Mouse wheel zoom: no deltaX and no shift key
    const isPinchZoom = e.ctrlKey;
    const isMouseWheelZoom = !e.ctrlKey && !e.shiftKey && Math.abs(e.deltaX) < 1;
    if (isPinchZoom || isMouseWheelZoom) {
      // Zoom centered on cursor position
      const oldZoom = zoomRef.current;
      const sensitivity = isPinchZoom ? 0.005 : 0.003;
      const factor = 1 - e.deltaY * sensitivity;
      const newZoom = Math.max(0.3, Math.min(3, oldZoom * factor));
      setZoom(newZoom);
      zoomRef.current = newZoom;
      // Adjust pan to keep the point under the cursor stable
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const scale = newZoom / oldZoom;
      setPan(p => ({
        x: cx - (cx - p.x) * scale,
        y: cy - (cy - p.y) * scale,
      }));
      // Don't break follow for zoom - the follow loop reads zoomRef
      // and will smoothly recenter using the new zoom level
    } else {
      // Two-finger scroll: pan the view
      pauseFollow();
      setPan(p => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
    }
  }, [pauseFollow]);

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onWheel={onWheel}
      style={{
        position: 'absolute', inset: 0, overflow: 'hidden',
        cursor: 'grab', touchAction: 'none',
      }}
    >
      <div style={{
        position: 'absolute',
        width: SCENE_WIDTH, height: SCENE_HEIGHT,
        transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
        transformOrigin: '0 0',
        willChange: 'transform',
        imageRendering: 'pixelated',
      }}>
        {/* Ground — warm muted green, softer than before */}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, #1e2d1c 0%, #263a24 30%, #2e4530 50%, #263a24 80%, #1e2d1c 100%)', zIndex: 0 }} />
        <div style={{ position: 'absolute', left: '15%', top: '15%', width: '70%', height: '70%', background: 'radial-gradient(ellipse, rgba(90,120,75,0.35) 0%, transparent 55%)', zIndex: 1 }} />

        {/* Procedural trees */}
        {vegetation.trees.map((t, i) => (
          <Prop key={`t${i}`} src={t.sprite} x={t.x} y={t.y} w={t.w * S * t.scale} h={t.h * S * t.scale} zIndex={t.y < 0 ? 2 : undefined} />
        ))}

        {/* Procedural details */}
        {vegetation.details.map((d, i) => (
          <Prop key={`d${i}`} src={d.sprite} x={d.x} y={d.y} w={d.w * S} h={d.h * S} />
        ))}

        {/* Agent home spots — subtle ground circles so you see where agents belong */}
        {agents.map((agent, i) => {
          const home = getHomePosition(i, agents.length);
          const vis = visuals[agent.id];
          const color = vis?.color ?? '#3b82f6';
          return (
            <div key={`spot-${agent.id}`} style={{
              position: 'absolute',
              left: home.x - 40,
              top: home.y + 24,
              width: 80,
              height: 20,
              borderRadius: '50%',
              background: `radial-gradient(ellipse, ${color}18 0%, transparent 70%)`,
              border: `1px solid ${color}12`,
              zIndex: 1,
              pointerEvents: 'none',
            }} />
          );
        })}

        {/* Characters — each gently patrols near their home position */}
        {agents.map((agent, i) => {
          const vis = visuals[agent.id];
          if (!vis) return null;
          const home = getHomePosition(i, agents.length);
          return (
            <SpriteCharacter
              key={agent.id}
              agentId={agent.id}
              config={vis}
              targetPosition={home}
              status={agent.status}
              decisionCount={agent.decisionCount ?? 0}
              mood={agent.mood ?? ''}
              insightLabel={agent.insights?.taskLabel}
              currentDetail={agent.currentDetail}
              toolCallCount={agent.toolCallCount}
              elapsedSeconds={agent.elapsedSeconds}
              onClick={() => selectAgent(agent.id)}
              onPositionUpdate={onAgentMove}
              isSelected={agent.id === selectedAgentId}
            />
          );
        })}

        {/* Warm center glow */}
        <div style={{ position: 'absolute', left: '35%', top: '50%', width: '30%', height: '25%', background: 'radial-gradient(circle, rgba(255,180,80,0.06) 0%, transparent 70%)', pointerEvents: 'none', zIndex: 998 }} />

        {/* Vignette */}
        <div style={{ position: 'absolute', inset: 0, boxShadow: 'inset 0 0 150px 50px rgba(0,0,0,0.4)', pointerEvents: 'none', zIndex: 999 }} />
      </div>
    </div>
  );
}
