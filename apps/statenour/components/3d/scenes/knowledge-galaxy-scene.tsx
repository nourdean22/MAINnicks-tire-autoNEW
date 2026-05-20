"use client";

/**
 * KnowledgeGalaxyScene · v10.0.290 · Wave 53 · the /brain/galaxy
 * flagship scene, as a React Three Fiber component. Brain-memory
 * records are a cloud of small glowing spheres in a flattened spiral
 * disc — a galaxy shape — with faint gold links between near neighbors.
 *
 * Translated from the Knowledge Galaxy brief in docs/3d-scene-briefs.md.
 * The brief's Spline `Variables` become typed props; instancing (one
 * `<instancedMesh>` for ALL spheres) replaces hand-placed meshes.
 *
 * Data-reactive props (the brief's variable contract) ·
 *   · memoryCount    0–n   → how many of the NODE_COUNT spheres are lit
 *                            / how dense the visible cloud reads.
 *   · topConfidence  0–1   → brightness ceiling — scales the brightest
 *                            nodes' emissive.
 *   · axisShift      0–1   → drift intensity — how much the
 *                            constellation re-arranges (per-node bob
 *                            amplitude) when the 8-axis model shifts.
 *
 * Render this INSIDE <SceneCanvas>. Never co-mount with Framer Motion.
 */
import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";

export interface KnowledgeGalaxySceneProps {
  /** Total memory records — how many nodes light up (capped at NODE_COUNT). */
  memoryCount?: number;
  /** Highest node confidence 0–1 — scales the brightest emissive. */
  topConfidence?: number;
  /** 0–1 — drift intensity when the 8-axis self-model shifts. */
  axisShift?: number;
}

const GOLD = "#FDB913";
const GOLD_DIM = "#D49A0E";
const BG_VOID = "#050505";

// Fixed node budget — toward the lower end of the brief's 40–80 range
// for the mobile perf ceiling. `memoryCount` lights a subset of these.
const NODE_COUNT = 56;
// Link lines are only drawn between nodes within this distance.
const LINK_DISTANCE = 1.15;
const MAX_LINKS = 70; // cap — keeps the line buffer modest

interface NodeData {
  position: THREE.Vector3;
  /** Per-node confidence 0–1 — drives sphere brightness. */
  confidence: number;
  /** Size tier 0|1|2 — keyed to recency in the brief. */
  sizeTier: number;
  /** De-sync phase so the twinkle / bob isn't uniform. */
  phase: number;
}

/**
 * Deterministic pseudo-random — a seeded LCG so the galaxy layout is
 * stable across renders (no `Math.random()` re-roll on every mount).
 */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

/** Build the galaxy layout — a flattened 2-arm spiral disc. */
function buildNodes(): NodeData[] {
  const rng = makeRng(0x6a17);
  const nodes: NodeData[] = [];
  for (let i = 0; i < NODE_COUNT; i++) {
    // Spiral: radius grows with index, angle winds + per-node jitter.
    const t = i / NODE_COUNT;
    const arm = i % 2 === 0 ? 0 : Math.PI; // 2-arm galaxy
    const radius = 0.35 + t * 2.1 + (rng() - 0.5) * 0.3;
    const angle = arm + t * Math.PI * 3.4 + (rng() - 0.5) * 0.5;
    // Flattened disc — small Y spread relative to the XZ radius.
    const y = (rng() - 0.5) * 0.5;
    nodes.push({
      position: new THREE.Vector3(
        Math.cos(angle) * radius,
        y,
        Math.sin(angle) * radius,
      ),
      confidence: 0.25 + rng() * 0.75,
      sizeTier: Math.floor(rng() * 3),
      phase: rng() * Math.PI * 2,
    });
  }
  return nodes;
}

/** Base sphere radius per recency tier. */
const TIER_RADIUS = [0.045, 0.07, 0.1] as const;

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function GalaxyNodes({
  memoryCount = NODE_COUNT,
  topConfidence = 0.85,
  axisShift = 0,
}: KnowledgeGalaxySceneProps) {
  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const nodes = useMemo(() => buildNodes(), []);

  // How many nodes are "lit" — memoryCount clamped into [0, NODE_COUNT].
  const litCount = Math.min(Math.max(memoryCount, 0), NODE_COUNT);

  // Link geometry — computed once from the static layout. Only neighbor
  // pairs within LINK_DISTANCE, capped at MAX_LINKS.
  const linkGeometry = useMemo(() => {
    const positions: number[] = [];
    let links = 0;
    for (let i = 0; i < nodes.length && links < MAX_LINKS; i++) {
      for (let j = i + 1; j < nodes.length && links < MAX_LINKS; j++) {
        if (nodes[i].position.distanceTo(nodes[j].position) < LINK_DISTANCE) {
          positions.push(
            nodes[i].position.x,
            nodes[i].position.y,
            nodes[i].position.z,
            nodes[j].position.x,
            nodes[j].position.y,
            nodes[j].position.z,
          );
          links++;
        }
      }
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    return geom;
  }, [nodes]);

  // Per-instance base color buffer — bright gold for high-confidence
  // nodes, dim gold for low. Recomputed only when the lit subset or the
  // confidence ceiling changes.
  const colorArray = useMemo(() => {
    const bright = new THREE.Color(GOLD);
    const dim = new THREE.Color(GOLD_DIM);
    const arr = new Float32Array(NODE_COUNT * 3);
    const tmp = new THREE.Color();
    for (let i = 0; i < NODE_COUNT; i++) {
      if (i < litCount) {
        // confidence interpolates dim→bright, then scaled by the ceiling.
        tmp.copy(dim).lerp(bright, clamp01(nodes[i].confidence));
        tmp.multiplyScalar(0.4 + clamp01(topConfidence) * 0.6);
      } else {
        // Unlit nodes — present but near-dark (faint structure).
        tmp.copy(dim).multiplyScalar(0.12);
      }
      tmp.toArray(arr, i * 3);
    }
    return arr;
  }, [nodes, litCount, topConfidence]);

  // Write static transforms + colors into the instanced mesh once the
  // ref is attached (and whenever the color buffer changes).
  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < NODE_COUNT; i++) {
      dummy.position.copy(nodes[i].position);
      const r = TIER_RADIUS[nodes[i].sizeTier] / TIER_RADIUS[1]; // tier scale
      dummy.scale.setScalar(r);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, new THREE.Color().fromArray(colorArray, i * 3));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [nodes, colorArray]);

  // Dispose the link buffer on unmount.
  useMemo(() => {
    return () => linkGeometry.dispose();
  }, [linkGeometry]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (groupRef.current) {
      // Whole constellation drifts — ~60s per Y revolution (brief).
      groupRef.current.rotation.y = t * ((Math.PI * 2) / 60);
    }
    // Per-node bob — amplitude scales with axisShift (0 = near-still,
    // 1 = the constellation visibly re-arranges). De-synced per node.
    const mesh = meshRef.current;
    if (mesh) {
      const amp = 0.02 + clamp01(axisShift) * 0.13;
      const dummy = new THREE.Object3D();
      for (let i = 0; i < NODE_COUNT; i++) {
        const n = nodes[i];
        dummy.position.set(
          n.position.x,
          n.position.y + Math.sin(t * 0.6 + n.phase) * amp,
          n.position.z,
        );
        const r = TIER_RADIUS[n.sizeTier] / TIER_RADIUS[1];
        // Subtle twinkle on scale — de-synced sine per node.
        dummy.scale.setScalar(r * (1 + Math.sin(t + n.phase) * 0.08));
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group ref={groupRef}>
      {/* All NODE_COUNT spheres in ONE instanced draw call. Base radius
          is TIER_RADIUS[1]; per-instance scale shifts to the real tier. */}
      <instancedMesh
        ref={meshRef}
        args={[undefined, undefined, NODE_COUNT]}
      >
        <sphereGeometry args={[TIER_RADIUS[1], 12, 12]} />
        {/* `meshBasicMaterial` reads the per-instance `instanceColor`
            buffer automatically (set via `setColorAt`). Basic, not
            standard: the node color already encodes confidence as a
            bright↔dim gold, so it needs no lighting — and `toneMapped
            false` lets the bright-gold nodes read as genuinely glowing
            against the dark disc. */}
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      {/* Thin, low-opacity gold links between near neighbors. */}
      <lineSegments geometry={linkGeometry}>
        <lineBasicMaterial color={GOLD} transparent opacity={0.12} />
      </lineSegments>
    </group>
  );
}

export function KnowledgeGalaxyScene(props: KnowledgeGalaxySceneProps) {
  return (
    <>
      {/* Declarative camera — slightly above the disc, looking down the
          galaxy plane for depth. `makeDefault` so it's correct under
          any frameloop mode. */}
      <PerspectiveCamera makeDefault position={[0, 2.4, 4.2]} fov={50} />
      {/* No lights — the nodes use `meshBasicMaterial` (their gold
          color already encodes confidence), so the scene is unlit by
          design. This stays well inside the brief's 1-key-1-fill cap. */}
      {/* Faint depth haze toward the back — a large dark plane, low
          opacity, for parallax depth. Void-toned, NO violet. */}
      <mesh position={[0, 0, -3]}>
        <planeGeometry args={[14, 14]} />
        <meshBasicMaterial color={BG_VOID} transparent opacity={0.6} />
      </mesh>
      <GalaxyNodes {...props} />
    </>
  );
}
