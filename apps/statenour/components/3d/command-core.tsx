"use client";

/**
 * CommandCore · v10.0.290 · Wave 53 · per-surface wrapper for the
 * homepage Ultron 3D backdrop — a slowly-rotating geometric core
 * (gold-edged, dark-cored) that signals "this is your operating
 * system" without crowding the data overlay.
 *
 * Wave 53 pivot: this used to mount the Spline `<SplineScene>` with a
 * registry URL. R3F has no external scene asset — this wrapper now
 * mounts `<SceneCanvas>` (the generic R3F host) with `<CommandCoreScene>`
 * directly.
 *
 * PLACEHOLDER PROPS. The scene reacts to system health / alert / mode;
 * real-data wiring is the NEXT phase. For now this passes sensible
 * defaults so the scene renders + visibly animates. When wired, this
 * wrapper will subscribe to `/api/ultron/situation`, derive
 * `healthScore` / `alertLevel` / `situationCount`, and pass them as
 * props. See the Command Core brief in docs/3d-scene-briefs.md.
 *
 * NOT wired into components/ultron/ultron.tsx yet — that mount is the
 * next phase.
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
   * Scene data. Optional — omitted values fall back to the healthy
   * placeholder defaults below. Real data arrives next phase.
   */
  data?: CommandCoreSceneProps;
}

// Placeholder until real data is wired — a healthy, calm core.
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
