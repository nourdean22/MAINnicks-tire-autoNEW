"use client";

/**
 * CommandCore · v10.0.290 · per-surface wrapper for the homepage Ultron
 * 3D backdrop — a rotating geometric core (gold-edged, dark-cored) that
 * signals "this is your operating system" without crowding the data
 * overlay.
 *
 * PHASE 1 STUB. This thin wrapper only mounts `<SplineScene>` with the
 * `commandCore` registry URL — which is a TBD sentinel until the
 * operator builds the scene, so it renders the skeleton + dev badge.
 *
 * Phase 3 wires the data binding (NOT done here — keeps Phase 1 a pure
 * scaffold). When the scene exists, this wrapper will:
 *   · subscribe to `/api/ultron/situation` (the existing aggregator)
 *   · derive `healthScore` (0-100), `alertLevel`, `situationCount`
 *   · feed them to the `useSceneBinding` map below
 * See the CommandCore brief in docs/spline-scene-briefs.md for the
 * exact variable contract the Spline scene must expose.
 *
 * NOT wired into components/ultron/ultron.tsx yet — that mount is
 * Phase 3.
 */
import { useState } from "react";
import { SCENE_URLS } from "@/components/3d/scene-registry";
import { SplineScene, type SplineApplication } from "@/components/3d/spline-scene";
import { useSceneBinding } from "@/components/3d/use-scene-binding";

interface CommandCoreProps {
  /** Sizing / positioning — e.g. "absolute inset-0 -z-10" as a backdrop. */
  className?: string;
}

export function CommandCore({ className }: CommandCoreProps) {
  const [app, setApp] = useState<SplineApplication | null>(null);

  // Phase 3: replace {} with { healthScore, alertLevel, situationCount }
  // sourced from /api/ultron/situation. Empty map = inert no-op.
  useSceneBinding(app, {});

  return (
    <SplineScene
      url={SCENE_URLS.commandCore}
      slotLabel="commandCore"
      onLoad={setApp}
      className={className}
    />
  );
}
