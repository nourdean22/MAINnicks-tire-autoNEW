/**
 * scene-registry.ts · v10.0.290 · single source of truth for the
 * Spline scene URLs that drive the interactive 3D layer.
 *
 * Each URL points to a `prod.spline.design/<id>/scene.splinecode` file
 * exported from the Spline editor. Until the user builds a scene, the
 * URL is left empty ("") and the per-surface wrapper renders the
 * fallback skeleton instead of mounting Spline.
 *
 * Per spline-3d-integration skill flow ·
 *   1. Open Spline editor
 *   2. Build scene per brief at docs/spline-scene-briefs.md
 *   3. Export → Code Export → copy prod.spline.design URL
 *   4. Paste into the matching slot below
 *   5. Confirm Play Settings: Hide Background ON, Geometry Quality =
 *      Performance, Hide Spline Logo ON (paid plan)
 *   6. Click "Generate Draft" or "Promote to Production" before copying
 *      the URL · the URL does NOT auto-update on Play Settings change
 */

export interface SceneRegistry {
  /**
   * Homepage Ultron · ambient OS-landing backdrop.
   * Variables exposed to data binding · `healthScore`, `alertLevel`, `activeMode`.
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
   * Variables · `pulseSpeed` (0-1), `colorIndex` (0=gold, 1=violet, 2=red).
   */
  aiPulse: string;
}

export const SCENE_URLS: SceneRegistry = {
  commandCore: "",
  knowledgeGalaxy: "",
  frameworkOrbit: "",
  aiPulse: "",
};

/**
 * Returns true when the scene URL is filled in (i.e., user exported a
 * scene from Spline). Per-surface wrappers use this to decide between
 * mounting the live scene vs falling through to the skeleton.
 */
export function hasSceneUrl(key: keyof SceneRegistry): boolean {
  return Boolean(SCENE_URLS[key]?.trim());
}
