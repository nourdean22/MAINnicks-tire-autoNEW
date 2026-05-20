"use client";

/**
 * canvas-inner · v10.0.290 · Wave 53 · the ONLY module in the 3D layer
 * that imports the R3F `<Canvas>` (and, transitively, the `three`
 * runtime). It is never imported statically — `<SceneCanvas>` pulls it
 * in via `next/dynamic(..., { ssr: false })`.
 *
 * Why a separate module (mirrors the old spline-canvas split + the
 * components/goals/mastery-polyhedron pattern) ·
 *   · `three` touches `window` / WebGL — keeping the `<Canvas>` import
 *     behind `ssr: false` keeps it out of the SSR bundle entirely and
 *     sidesteps server/client boundary friction.
 *   · the `three` chunk is code-split per route — pages that never
 *     mount a scene never download it.
 *
 * `<SceneCanvas>` owns the IntersectionObserver + reduced-motion
 * resolution and feeds the results here as `inView` / `reducedMotion`.
 * This module just translates them into R3F's `frameloop` mode:
 *   · reducedMotion        → "demand"  — render one static frame, then
 *                                        idle. The scene still reads;
 *                                        `useFrame` callbacks simply
 *                                        don't advance.
 *   · in view, motion ok   → "always"  — normal ambient render loop.
 *   · off-screen           → "never"   — render loop fully stopped, the
 *                                        WebGL context kept warm.
 */
import type { ReactNode } from "react";
import { Canvas } from "@react-three/fiber";

interface CanvasInnerProps {
  /** The R3F scene — meshes, lights, `useFrame` animation. */
  children: ReactNode;
  /** True while the host is in (or near) the viewport. */
  inView: boolean;
  /** True when the OS `prefers-reduced-motion: reduce` is set. */
  reducedMotion: boolean;
}

export default function CanvasInner({
  children,
  inView,
  reducedMotion,
}: CanvasInnerProps) {
  // frameloop: reduced motion wins (one static frame), else viewport
  // visibility decides between a live loop and a fully-stopped one.
  const frameloop: "always" | "demand" | "never" = reducedMotion
    ? "demand"
    : inView
      ? "always"
      : "never";

  return (
    <Canvas
      // Cap DPR — high-DPI mobile screens otherwise render at 3× cost.
      dpr={[1, 1.5]}
      frameloop={frameloop}
      // `alpha: true` — scenes sit on the surface's own dark background
      // (gold-on-dark); no opaque clear color. `powerPreference` favors
      // the low-power GPU tier on mobile, matching the perf budget.
      gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
      style={{ width: "100%", height: "100%" }}
    >
      {children}
    </Canvas>
  );
}
