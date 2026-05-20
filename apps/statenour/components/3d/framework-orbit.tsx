"use client";

/**
 * FrameworkOrbit · v10.0.290 · per-surface wrapper for the
 * /system/lens-stats 3D telemetry anchor — 52 small spheres orbiting a
 * central point, one per strategic-frameworks lens. Top-fired lenses
 * grow larger and gold; quiet ones stay small and gray.
 *
 * PHASE 1 STUB. This thin wrapper only mounts `<SplineScene>` with the
 * `frameworkOrbit` registry URL — a TBD sentinel until the operator
 * builds the scene, so it renders the skeleton + dev badge.
 *
 * Phase 3 wires the data binding (NOT done here). When the scene
 * exists, this wrapper will:
 *   · read `/api/system/lens-stats`
 *   · derive `topFirerSize` / `secondFirerSize` / `thirdFirerSize`
 *     (0-1 normalized fire counts) + `fallbackRate` (0-1)
 *   · feed them to the `useSceneBinding` map below
 * See the FrameworkOrbit brief in docs/spline-scene-briefs.md for the
 * exact variable contract.
 *
 * NOT wired into app/(mastery)/system/lens-stats/page.tsx yet — that
 * mount is Phase 3.
 */
import { useState } from "react";
import { SCENE_URLS } from "@/components/3d/scene-registry";
import { SplineScene, type SplineApplication } from "@/components/3d/spline-scene";
import { useSceneBinding } from "@/components/3d/use-scene-binding";

interface FrameworkOrbitProps {
  /** Sizing / positioning — typically a fixed-height host above the table. */
  className?: string;
}

export function FrameworkOrbit({ className }: FrameworkOrbitProps) {
  const [app, setApp] = useState<SplineApplication | null>(null);

  // Phase 3: replace {} with { topFirerSize, secondFirerSize,
  // thirdFirerSize, fallbackRate } from /api/system/lens-stats.
  useSceneBinding(app, {});

  return (
    <SplineScene
      url={SCENE_URLS.frameworkOrbit}
      slotLabel="frameworkOrbit"
      onLoad={setApp}
      className={className}
    />
  );
}
