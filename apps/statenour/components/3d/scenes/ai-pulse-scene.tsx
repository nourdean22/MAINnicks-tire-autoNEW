"use client";

/**
 * AiPulseScene · v10.0.290 · Wave 53 · the /chat status-strip 3D
 * indicator, as a React Three Fiber component. A single small faceted
 * mesh that breathes — slow when idle, rapid while the AI streams —
 * and shifts color with provider state. The smallest scene in the app.
 *
 * Translated from the AI Pulse brief in docs/3d-scene-briefs.md. The
 * brief's Spline `Variables` become typed props.
 *
 * Data-reactive props (the brief's variable contract) ·
 *   · pulseSpeed  0–1   → pulse rate: 0 = slow idle breath (~0.5 Hz),
 *                         1 = rapid pulse (~3 Hz) while streaming.
 *   · colorIndex  0|1|2 → mesh color: 0 = gold (idle/active), 1 =
 *                         brighter gold ("AI working"), 2 = status-red
 *                         (error/stalled). No violet — gold family +
 *                         the one red error state.
 *
 * Render this INSIDE <SceneCanvas>. Designed to read at a small render
 * size (~32–64px). Never co-mount with Framer Motion.
 */
import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";

/** Provider-state color index — see the per-value mapping below. */
export type AiPulseColorIndex = 0 | 1 | 2;

export interface AiPulseSceneProps {
  /** 0 = slow idle breath, 1 = rapid streaming pulse. */
  pulseSpeed?: number;
  /** 0 = gold idle · 1 = brighter "AI working" gold · 2 = red error. */
  colorIndex?: AiPulseColorIndex;
}

const GOLD = "#FDB913";
const GOLD_BRIGHT = "#FFD24A"; // brighter "AI working" tint, still gold
const STATUS_RED = "#EF4444";

/** Hz for the breathing pulse at pulseSpeed 0 and 1. */
const IDLE_HZ = 0.5;
const STREAM_HZ = 3;

/** Color for each provider-state index. */
function meshColor(index: AiPulseColorIndex): string {
  if (index === 2) return STATUS_RED;
  if (index === 1) return GOLD_BRIGHT;
  return GOLD;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function PulseMesh({ pulseSpeed = 0, colorIndex = 0 }: AiPulseSceneProps) {
  const outerRef = useRef<THREE.Mesh>(null);
  const innerRef = useRef<THREE.Mesh>(null);
  // Accumulated pulse phase — integrated each frame so the frequency
  // can change (via pulseSpeed) without the wave jumping.
  const phaseRef = useRef(0);

  const color = meshColor(colorIndex);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    // Interp the pulse frequency between idle + streaming Hz, then
    // advance the phase by 2π·Hz·dt so a speed change is seamless.
    const hz = IDLE_HZ + clamp01(pulseSpeed) * (STREAM_HZ - IDLE_HZ);
    phaseRef.current += delta * hz * Math.PI * 2;
    const wave = Math.sin(phaseRef.current);

    if (outerRef.current) {
      // Breathing scale ~0.95 ↔ 1.05 (brief's idle range).
      outerRef.current.scale.setScalar(1 + wave * 0.05);
      // Slow Y rotation — ~1 revolution per 8s (brief).
      outerRef.current.rotation.y = t * ((Math.PI * 2) / 8);
      const mat = outerRef.current.material as THREE.MeshStandardMaterial;
      mat.color.set(color);
      mat.emissive.set(color);
      // Emissive rides the pulse — brighter at the wave crest.
      mat.emissiveIntensity = 0.5 + wave * 0.3;
    }
    if (innerRef.current) {
      // Inner core pulses slightly out of phase with the outer mesh.
      const innerWave = Math.sin(phaseRef.current + Math.PI * 0.5);
      innerRef.current.scale.setScalar(0.55 + innerWave * 0.06);
      const mat = innerRef.current.material as THREE.MeshBasicMaterial;
      mat.color.set(color);
      mat.opacity = 0.55 + innerWave * 0.25;
    }
  });

  return (
    <group>
      {/* Outer faceted shell — a low-poly icosahedron, gold, emissive. */}
      <mesh ref={outerRef}>
        <icosahedronGeometry args={[1, 0]} />
        <meshStandardMaterial
          color={GOLD}
          emissive={GOLD}
          emissiveIntensity={0.5}
          roughness={0.35}
          metalness={0.3}
          flatShading
        />
      </mesh>
      {/* Faint inner core — pulses out of phase for a "living" read. */}
      <mesh ref={innerRef}>
        <icosahedronGeometry args={[1, 0]} />
        <meshBasicMaterial
          color={GOLD}
          transparent
          opacity={0.6}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

export function AiPulseScene(props: AiPulseSceneProps) {
  return (
    <>
      {/* Declarative camera — tight on the small mesh. `makeDefault`
          so it's correct under any frameloop mode. */}
      <PerspectiveCamera makeDefault position={[0, 0, 3.4]} fov={45} />
      {/* Lit from one side — the brief's single-key-light spec. One
          ambient fill keeps the unlit faces from going pure black. */}
      <ambientLight intensity={0.45} />
      <pointLight position={[2.5, 2, 3]} intensity={0.8} color={GOLD} />
      <PulseMesh {...props} />
    </>
  );
}
