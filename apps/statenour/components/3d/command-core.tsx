"use client";

/**
 * CommandCore · v10.0.290 · Wave 53 · per-surface wrapper for the
 * homepage Ultron 3D backdrop — a slowly-rotating geometric core
 * (gold-edged, dark-cored) that signals "this is your operating
 * system" without crowding the data overlay.
 *
 * Wave 53 pivot · used to mount the Spline `<SplineScene>` with a
 * registry URL. R3F has no external scene asset — this wrapper now
 * mounts `<SceneCanvas>` (the generic R3F host) with `<CommandCoreScene>`
 * directly.
 *
 * 2026-05-24 · Wave X.c · DATA-REACTIVE. The mount in
 * components/ultron/ultron.tsx now derives `healthScore` /
 * `alertLevel` / `situationCount` from drift budget + blind-spot
 * severity + situation counts (signals that component already pulls;
 * zero new fetches). The PLACEHOLDER below is the graceful-degradation
 * fallback when the consumer passes `data={undefined}` (initial load
 * / error / no signal). The Command Core brief at
 * docs/3d-scene-briefs.md describes the variable contract.
 */
import { SceneCanvas } from "@/components/3d/scene-canvas";
import {
  CommandCoreScene,
  type CommandCoreSceneProps,
} from "@/components/3d/scenes/command-core-scene";

interface CommandCoreProps {
  /** Sizing / positioning — e.g. "absolute inset-0 -z-10" as a backdrop. */
  className?: string;
  /**
   * Scene data. Optional — when omitted the wrapper falls back to the
   * healthy PLACEHOLDER constants below (used during initial load /
   * error / no signal). Live consumers should pass derived props
   * (see components/ultron/ultron.tsx for the Wave X.c mapping).
   */
  data?: CommandCoreSceneProps;
}

// Graceful-degradation fallback when the consumer passes
// `data={undefined}` (initial load · errored fetch · no signal yet).
// Mirrors a healthy, calm core so the backdrop never blanks.
const PLACEHOLDER: CommandCoreSceneProps = {
  healthScore: 92,
  alertLevel: "info",
  situationCount: 3,
};

export function CommandCore({ className, data }: CommandCoreProps) {
  const sceneProps = data ?? PLACEHOLDER;
  return (
    <SceneCanvas className={className}>
      <CommandCoreScene {...sceneProps} />
    </SceneCanvas>
  );
}
