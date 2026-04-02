/**
 * src/world/scene/ForestScene.tsx
 *
 * Clean, viewport-filling scene. Agents are laid out in a centered row.
 * The forest backdrop is subtle CSS atmosphere — no large virtual canvas,
 * no pan/zoom/follow. Click an agent to open their chat panel.
 */

import { useEffect, useMemo } from 'react';
import { useWorldStore } from '../stores/worldStore';
import { buildAgentVisuals } from '../constants';
import { SpriteCharacter } from '../characters/SpriteCharacter';

export function ForestScene() {
  const agents = useWorldStore(s => s.agents);
  const selectAgent = useWorldStore(s => s.selectAgent);
  const selectedAgentId = useWorldStore(s => s.selectedAgentId);
  const startPolling = useWorldStore(s => s.startPolling);

  useEffect(() => { const stop = startPolling(); return stop; }, [startPolling]);

  const agentIdKey = agents.map(a => a.id).join(',');
  const visuals = useMemo(() => buildAgentVisuals(agents), [agentIdKey]);

  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      {/* Forest backdrop — subtle ambient layers */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(180deg, #131f12 0%, #1a2b18 30%, #223322 50%, #1a2b18 80%, #131f12 100%)',
        zIndex: 0,
      }} />
      {/* Soft clearing glow */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(ellipse at center 55%, rgba(80,110,65,0.25) 0%, transparent 50%)',
        zIndex: 1,
      }} />
      {/* Warm center light */}
      <div style={{
        position: 'absolute', left: '30%', top: '40%', width: '40%', height: '40%',
        background: 'radial-gradient(circle, rgba(255,200,100,0.04) 0%, transparent 60%)',
        pointerEvents: 'none',
        zIndex: 1,
      }} />
      {/* Vignette */}
      <div style={{
        position: 'absolute', inset: 0,
        boxShadow: 'inset 0 0 200px 80px rgba(0,0,0,0.5)',
        pointerEvents: 'none',
        zIndex: 2,
      }} />

      {/* Agent area — centered row, adjusts naturally to any viewport */}
      <div style={{
        position: 'relative',
        zIndex: 10,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        gap: agents.length <= 3 ? 80 : agents.length <= 6 ? 50 : 30,
        padding: '0 40px',
        flexWrap: 'wrap',
      }}>
        {agents.map((agent) => {
          const vis = visuals[agent.id];
          if (!vis) return null;
          return (
            <SpriteCharacter
              key={agent.id}
              agentId={agent.id}
              config={vis}
              status={agent.status}
              decisionCount={agent.decisionCount ?? 0}
              mood={agent.mood ?? ''}
              insightLabel={agent.insights?.taskLabel}
              currentDetail={agent.currentDetail}
              toolCallCount={agent.toolCallCount}
              elapsedSeconds={agent.elapsedSeconds}
              onClick={() => selectAgent(agent.id)}
              isSelected={agent.id === selectedAgentId}
            />
          );
        })}

        {/* Empty state */}
        {agents.length === 0 && (
          <div style={{
            color: 'rgba(255,255,255,0.15)',
            fontSize: 14,
            fontWeight: 400,
            textAlign: 'center',
            padding: '40px',
          }}>
            Create an agent to get started
          </div>
        )}
      </div>
    </div>
  );
}
