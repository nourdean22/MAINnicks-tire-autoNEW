"use client";

/**
 * SplineScene · v10.0.290 · the lazy-loaded wrapper that owns every
 * Spline 3D scene in the app. Per-surface wrappers (CommandCore,
 * KnowledgeGalaxy, FrameworkOrbit, AiPulse) all mount through here.
 *
 * Lazy-loading (per spline-3d-integration · Next.js variant) ·
 *   · the Spline runtime lives only in `./spline-canvas`, pulled in via
 *     `next/dynamic` with `ssr: false` (Spline depends on `window`)
 *   · `<SceneSkeleton>` is the `loading` fallback while the chunk +
 *     scene file fetch
 *
 * Graceful no-op (Phase 1 · TBD scene URLs) ·
 *   · when `url` is a `TBD:` sentinel (or empty), `isSceneReady()` is
 *     false → the component renders `<SceneSkeleton>` + a tiny dev-only
 *     "scene pending" badge and NEVER reaches the dynamic import, so the
 *     Spline runtime chunk is not even fetched. typecheck + lint + the
 *     production build all stay green with zero real scenes.
 *
 * Performance behaviour ·
 *   · IntersectionObserver pauses the scene when the host leaves the
 *     viewport — the dynamic `<SplineCanvas>` unmounts, so Spline tears
 *     down its WebGL render loop; it re-mounts on re-enter. Mirrors the
 *     mount/unmount lifecycle of components/hud/neural-background.tsx.
 *   · The caller owns sizing via `className` — the wrapper imposes no
 *     dimensions (a 3D scene at 0×0 silently burns CPU rendering
 *     nothing).
 *
 * Caller usage ·
 *   <SplineScene
 *     url={SCENE_URLS.commandCore}
 *     slotLabel="commandCore"
 *     onLoad={(app) => setApp(app)}   // feed into useSceneBinding
 *     className="absolute inset-0 -z-10"
 *   />
 */
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { Application } from "@splinetool/runtime";
import { SceneSkeleton } from "@/components/3d/scene-skeleton";
import { isSceneReady } from "@/components/3d/scene-registry";

/**
 * The Spline runtime `Application` instance — passed to `onLoad` and,
 * from there, into `useSceneBinding`. Re-exported so per-surface
 * wrappers type their handler without importing `@splinetool/runtime`
 * directly.
 */
export type { Application as SplineApplication };

// Lazy import — `ssr: false` keeps Spline's WebGL runtime client-only.
// Because the render path below is guarded by `isSceneReady()`, this
// import only actually fires once a real (non-TBD) scene URL mounts.
const SplineCanvas = dynamic(() => import("@/components/3d/spline-canvas"), {
  ssr: false,
  loading: () => <SceneSkeleton />,
});

interface SplineSceneProps {
  /**
   * The `prod.spline.design/<id>/scene.splinecode` URL from
   * `scene-registry.ts`. A `TBD:` sentinel (Phase 1 default) → renders
   * the skeleton + dev badge without loading the runtime.
   */
  url: string;
  /**
   * Label shown in the dev-only "scene pending" badge — mirrors the
   * keys of `SCENE_URLS` so the operator can see which slot is awaiting
   * a Spline export.
   */
  slotLabel?: string;
  /**
   * Called once the scene file has loaded and the runtime `Application`
   * instance is ready. Wire it into `useSceneBinding` for data binding.
   */
  onLoad?: (app: Application) => void;
  /** Outer className — use it to size + position the scene host. */
  className?: string;
}

export function SplineScene({
  url,
  slotLabel,
  onLoad,
  className,
}: SplineSceneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  // Lazy initializer — when the platform has no IntersectionObserver
  // (very old browsers; SSR before the ssr:false canvas is reached),
  // start `inView` true so the scene renders eagerly. Otherwise start
  // false and let the observer flip it. Resolving the fallback here,
  // not in the effect, keeps the effect free of synchronous setState.
  const [inView, setInView] = useState(
    () => typeof IntersectionObserver === "undefined",
  );

  // Viewport-aware pause — render the scene only while the host is in
  // (or within 100px of) the viewport. Off-screen → `<SplineCanvas>`
  // unmounts and Spline stops its render loop.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { rootMargin: "100px" },
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const ready = isSceneReady(url);
  // Dev-only pending badge — cockpit-grade: tiny, monospace,
  // 1px-bordered, corner-pinned. Not a card. Stripped in production.
  const showPendingBadge = !ready && process.env.NODE_ENV !== "production";

  return (
    <div ref={hostRef} className={className}>
      {ready && inView ? (
        <SplineCanvas scene={url} onLoad={onLoad} className="h-full w-full" />
      ) : (
        <SceneSkeleton />
      )}
      {showPendingBadge && (
        <span className="pointer-events-none absolute bottom-1 right-1 border border-[var(--border-default)] bg-[var(--bg-void)]/90 px-1 py-px font-mono text-[8px] uppercase leading-none tracking-wider text-[var(--text-tertiary)]">
          scene pending{slotLabel ? ` · ${slotLabel}` : ""}
        </span>
      )}
    </div>
  );
}
