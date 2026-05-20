"use client";

/**
 * CommandCoreScene · v10.0.290 · Wave 53 · the homepage Ultron 3D
 * backdrop, as a React Three Fiber scene. A single slowly-rotating
 * faceted core — gold wireframe over a dark, semi-transparent interior
 * — that reads as "the core of a power source, contained".
 *
 * Translated from the Command Core brief in docs/3d-scene-briefs.md.
 * The brief's Spline `Variables` become this component's typed props;
 * idle motion that Spline would key on a timeline is a `useFrame` loop.
 *
 * Data-reactive props (the brief's variable contract) ·
 *   · healthScore   0–100  → core integrity: 100 = whole + bright +
 *                            stable; lower = dimmer interior, edges
 *                            flicker.
 *   · alertLevel    enum   → edge color: info = gold, warn = amber,
 *                            critical = status-red rim.
 *   · situationCount 0–n   → a faint size pulse as active items climb.
 *
 * Render this INSIDE <SceneCanvas> (which owns the lazy chunk, the
 * viewport pause, and the reduced-motion frameloop). It must never be
 * mounted in a tree that also runs Framer Motion.
 */
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";

/** Alert severity — drives the wireframe edge color. */
export type CommandCoreAlertLevel = "info" | "warn" | "critical";

export interface CommandCoreSceneProps {
  /** System health 0–100. Higher = brighter, more stable core. */
  healthScore?: number;
  /** Alert severity — shifts the edge color. */
  alertLevel?: CommandCoreAlertLevel;
  /** Count of active situations — drives a faint scale pulse. */
  situationCount?: number;
}

// Gold-on-dark token hexes (from app/globals.css · kept in sync there).
// The scene background is the surface's own --bg-void (#050505) — the
// <Canvas> renders with `alpha: true`, so no clear color is set here.
const GOLD = "#FDB913";
const AMBER = "#D49A0E"; // --gold-dim · the "warn" edge shift
const STATUS_RED = "#EF4444";
const BG_BASE = "#0A0A0A"; // --bg-base · interior faces

/** Edge color for each alert level. */
function edgeColor(level: CommandCoreAlertLevel): string {
  if (level === "critical") return STATUS_RED;
  if (level === "warn") return AMBER;
  return GOLD;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** The rotating core mesh — solid dark interior + gold wireframe. */
function Core({
  healthScore = 100,
  alertLevel = "info",
  situationCount = 0,
}: CommandCoreSceneProps) {
  const groupRef = useRef<THREE.Group>(null);
  const wireRef = useRef<THREE.LineSegments>(null);
  const solidRef = useRef<THREE.Mesh>(null);

  // health 0–100 → 0–1 integrity factor. Drives interior + edge dimming.
  const integrity = clamp01(healthScore / 100);
  const color = edgeColor(alertLevel);

  // Low-poly icosahedron (detail 0 = 20 faces). One geometry, reused for
  // the solid interior and the wireframe overlay — memoized so a prop
  // change doesn't reallocate GPU buffers.
  const geometry = useMemo(() => new THREE.IcosahedronGeometry(1, 0), []);
  const edges = useMemo(() => new THREE.EdgesGeometry(geometry), [geometry]);

  // Dispose GPU buffers on unmount — `useMemo` alone doesn't free them.
  useMemo(() => {
    return () => {
      geometry.dispose();
      edges.dispose();
    };
  }, [geometry, edges]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (groupRef.current) {
      // ~50s per Y revolution (brief: 40–60s). Slow enough to be ambient.
      groupRef.current.rotation.y = t * ((Math.PI * 2) / 50);
      // A near-imperceptible X drift so it never reads as a flat spin.
      groupRef.current.rotation.x = Math.sin(t / 14) * 0.12;
      // situationCount → faint scale pulse (~4s period). More active
      // items = a slightly deeper breath. Capped so it stays subtle.
      const load = Math.min(situationCount, 12) / 12;
      const pulse = 1 + Math.sin(t / 2) * (0.012 + load * 0.03);
      groupRef.current.scale.setScalar(pulse);
    }
    if (wireRef.current) {
      // ~4s emissive pulse on the edges (brief: synced to `pulse-live`).
      // Low health → the pulse troughs lower and dips toward a flicker.
      const base = 0.32 + integrity * 0.5;
      const swing = 0.12 + (1 - integrity) * 0.16;
      const mat = wireRef.current.material as THREE.LineBasicMaterial;
      mat.opacity = base + Math.sin(t / 2) * swing;
    }
    if (solidRef.current) {
      // Interior emissive tracks integrity — a low-health core dims.
      const mat = solidRef.current.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 0.04 + integrity * 0.14;
    }
  });

  return (
    <group ref={groupRef}>
      {/* Dark semi-transparent interior — depth behind the wireframe. */}
      <mesh ref={solidRef} geometry={geometry}>
        <meshStandardMaterial
          color={BG_BASE}
          emissive={color}
          emissiveIntensity={0.1}
          transparent
          opacity={0.55}
          roughness={0.6}
          metalness={0.15}
        />
      </mesh>
      {/* Gold wireframe edges — the dominant read. */}
      <lineSegments ref={wireRef} geometry={edges}>
        <lineBasicMaterial color={color} transparent opacity={0.8} />
      </lineSegments>
    </group>
  );
}

export function CommandCoreScene(props: CommandCoreSceneProps) {
  return (
    <>
      {/* Declarative camera — `makeDefault` so it's correct even when
          the frameloop is "demand"/"never" (a useFrame-set camera would
          not be positioned in those modes). Pulled back so the core
          sits at ~30% of the frame · no controls (fixed backdrop). */}
      <PerspectiveCamera makeDefault position={[0, 0, 3.6]} fov={50} />
      {/* One key light + one ambient fill — the brief's lighting cap. */}
      <ambientLight intensity={0.35} />
      <pointLight position={[3, 3, 4]} intensity={0.7} color={GOLD} />
      <Core {...props} />
    </>
  );
}
