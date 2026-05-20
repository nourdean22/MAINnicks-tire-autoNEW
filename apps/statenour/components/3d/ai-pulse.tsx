"use client";

/**
 * AiPulse · v10.0.290 · per-surface wrapper for the /chat status-strip
 * 3D element — the smallest scene, on the most-touched surface. A
 * compact mesh that pulses faster while the AI is actively streaming
 * and shifts color with provider state.
 *
 * PHASE 1 STUB. This thin wrapper only mounts `<SplineScene>` with the
 * `aiPulse` registry URL — a TBD sentinel until the operator builds the
 * scene, so it renders the skeleton + dev badge.
 *
 * Phase 3 wires the data binding (NOT done here). When the scene
 * exists, this wrapper will:
 *   · read chat AI activity (provider, latency, streaming state) from
 *     the existing chat telemetry
 *   · derive `pulseSpeed` (0-1) + `colorIndex` (0=gold, 1=ai, 2=red)
 *   · feed them to the `useSceneBinding` map below
 * See the AiPulse brief in docs/spline-scene-briefs.md for the exact
 * variable contract.
 *
 * NOT wired into app/(mastery)/chat/page.tsx yet — that mount is
 * Phase 3.
 */
import { useState } from "react";
import { SCENE_URLS } from "@/components/3d/scene-registry";
import { SplineScene, type SplineApplication } from "@/components/3d/spline-scene";
import { useSceneBinding } from "@/components/3d/use-scene-binding";

interface AiPulseProps {
  /** Sizing / positioning — a small fixed footprint in the status strip. */
  className?: string;
}

export function AiPulse({ className }: AiPulseProps) {
  const [app, setApp] = useState<SplineApplication | null>(null);

  // Phase 3: replace {} with { pulseSpeed, colorIndex } sourced from
  // the chat AI-activity telemetry.
  useSceneBinding(app, {});

  return (
    <SplineScene
      url={SCENE_URLS.aiPulse}
      slotLabel="aiPulse"
      onLoad={setApp}
      className={className}
    />
  );
}
