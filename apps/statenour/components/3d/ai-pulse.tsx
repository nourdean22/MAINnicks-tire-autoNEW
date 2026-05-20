"use client";

/**
 * AiPulse · v10.0.290 · Wave 53 · per-surface wrapper for the /chat
 * status-strip 3D element — the smallest scene, on the most-touched
 * surface. A compact mesh that pulses faster while the AI is actively
 * streaming and shifts color with provider state.
 *
 * Wave 53 pivot: this used to mount the Spline `<SplineScene>` with a
 * registry URL. R3F has no external scene asset — this wrapper now
 * mounts `<SceneCanvas>` (the generic R3F host) with `<AiPulseScene>`
 * directly.
 *
 * PLACEHOLDER PROPS. The scene reacts to AI provider / streaming
 * state; real-data wiring is the NEXT phase. For now this passes
 * sensible defaults so the scene renders + visibly animates. When
 * wired, this wrapper will read chat AI activity (provider, latency,
 * streaming state), derive `pulseSpeed` / `colorIndex`, and pass them
 * as props. See the AI Pulse brief in docs/3d-scene-briefs.md.
 *
 * NOT wired into app/(mastery)/chat/page.tsx yet — that mount is the
 * next phase.
 */
import { SceneCanvas } from "@/components/3d/scene-canvas";
import {
  AiPulseScene,
  type AiPulseSceneProps,
} from "@/components/3d/scenes/ai-pulse-scene";

interface AiPulseProps {
  /** Sizing / positioning — a small fixed footprint in the status strip. */
  className?: string;
  /**
   * Scene data. Optional — omitted values fall back to the placeholder
   * defaults below. Real data arrives next phase.
   */
  data?: AiPulseSceneProps;
}

// Placeholder until real data is wired — a calm idle breath, gold.
const PLACEHOLDER: AiPulseSceneProps = {
  pulseSpeed: 0.15,
  colorIndex: 0,
};

export function AiPulse({ className, data }: AiPulseProps) {
  const sceneProps = data ?? PLACEHOLDER;
  return (
    <SceneCanvas className={className}>
      <AiPulseScene {...sceneProps} />
    </SceneCanvas>
  );
}
