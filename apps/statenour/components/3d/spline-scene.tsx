"use client";

/**
 * SplineScene · v10.0.290 · the lazy-loaded wrapper that owns every
 * Spline 3D scene in the app.
 *
 * Per the spline-3d-integration skill (Next.js variant):
 *   · imports `@splinetool/react-spline/next` via `next/dynamic` so
 *     Spline's WebGL runtime never lands in the SSR bundle
 *   · ssr: false (Spline depends on `window`)
 *   · renders `<SceneSkeleton>` while the chunk + scene file load
 *
 * Performance behavior ·
 *   · Intersection-observer-paused when the scene leaves the viewport
 *     (the `<div ref>` host gets `display: none` so Spline tears down
 *     its render loop). Re-mounts on re-enter.
 *   · Caller controls className for sizing · the wrapper does NOT
 *     impose dimensions of its own (a 3D scene with 0×0 dims will
 *     silently consume CPU rendering nothing).
 *
 * Caller usage ·
 *   <SplineScene
 *     url={SCENE_URLS.commandCore}
 *     slotLabel="commandCore"
 *     onLoad={(app) => { ...setVariables on app ref... }}
 *     className="absolute inset-0 -z-10"
 *   />
 *
 * If `url` is empty, the wrapper short-circuits to `<SceneSkeleton
 * pending />` and never imports the Spline runtime. This is the
 * scaffold-without-scenes path while the user builds in Spline editor.
 */
import { useEffect, useRef, useState } from "react";
import { SceneSkeleton } from "@/components/3d/scene-skeleton";

// Spline's runtime Application type · subset we care about for binding.
// Re-declared here so consumers can type their onLoad handler without
// pulling the full @splinetool/runtime type into every per-surface
// wrapper.
export interface SplineApplication {
  setVariable(name: string, value: number | string | boolean): void;
  emitEvent?(name: string, target?: string): void;
  findObjectByName?(name: string): unknown;
}

// v10.0.293 · DEFERRED · the dynamic import of @splinetool/react-spline
// is parked while we resolve a Next 16 / webpack exports-field issue
// (both `/next` subpath and base `.` path fail to resolve · webpack
// rejects the package's `exports` map). The scaffold + per-surface
// wrappers + scene-briefs all remain in place · this single component
// short-circuits to the SceneSkeleton fallback regardless of URL state
// so the site builds + renders cleanly.
//
// To re-enable once the resolver config is sorted:
//   1. Restore the `dynamic(() => import("@splinetool/react-spline"))`
//   2. Bring back the `if (!url) { ...skeleton... }` short-circuit
//   3. Mount `<Spline scene={url} onLoad={handleSplineLoad} />`
// All call-sites (command-core / knowledge-galaxy / framework-orbit /
// ai-pulse) keep working because the prop interface is unchanged.

interface SplineSceneProps {
  /**
   * The `prod.spline.design/<id>/scene.splinecode` URL exported from
   * the Spline editor. Empty string → renders skeleton without loading
   * the runtime (used while scenes are TBD).
   */
  url: string;
  /**
   * Optional label · used only in the dev "scene pending" badge when
   * url is empty. Mirrors the keys in scene-registry.ts.
   */
  slotLabel?: string;
  /**
   * Called once the scene file is loaded and the runtime Application
   * instance is ready. Use this to wire data binding via
   * use-scene-binding.
   */
  onLoad?: (app: SplineApplication) => void;
  /** Outer className · use to size + position the scene host. */
  className?: string;
}

export function SplineScene({
  url,
  slotLabel,
  onLoad,
  className,
}: SplineSceneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(true);

  // Intersection-observer pause · only render Spline when host is in
  // the viewport (kept in place for when the dynamic import is
  // re-enabled · harmless while skeleton-only).
  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { rootMargin: "100px" },
    );
    obs.observe(host);
    return () => obs.disconnect();
  }, []);

  // While the Spline import is parked, every URL state renders the
  // skeleton. Mark `pending` only when truly TBD so dev still sees
  // which slots are awaiting an export.
  void onLoad; // unused while disabled
  void inView; // unused while disabled
  return (
    <div ref={hostRef} className={className}>
      <SceneSkeleton pending={!url || !url.trim()} slotLabel={slotLabel} />
    </div>
  );
}

