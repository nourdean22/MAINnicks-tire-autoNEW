"use client";

/**
 * FrameworkOrbitScene · v10.0.290 · Wave 53 · the /system/lens-stats
 * telemetry anchor, as a React Three Fiber component. 52 small spheres
 * orbit a central anchor — one per strategic-frameworks lens — reading
 * like a particle accelerator seen from the side.
 *
 * Translated from the Framework Orbit brief in docs/3d-scene-briefs.md.
 * All 52 spheres are ONE `<instancedMesh>` (the brief mandates
 * instancing); per-instance color + scale carry the per-lens data.
 *
 * Data-reactive props (the brief's variable contract) ·
 *   · topFirerSize    0–1  → scale of the #1 most-fired lens sphere
 *                            (linear interp base → ~3×).
 *   · secondFirerSize 0–1  → scale of the #2 lens sphere.
 *   · thirdFirerSize  0–1  → scale of the #3 lens sphere.
 *   · fallbackRate    0–1  → when high (>~0.3) the central anchor
 *                            pulses status-red: lens routing degraded.
 *
 * Render this INSIDE <SceneCanvas>. It lives inside a <GlassCard> on
 * the page — keep it compact. Never co-mount with Framer Motion.
 */
import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";

export interface FrameworkOrbitSceneProps {
  /** 0–1 — scale of the #1 most-fired lens sphere. */
  topFirerSize?: number;
  /** 0–1 — scale of the #2 lens sphere. */
  secondFirerSize?: number;
  /** 0–1 — scale of the #3 lens sphere. */
  thirdFirerSize?: number;
  /** 0–1 — system-wide lens-fallback proportion. >~0.3 alerts red. */
  fallbackRate?: number;
}

const GOLD = "#FDB913";
const GOLD_DIM = "#D49A0E";
const TEXT_TERTIARY = "#909090"; // long-tail gray
const STATUS_RED = "#EF4444";

/** One sphere per strategic-frameworks lens. */
const LENS_COUNT = 52;
/** Base sphere radius — the long-tail tier. Top firers scale up to 3×. */
const BASE_RADIUS = 0.07;

interface OrbitData {
  /** Orbital radius from the center. */
  radius: number;
  /** Orbital inclination (tilt of the orbit plane). */
  inclination: number;
  /** Starting angle on the orbit. */
  angle0: number;
  /** Angular speed (rad/s) — one revolution per 8–30s. */
  speed: number;
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

/** Build 52 organic (non-concentric) orbits — varied radius + tilt. */
function buildOrbits(): OrbitData[] {
  const rng = makeRng(0x5e15);
  const orbits: OrbitData[] = [];
  for (let i = 0; i < LENS_COUNT; i++) {
    orbits.push({
      radius: 0.6 + rng() * 1.7,
      inclination: (rng() - 0.5) * Math.PI * 0.9,
      angle0: rng() * Math.PI * 2,
      // 8–30s per revolution → angular speed 2π/period.
      speed: (Math.PI * 2) / (8 + rng() * 22),
    });
  }
  return orbits;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function OrbitField({
  topFirerSize = 0.6,
  secondFirerSize = 0.4,
  thirdFirerSize = 0.28,
  fallbackRate = 0,
}: FrameworkOrbitSceneProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const anchorRef = useRef<THREE.Mesh>(null);

  const orbits = useMemo(() => buildOrbits(), []);

  // Per-lens scale multiplier. Indices 0/1/2 are the top-3 firers and
  // interpolate base→3× from their props; the rest are the long tail
  // (a small fixed scale). The brief: top-3 large gold, mid `gold-dim`,
  // tail tertiary-gray.
  const scales = useMemo(() => {
    const arr = new Float32Array(LENS_COUNT);
    const firer = [
      clamp01(topFirerSize),
      clamp01(secondFirerSize),
      clamp01(thirdFirerSize),
    ];
    for (let i = 0; i < LENS_COUNT; i++) {
      if (i < 3) {
        // base 1× → up to 3× as the firer prop climbs.
        arr[i] = 1 + firer[i] * 2;
      } else if (i < 14) {
        arr[i] = 0.85; // middle tier
      } else {
        arr[i] = 0.6; // long tail — small
      }
    }
    return arr;
  }, [topFirerSize, secondFirerSize, thirdFirerSize]);

  // Per-lens color: top-3 bright gold, middle dim gold, tail gray.
  const colorArray = useMemo(() => {
    const gold = new THREE.Color(GOLD);
    const dim = new THREE.Color(GOLD_DIM);
    const gray = new THREE.Color(TEXT_TERTIARY);
    const arr = new Float32Array(LENS_COUNT * 3);
    for (let i = 0; i < LENS_COUNT; i++) {
      const c = i < 3 ? gold : i < 14 ? dim : gray;
      c.toArray(arr, i * 3);
    }
    return arr;
  }, []);

  // Write the per-instance colors once the mesh ref is attached.
  // (Matrices are written every frame in useFrame — the orbits move.)
  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    for (let i = 0; i < LENS_COUNT; i++) {
      mesh.setColorAt(i, new THREE.Color().fromArray(colorArray, i * 3));
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [colorArray]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const mesh = meshRef.current;
    if (mesh) {
      const dummy = new THREE.Object3D();
      for (let i = 0; i < LENS_COUNT; i++) {
        const o = orbits[i];
        const a = o.angle0 + t * o.speed;
        // Orbit in the XZ plane, then tilt by the inclination about X.
        const x = Math.cos(a) * o.radius;
        const z = Math.sin(a) * o.radius;
        const y = z * Math.sin(o.inclination);
        const zTilted = z * Math.cos(o.inclination);
        dummy.position.set(x, y, zTilted);
        dummy.scale.setScalar(scales[i]);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
    if (anchorRef.current) {
      // Faint ~3s pulse on the central anchor. When fallbackRate is
      // high the anchor shifts toward status-red — a routing alert.
      const mat = anchorRef.current.material as THREE.MeshStandardMaterial;
      const alert = clamp01((fallbackRate - 0.3) / 0.5); // 0 below .3
      const pulse = 0.3 + Math.sin(t / 1.5) * 0.12;
      mat.emissiveIntensity = pulse + alert * 0.3;
      mat.emissive.set(GOLD_DIM).lerp(new THREE.Color(STATUS_RED), alert);
      mat.color.set(GOLD_DIM).lerp(new THREE.Color(STATUS_RED), alert);
    }
  });

  return (
    <group>
      {/* Calm dark-gold central anchor — the registry. */}
      <mesh ref={anchorRef}>
        <sphereGeometry args={[0.16, 16, 16]} />
        <meshStandardMaterial
          color={GOLD_DIM}
          emissive={GOLD_DIM}
          emissiveIntensity={0.3}
          roughness={0.45}
          metalness={0.25}
        />
      </mesh>
      {/* All 52 lens spheres in ONE instanced draw call. */}
      <instancedMesh ref={meshRef} args={[undefined, undefined, LENS_COUNT]}>
        <sphereGeometry args={[BASE_RADIUS, 12, 12]} />
        {/* Basic material — per-instance `instanceColor` carries the
            tier (bright gold / dim gold / gray); no lighting needed. */}
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
    </group>
  );
}

export function FrameworkOrbitScene(props: FrameworkOrbitSceneProps) {
  return (
    <>
      {/* Declarative camera — a side-on accelerator view. `makeDefault`
          so it's correct under any frameloop mode. */}
      <PerspectiveCamera makeDefault position={[0, 0.8, 4.4]} fov={48} />
      {/* One key light catches the central anchor (the only lit mesh —
          the orbiting spheres use a basic material). Within the cap. */}
      <ambientLight intensity={0.4} />
      <pointLight position={[2, 3, 3]} intensity={0.6} color={GOLD} />
      <OrbitField {...props} />
    </>
  );
}
