/**
 * scene-registry.ts · v10.0.290 · single source of truth for the
 * Spline scene URLs that drive the interactive 3D layer.
 *
 * Each URL points to a `prod.spline.design/<id>/scene.splinecode` file
 * exported from the Spline editor. Until the operator builds a scene
 * the slot holds a `TBD:<name>` sentinel — `<SplineScene>` detects the
 * sentinel via `isSceneReady()` and renders `<SceneSkeleton>` (plus a
 * dev-only "scene pending" badge) instead of attempting — and failing —
 * to fetch a scene. This keeps typecheck, lint, and runtime green with
 * zero real scenes · Phase 1's graceful-no-op requirement.
 *
 * Per spline-3d-integration skill flow ·
 *   1. Open Spline editor
 *   2. Build scene per brief at docs/spline-scene-briefs.md
 *   3. Confirm Play Settings: Geometry Quality = Performance,
 *      Hide Spline Logo ON (paid plan)
 *   4. Export → Code Export → copy the prod.spline.design URL
 *   5. Paste it into the matching slot below, replacing the TBD: value
 */

/** Sentinel prefix marking an unbuilt scene · never a valid URL. */
export const SCENE_TBD = "TBD:" as const;

export interface SceneRegistry {
  /**
   * Homepage Ultron · ambient OS-landing backdrop.
   * Variables exposed to data binding · `healthScore`, `alertLevel`, `situationCount`.
   */
  commandCore: string;
  /**
   * /brain/galaxy · 3D node graph replacing the existing SVG galaxy.
   * Variables · `memoryCount`, `axisShift`, `topConfidence`.
   */
  knowledgeGalaxy: string;
  /**
   * /system/lens-stats · 52 framework spheres orbiting a center.
   * Variables · `topFirerSize`, `secondFirerSize`, `thirdFirerSize`, `fallbackRate`.
   */
  frameworkOrbit: string;
  /**
   * /chat status strip · compact mesh that reflects AI provider activity.
   * Variables · `pulseSpeed` (0-1), `colorIndex` (0=gold, 1=ai, 2=red).
   */
  aiPulse: string;
}

/**
 * The 4 Phase-1 surfaces. Values stay as `TBD:<name>` sentinels until
 * the operator exports the matching Spline scene and pastes its
 * `prod.spline.design` URL here.
 */
export const SCENE_URLS: SceneRegistry = {
  commandCore: `${SCENE_TBD}commandCore`,
  knowledgeGalaxy: `${SCENE_TBD}knowledgeGalaxy`,
  frameworkOrbit: `${SCENE_TBD}frameworkOrbit`,
  aiPulse: `${SCENE_TBD}aiPulse`,
};

/**
 * True once `url` is a real exported scene · not a TBD sentinel, not
 * empty. `<SplineScene>` uses this to decide skeleton-vs-render so the
 * Spline runtime chunk is never even fetched while scenes are TBD.
 */
export function isSceneReady(url: string | undefined | null): url is string {
  return (
    typeof url === "string" &&
    url.trim().length > 0 &&
    !url.startsWith(SCENE_TBD)
  );
}
