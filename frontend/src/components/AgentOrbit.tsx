/**
 * components/AgentOrbit.tsx
 * 3D visualization showing running agents as glowing orbs orbiting a central hub.
 * Built with @react-three/fiber and @react-three/drei.
 * Each orb reflects the live status of an agent from the Zustand store.
 * Running agents pulse brighter and leave a particle trail.
 * Idle agents move slowly and appear dim.
 * Error agents stop moving and turn deep red.
 */
import { Suspense, useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Trail, Float } from '@react-three/drei';
import * as THREE from 'three';
import type { Agent } from '../types';

/** Maps agent id to orbit configuration */
const AGENT_ORBIT_CONFIG: Record<
  string,
  { color: string; radius: number; speed: number; yOffset: number }
> = {
  email: { color: '#ea4335', radius: 1.4, speed: 0.9, yOffset: 0.15 },
  code: { color: '#8b5cf6', radius: 1.0, speed: 0.55, yOffset: -0.1 },
  planning: { color: '#22c55e', radius: 1.75, speed: 0.4, yOffset: 0.05 },
};

/** Fallback config for agents not in the config map */
const DEFAULT_ORBIT_CONFIG = { color: '#94a3b8', radius: 1.2, speed: 0.5, yOffset: 0 };

interface AgentOrbProps {
  agent: Agent;
  index: number;
}

/**
 * Renders a single agent as a glowing orb following an elliptical orbit path.
 * Uses useFrame for per-tick animation and meshStandardMaterial for glow.
 */
function AgentOrb({ agent, index }: AgentOrbProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const config = AGENT_ORBIT_CONFIG[agent.id] ?? {
    ...DEFAULT_ORBIT_CONFIG,
    radius: 1.0 + index * 0.35,
  };

  const isRunning = agent.status === 'running';
  const isError = agent.status === 'error';
  const isIdle = agent.status === 'idle';

  /** Resolved color - error overrides to deep red */
  const baseColor = isError ? '#ff2222' : config.color;

  /** Emissive intensity based on status */
  const emissiveIntensity = isRunning ? 2.2 : isIdle ? 0.5 : 0.3;

  /** Orb opacity - idle is more transparent */
  const opacity = isRunning ? 0.95 : isIdle ? 0.55 : 0.7;

  /** Speed multiplier - error agents stop, idle are slow */
  const speedMultiplier = isError ? 0 : isIdle ? 0.4 : 1;

  /** Phase offset so orbs start at different positions */
  const phaseOffset = (index * Math.PI * 2) / 3;

  /** Light intensity proportional to emissive */
  const lightIntensity = isRunning ? 1.6 : isIdle ? 0.4 : isError ? 0.8 : 0.4;

  useFrame((state) => {
    if (!meshRef.current) return;
    const t = state.clock.elapsedTime;
    const angle = t * config.speed * speedMultiplier + phaseOffset;

    meshRef.current.position.x = Math.cos(angle) * config.radius;
    meshRef.current.position.z = Math.sin(angle) * config.radius * 0.7; // slight ellipse
    meshRef.current.position.y = config.yOffset + Math.sin(angle * 0.8 + phaseOffset) * 0.12;

    /** Pulse brightness on running agents */
    if (isRunning && meshRef.current.material) {
      const mat = meshRef.current.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = emissiveIntensity + Math.sin(t * 3.5 + index) * 0.6;
    }

    /** Sync point light position */
    if (lightRef.current) {
      lightRef.current.position.copy(meshRef.current.position);
    }
  });

  const color = useMemo(() => new THREE.Color(baseColor), [baseColor]);

  return (
    <group>
      {/* Point light that moves with the orb for local glow */}
      <pointLight ref={lightRef} color={baseColor} intensity={lightIntensity} distance={2.5} />

      <Trail
        width={isRunning ? 0.35 : 0.0}
        length={isRunning ? 6 : 0}
        color={color}
        attenuation={(t) => t * t}
      >
        <Float
          speed={isRunning ? 2.5 : 1.0}
          rotationIntensity={0}
          floatIntensity={isRunning ? 0.3 : 0.1}
        >
          <mesh ref={meshRef}>
            <sphereGeometry args={[0.12, 16, 16]} />
            <meshStandardMaterial
              color={baseColor}
              emissive={baseColor}
              emissiveIntensity={emissiveIntensity}
              transparent
              opacity={opacity}
              roughness={0.1}
              metalness={0.3}
            />
          </mesh>
        </Float>
      </Trail>
    </group>
  );
}

/**
 * Central hub sphere - the anchor point that agents orbit around.
 * Slowly pulses using useFrame and emits ambient violet light.
 */
function HubSphere() {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (!meshRef.current) return;
    const t = state.clock.elapsedTime;
    const mat = meshRef.current.material as THREE.MeshStandardMaterial;
    mat.emissiveIntensity = 0.35 + Math.sin(t * 1.2) * 0.12;
    meshRef.current.rotation.y = t * 0.2;
  });

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[0.22, 16, 16]} />
      <meshStandardMaterial
        color="#7c3aed"
        emissive="#7c3aed"
        emissiveIntensity={0.35}
        transparent
        opacity={0.75}
        roughness={0.15}
        metalness={0.5}
      />
    </mesh>
  );
}

/**
 * Ambient star particles floating in the background.
 * Low count (40) to keep GPU load minimal.
 */
function StarField() {
  const pointsRef = useRef<THREE.Points>(null);

  const { positions, count } = useMemo(() => {
    const count = 40;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 8;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 5;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 5 - 1; // pushed back
    }
    return { positions, count };
  }, []);

  useFrame((state) => {
    if (!pointsRef.current) return;
    pointsRef.current.rotation.y = state.clock.elapsedTime * 0.025;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
          count={count}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial color="#a78bfa" size={0.025} transparent opacity={0.45} sizeAttenuation />
    </points>
  );
}

/**
 * Slow scene-wide rotation that animates the entire group when idle.
 * Wraps all 3D content in a group that rotates on Y axis.
 */
function SceneGroup({ agents }: { agents: Agent[] }) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (!groupRef.current) return;
    groupRef.current.rotation.y = state.clock.elapsedTime * 0.08;
  });

  return (
    <group ref={groupRef}>
      <HubSphere />
      {agents.map((agent, i) => (
        <AgentOrb key={agent.id} agent={agent} index={i} />
      ))}
    </group>
  );
}

/** Props for the top-level AgentOrbit component */
export interface AgentOrbitProps {
  agents: Agent[];
  /** Canvas size in px - defaults to 200 */
  size?: number;
}

/**
 * AgentOrbit - top-level 3D canvas component.
 * Renders a React Three Fiber Canvas with transparent background.
 * Wrapped in Suspense so Three.js loads lazily without blocking the UI.
 * Camera is positioned slightly above (y=1.8) looking down ~30 degrees.
 */
export function AgentOrbit({ agents, size = 200 }: AgentOrbitProps) {
  return (
    <div
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        /** Subtle radial glow behind the 3D scene */
        background:
          'radial-gradient(ellipse at center, rgba(124,58,237,0.08) 0%, transparent 70%)',
        borderRadius: '50%',
      }}
    >
      <Canvas
        camera={{ position: [0, 1.8, 3.5], fov: 45 }}
        gl={{ alpha: true, antialias: true }}
        style={{ background: 'transparent' }}
        dpr={[1, 1.5]}
      >
        {/* Lighting */}
        <ambientLight intensity={0.15} />
        <pointLight position={[0, 3, 3]} intensity={0.4} color="#c4b5fd" />

        <StarField />
        <SceneGroup agents={agents} />
      </Canvas>
    </div>
  );
}

/**
 * AgentOrbitWithSuspense - renders AgentOrbit inside a Suspense boundary.
 * The fallback shows the plain text "monet" logo while Three.js initializes.
 */
export function AgentOrbitWithSuspense({ agents, size = 200 }: AgentOrbitProps) {
  return (
    <Suspense
      fallback={
        <div
          style={{
            width: size,
            height: size,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span
            style={{
              fontSize: '32px',
              fontWeight: 300,
              color: 'var(--text-primary)',
              letterSpacing: '-0.5px',
            }}
          >
            monet
          </span>
        </div>
      }
    >
      <AgentOrbit agents={agents} size={size} />
    </Suspense>
  );
}
