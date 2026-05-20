"use client";

/**
 * KnowledgeGalaxy · v10.0.290 · per-surface wrapper for the
 * /brain/galaxy 3D node graph — the flagship scene. Brain-memory
 * records become nodes in a slowly-drifting 3D constellation; node
 * brightness tracks confidence, position drifts with axis shifts.
 *
 * PHASE 1 STUB. This thin wrapper only mounts `<SplineScene>` with the
 * `knowledgeGalaxy` registry URL — a TBD sentinel until the operator
 * builds the scene, so it renders the skeleton + dev badge.
 *
 * Phase 3 wires the data binding (NOT done here). When the scene
 * exists, this wrapper will:
 *   · subscribe to the brain-memory data source
 *   · derive `memoryCount`, `topConfidence` (0-1), `axisShift` (0-1)
 *   · feed them to the `useSceneBinding` map below
 * See the KnowledgeGalaxy brief in docs/spline-scene-briefs.md for the
 * exact variable contract.
 *
 * NOT wired into app/(mastery)/brain/galaxy/page.tsx yet — replacing
 * the existing SVG galaxy is Phase 3 (the SVG stays as the failed-load
 * fallback).
 */
import { useState } from "react";
import { SCENE_URLS } from "@/components/3d/scene-registry";
import { SplineScene, type SplineApplication } from "@/components/3d/spline-scene";
import { useSceneBinding } from "@/components/3d/use-scene-binding";

interface KnowledgeGalaxyProps {
  /** Sizing / positioning — typically fills the galaxy panel. */
  className?: string;
}

export function KnowledgeGalaxy({ className }: KnowledgeGalaxyProps) {
  const [app, setApp] = useState<SplineApplication | null>(null);

  // Phase 3: replace {} with { memoryCount, topConfidence, axisShift }
  // sourced from the brain-memory endpoint.
  useSceneBinding(app, {});

  return (
    <SplineScene
      url={SCENE_URLS.knowledgeGalaxy}
      slotLabel="knowledgeGalaxy"
      onLoad={setApp}
      className={className}
    />
  );
}
