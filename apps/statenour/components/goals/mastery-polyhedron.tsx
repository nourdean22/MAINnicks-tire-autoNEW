"use client";

/**
 * <MasteryPolyhedron /> · /goals identity moment · 2026-05-19 AM.
 *
 * Renders the 8-axis self-model as a deformable octahedron. Each
 * vertex pulls outward from the origin in proportion to its axis
 * score (0 → collapses to center · 100 → fully extended at unit
 * length). A perfectly-balanced operator produces a symmetric
 * octahedron · a low axis dents the shape inward · the visual
 * asymmetry IS the diagnosis.
 *
 * Design contract (per frontend-design DFII ≥ 8):
 *   · gold (#FDB913) wireframe edges + small spheres at vertices
 *   · subtle ambient rotation (one revolution per ~45 seconds · not
 *     attention-stealing · just alive)
 *   · gentle pulse on the wireframe emissive (sin wave · 4s period)
 *   · tap a vertex → scrolls page to that axis's section in Sidebar
 *   · prefers-reduced-motion → static SVG octahedron (no canvas)
 *   · operator-grade aesthetic · NOT a particle background · NOT
 *     a fancy logo · the shape carries information, not decoration
 *
 * Performance budget:
 *   · single Canvas · single mesh group · 8 vertices + 12 edges
 *   · target 60fps mobile · single-digit draw calls
 *   · entire scene < 200KB code · lazy-loaded via next/dynamic so
 *     pages that don't mount this don't pay the bundle cost
 */

import { useMemo, useRef, useState } from "react";
import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";

export interface AxisInput {
  domain: string;
  score: number;
  delta7d?: number;
}

interface Props {
  axes: AxisInput[];
  /** Optional callback when operator taps a vertex. */
  onAxisClick?: (domain: string) => void;
  /** Height in CSS pixels · default 280 · mobile-friendly. */
  height?: number;
}

const BRAND_GOLD = "#FDB913";
const BRAND_GOLD_DIM = "#7c5a09";
const BG_VOID = "#0A0A0A";

/**
 * Canonical 8-vertex octahedron in axis-aligned (+X, -X, +Y, -Y, +Z, -Z)
 * positions. We rotate/orient the cluster so the 8 axes feel evenly
 * distributed visually · with 8 axes we can't use a 6-vertex octahedron,
 * we use a cube-derived dual that gives us 8 directions evenly placed
 * on the unit sphere (corners of a cube · normalized).
 */
const CUBE_DIRECTIONS: readonly [number, number, number][] = [
  [1, 1, 1], [-1, 1, 1], [1, -1, 1], [-1, -1, 1],
  [1, 1, -1], [-1, 1, -1], [1, -1, -1], [-1, -1, -1],
] as const;

/** Edge index pairs · connect each cube corner to its 3 axis-aligned neighbors. */
const CUBE_EDGES: readonly [number, number][] = [
  [0, 1], [0, 2], [0, 4],
  [1, 3], [1, 5],
  [2, 3], [2, 6],
  [3, 7],
  [4, 5], [4, 6],
  [5, 7],
  [6, 7],
] as const;

function normalize(v: [number, number, number]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / len, v[1] / len, v[2] / len];
}

interface SceneProps {
  axes: AxisInput[];
  onAxisClick?: (domain: string) => void;
}

function PolyhedronScene({ axes, onAxisClick }: SceneProps) {
  const groupRef = useRef<THREE.Group>(null);
  const wireRef = useRef<THREE.LineSegments>(null);
  const [hovered, setHovered] = useState<number | null>(null);

  /**
   * Vertex positions · 8 unit-cube corners scaled outward by
   * (score / 100). Memoized so a re-render doesn't allocate.
   * Recomputed when axes change (which happens via React Query
   * staleTime · once per 30s + on tab focus).
   */
  const vertices = useMemo<[number, number, number][]>(() => {
    const unit = CUBE_DIRECTIONS.map(normalize);
    return unit.map((dir, i) => {
      // Map axis index to score · falls back to 50 (neutral baseline)
      // when fewer than 8 axes are provided.
      const axis = axes[i];
      const score = axis?.score ?? 50;
      // Scale factor: score 0 → 0.2 (avoid total collapse, stay legible)
      // score 100 → 1.6 (just past unit · readable extension)
      const t = 0.2 + (score / 100) * 1.4;
      return [dir[0] * t, dir[1] * t, dir[2] * t];
    });
  }, [axes]);

  /** Edge geometry for the wireframe · pairs of vertex positions. */
  const lineGeometry = useMemo(() => {
    const positions: number[] = [];
    for (const [a, b] of CUBE_EDGES) {
      positions.push(...vertices[a], ...vertices[b]);
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    return geom;
  }, [vertices]);

  /** Subtle ambient rotation + pulse. */
  useFrame((state) => {
    if (groupRef.current) {
      // 1 revolution per 45 seconds · slow enough to be ambient
      groupRef.current.rotation.y = state.clock.elapsedTime * (Math.PI * 2 / 45);
      groupRef.current.rotation.x = Math.sin(state.clock.elapsedTime / 12) * 0.15;
    }
    if (wireRef.current) {
      // Gentle 4-second pulse on opacity
      const pulse = 0.65 + Math.sin(state.clock.elapsedTime / 2) * 0.15;
      (wireRef.current.material as THREE.LineBasicMaterial).opacity = pulse;
    }
  });

  return (
    <group ref={groupRef}>
      {/* Wireframe edges */}
      <lineSegments ref={wireRef}>
        <primitive object={lineGeometry} attach="geometry" />
        <lineBasicMaterial
          color={BRAND_GOLD}
          transparent
          opacity={0.75}
          linewidth={1}
        />
      </lineSegments>

      {/* Vertex spheres · larger when hovered · clickable */}
      {vertices.map((pos, i) => {
        const axis = axes[i];
        const isHover = hovered === i;
        const score = axis?.score ?? 50;
        // Color: gold for high-score · dim gold for low-score
        const color = score >= 60 ? BRAND_GOLD : BRAND_GOLD_DIM;
        return (
          <mesh
            key={i}
            position={pos}
            onPointerOver={(e: ThreeEvent<PointerEvent>) => {
              e.stopPropagation();
              setHovered(i);
              if (typeof document !== "undefined") {
                document.body.style.cursor = "pointer";
              }
            }}
            onPointerOut={() => {
              setHovered(null);
              if (typeof document !== "undefined") {
                document.body.style.cursor = "";
              }
            }}
            onClick={(e: ThreeEvent<MouseEvent>) => {
              e.stopPropagation();
              if (axis?.domain && onAxisClick) onAxisClick(axis.domain);
            }}
          >
            <sphereGeometry args={[isHover ? 0.09 : 0.06, 12, 12]} />
            <meshStandardMaterial
              color={color}
              emissive={color}
              emissiveIntensity={isHover ? 0.6 : 0.3}
              roughness={0.4}
              metalness={0.2}
            />
          </mesh>
        );
      })}
    </group>
  );
}

/**
 * Static fallback for reduced-motion users · same 8-vertex shape
 * projected to 2D (isometric · no rotation · no JS · pure SVG).
 */
function StaticOctahedronSVG({ axes }: { axes: AxisInput[] }) {
  // Project 8 cube corners to 2D using a fixed isometric rotation.
  // The math is constant · we precompute and inline.
  const projected = useMemo(() => {
    const angleY = Math.PI / 6;
    const angleX = Math.PI / 7;
    const cosY = Math.cos(angleY);
    const sinY = Math.sin(angleY);
    const cosX = Math.cos(angleX);
    const sinX = Math.sin(angleX);
    return CUBE_DIRECTIONS.map(normalize).map((dir, i) => {
      const axis = axes[i];
      const t = 0.2 + ((axis?.score ?? 50) / 100) * 1.4;
      const x = dir[0] * t;
      const y = dir[1] * t;
      const z = dir[2] * t;
      // Y-axis rotation
      const x1 = x * cosY - z * sinY;
      const z1 = x * sinY + z * cosY;
      // X-axis rotation
      const y1 = y * cosX - z1 * sinX;
      // SVG y axis flips, scale to 100px viewport
      return {
        sx: 100 + x1 * 60,
        sy: 100 - y1 * 60,
        domain: axis?.domain ?? `axis-${i}`,
      };
    });
  }, [axes]);

  return (
    <svg
      viewBox="0 0 200 200"
      className="w-full h-full"
      aria-hidden="true"
    >
      {CUBE_EDGES.map(([a, b], i) => (
        <line
          key={i}
          x1={projected[a].sx}
          y1={projected[a].sy}
          x2={projected[b].sx}
          y2={projected[b].sy}
          stroke={BRAND_GOLD}
          strokeOpacity={0.7}
          strokeWidth={1.2}
        />
      ))}
      {projected.map((p, i) => (
        <circle key={i} cx={p.sx} cy={p.sy} r={3} fill={BRAND_GOLD} />
      ))}
    </svg>
  );
}

export default function MasteryPolyhedron({
  axes,
  onAxisClick,
  height = 280,
}: Props) {
  // SSR-safe reduced-motion check · honors operator system preference
  // per baseline-ui requirement. The Canvas is heavy · we'd rather
  // ship the static SVG than risk a janky low-fps animation.
  const prefersReducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  if (prefersReducedMotion) {
    return (
      <div
        style={{ height, background: BG_VOID }}
        className="w-full rounded-lg border border-[var(--border-default)] flex items-center justify-center"
        aria-label="8-axis mastery polyhedron · static view"
        role="img"
      >
        <div className="w-48 h-48">
          <StaticOctahedronSVG axes={axes} />
        </div>
      </div>
    );
  }

  return (
    <div
      style={{ height, background: BG_VOID }}
      className="w-full rounded-lg border border-[var(--border-default)] overflow-hidden"
      aria-label="8-axis mastery polyhedron · interactive · tap a vertex to focus that axis"
      role="img"
    >
      <Canvas
        camera={{ position: [0, 0, 4.5], fov: 50 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
      >
        {/* Soft three-point lighting · catches the vertex spheres
            without over-blowing the wireframe contrast. */}
        <ambientLight intensity={0.4} />
        <pointLight position={[3, 3, 3]} intensity={0.8} color={BRAND_GOLD} />
        <pointLight position={[-3, -2, 2]} intensity={0.3} color="#ffffff" />
        <PolyhedronScene axes={axes} onAxisClick={onAxisClick} />
      </Canvas>
    </div>
  );
}
