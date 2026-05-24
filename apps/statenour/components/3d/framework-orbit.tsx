"use client";

/**
 * FrameworkOrbit · v10.0.290 · Wave 53 · per-surface wrapper for the
 * /system/lens-stats 3D telemetry anchor — 52 small spheres orbiting a
 * central point, one per strategic-frameworks lens. Top-fired lenses
 * grow larger and gold; quiet ones stay small and gray.
 *
 * Wave 53 pivot · used to mount the Spline `<SplineScene>` with a
 * registry URL. R3F has no external scene asset — this wrapper now
 * mounts `<SceneCanvas>` (the generic R3F host) with
 * `<FrameworkOrbitScene>` directly.
 *
 * 2026-05-24 · Wave X.c · DATA-REACTIVE. The mount in
 * app/(mastery)/system/lens-stats/page.tsx now derives
 * `topFirerSize` / `secondFirerSize` / `thirdFirerSize` from the
 * trpc lensStats query the page already runs (top-3 framework counts
 * normalized 0..1 against the leader, "(fallback)" filtered out) and
 * `fallbackRate` from the response's percent (0..100 → 0..1). The
 * PLACEHOLDER below is the graceful-degradation fallback used when
 * the consumer passes `data={undefined}` (initial load / error / no
 * fires in the window). Variable contract documented in the
 * Framework Orbit brief at docs/3d-scene-briefs.md.
 */
import { SceneCanvas } from "@/components/3d/scene-canvas";
import {
  FrameworkOrbitScene,
  type FrameworkOrbitSceneProps,
} from "@/components/3d/scenes/framework-orbit-scene";

interface FrameworkOrbitProps {
  /** Sizing / positioning — typically a fixed-height host above the table. */
  className?: string;
  /**
   * Scene data. Optional — when omitted the wrapper falls back to the
   * PLACEHOLDER constants below (used during initial load / errored
   * fetch / empty window). Live consumers should pass derived props
   * (see app/(mastery)/system/lens-stats/page.tsx for the Wave X.c
   * mapping).
   */
  data?: FrameworkOrbitSceneProps;
}

// Graceful-degradation fallback when the consumer passes
// `data={undefined}`. A clear top-3 hierarchy, no fallback alert —
// the scene reads as a healthy system at rest.
const PLACEHOLDER: FrameworkOrbitSceneProps = {
  topFirerSize: 0.9,
  secondFirerSize: 0.62,
  thirdFirerSize: 0.4,
  fallbackRate: 0.08,
};

export function FrameworkOrbit({ className, data }: FrameworkOrbitProps) {
  const sceneProps = data ?? PLACEHOLDER;
  return (
    <SceneCanvas className={className}>
      <FrameworkOrbitScene {...sceneProps} />
    </SceneCanvas>
  );
}
