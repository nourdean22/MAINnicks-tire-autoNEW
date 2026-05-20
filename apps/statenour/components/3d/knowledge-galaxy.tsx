"use client";

/**
 * KnowledgeGalaxy · v10.0.290 · Wave 53 · per-surface wrapper for the
 * /brain/galaxy 3D node graph — the flagship scene. Brain-memory
 * records become nodes in a slowly-drifting 3D constellation; node
 * brightness tracks confidence, drift intensity tracks axis shifts.
 *
 * Wave 53 pivot: this used to mount the Spline `<SplineScene>` with a
 * registry URL. R3F has no external scene asset — this wrapper now
 * mounts `<SceneCanvas>` (the generic R3F host) with
 * `<KnowledgeGalaxyScene>` directly.
 *
 * PLACEHOLDER PROPS. The scene reacts to memory count / confidence /
 * axis shift; real-data wiring is the NEXT phase. For now this passes
 * sensible defaults so the scene renders + visibly animates. When
 * wired, this wrapper will subscribe to the brain-memory source,
 * derive `memoryCount` / `topConfidence` / `axisShift`, and pass them
 * as props. See the Knowledge Galaxy brief in docs/3d-scene-briefs.md.
 *
 * NOT wired into app/(mastery)/brain/galaxy/page.tsx yet — replacing
 * the existing SVG galaxy is the next phase.
 */
import { SceneCanvas } from "@/components/3d/scene-canvas";
import {
  KnowledgeGalaxyScene,
  type KnowledgeGalaxySceneProps,
} from "@/components/3d/scenes/knowledge-galaxy-scene";

interface KnowledgeGalaxyProps {
  /** Sizing / positioning — typically fills the galaxy panel. */
  className?: string;
  /**
   * Scene data. Optional — omitted values fall back to the placeholder
   * defaults below. Real data arrives next phase.
   */
  data?: KnowledgeGalaxySceneProps;
}

// Placeholder until real data is wired — a moderately dense, bright,
// gently-drifting constellation.
const PLACEHOLDER: KnowledgeGalaxySceneProps = {
  memoryCount: 42,
  topConfidence: 0.88,
  axisShift: 0.3,
};

export function KnowledgeGalaxy({ className, data }: KnowledgeGalaxyProps) {
  const sceneProps = data ?? PLACEHOLDER;
  return (
    <SceneCanvas className={className}>
      <KnowledgeGalaxyScene {...sceneProps} />
    </SceneCanvas>
  );
}
