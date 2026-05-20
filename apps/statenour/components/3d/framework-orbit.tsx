"use client";

/**
 * FrameworkOrbit · v10.0.290 · Wave 53 · per-surface wrapper for the
 * /system/lens-stats 3D telemetry anchor — 52 small spheres orbiting a
 * central point, one per strategic-frameworks lens. Top-fired lenses
 * grow larger and gold; quiet ones stay small and gray.
 *
 * Wave 53 pivot: this used to mount the Spline `<SplineScene>` with a
 * registry URL. R3F has no external scene asset — this wrapper now
 * mounts `<SceneCanvas>` (the generic R3F host) with
 * `<FrameworkOrbitScene>` directly.
 *
 * PLACEHOLDER PROPS. The scene reacts to lens-stats; real-data wiring
 * is the NEXT phase. For now this passes sensible defaults so the
 * scene renders + visibly animates. When wired, this wrapper will read
 * `/api/system/lens-stats`, derive `topFirerSize` / `secondFirerSize`
 * / `thirdFirerSize` / `fallbackRate`, and pass them as props. See the
 * Framework Orbit brief in docs/3d-scene-briefs.md.
 *
 * Mounted in app/(mastery)/system/lens-stats/page.tsx (a pre-existing
 * mount from the prior scaffold). Real-data wiring is the next phase;
 * the placeholder props keep the existing mount visibly alive.
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
   * Scene data. Optional — omitted values fall back to the placeholder
   * defaults below. Real data arrives next phase.
   */
  data?: FrameworkOrbitSceneProps;
}

// Placeholder until real data is wired — a clear top-3 hierarchy, no
// fallback alert.
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
