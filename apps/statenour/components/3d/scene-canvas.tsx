"use client";

/**
 * SceneCanvas · v10.0.290 · Wave 53 · the generic React Three Fiber
 * host that every 3D scene in the app mounts through. Per-surface
 * wrappers (CommandCore, KnowledgeGalaxy, FrameworkOrbit, AiPulse) pass
 * their scene component as `children`.
 *
 * Replaces the Spline-era `<SplineScene>` + `scene-registry` + URL
 * indirection. R3F scenes are plain React components — there is no
 * external `.splinecode` asset to fetch, so no registry / TBD-sentinel
 * model. The scene IS code; this host just owns the lazy chunk, the
 * viewport pause, and the reduced-motion gate.
 *
 * Lazy-loading ·
 *   · the R3F `<Canvas>` (and the `three` runtime it pulls in) lives in
 *     `./canvas-inner`, imported via `next/dynamic` with `ssr: false`.
 *     three depends on `window` / WebGL — it must never enter the SSR
 *     bundle. `<SceneSkeleton>` is the `loading` fallback while the
 *     chunk resolves.
 *   · pages that never mount a scene never pay the `three` bundle cost
 *     — the chunk is code-split per route.
 *
 * Performance behaviour ·
 *   · IntersectionObserver pauses the scene when the host leaves the
 *     viewport. Rather than unmount the WebGL context (expensive to
 *     re-create), the inner canvas flips R3F's `frameloop` to `"never"`
 *     off-screen and `"always"` on-screen — the render loop stops, the
 *     context is kept warm. Mirrors the visibility lifecycle of
 *     components/hud/neural-background.tsx.
 *   · `prefers-reduced-motion` is resolved here and forwarded; a scene
 *     that gets `reducedMotion` renders a single static frame
 *     (`frameloop="demand"`) instead of an animated `useFrame` loop.
 *   · `dpr={[1, 1.5]}` caps the device-pixel-ratio so high-DPI mobile
 *     screens don't quietly render at 3× cost.
 *   · The caller owns sizing via `className` — this host imposes no
 *     dimensions (a 3D scene at 0×0 silently burns GPU rendering
 *     nothing).
 *
 * Caller usage ·
 *   <SceneCanvas className="absolute inset-0 -z-10">
 *     <CommandCoreScene healthScore={92} alertLevel="info" />
 *   </SceneCanvas>
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { SceneSkeleton } from "@/components/3d/scene-skeleton";

// Lazy import — `ssr: false` keeps the R3F <Canvas> + `three` runtime
// client-only and code-split. The host below renders <SceneSkeleton>
// until this chunk resolves.
const CanvasInner = dynamic(() => import("@/components/3d/canvas-inner"), {
  ssr: false,
  loading: () => <SceneSkeleton />,
});

interface SceneCanvasProps {
  /** The R3F scene — meshes, lights, `useFrame` animation. */
  children: ReactNode;
  /** Outer className — use it to size + position the scene host. */
  className?: string;
}

export function SceneCanvas({ children, className }: SceneCanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  // Lazy initializer — when the platform has no IntersectionObserver,
  // start `inView` true so the scene renders eagerly. Otherwise start
  // false and let the observer flip it once the host first intersects.
  const [inView, setInView] = useState(
    () => typeof IntersectionObserver === "undefined",
  );

  // Reduced-motion preference. The initial value is resolved in a lazy
  // initializer (no synchronous setState in the effect — SSR-safe, the
  // `window` access is guarded and the ssr:false canvas never renders
  // server-side anyway). The effect below only *subscribes* to later
  // changes, so a user toggling the OS setting is still honored.
  const [reducedMotion, setReducedMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Viewport-aware pause — `inView` drives the inner canvas `frameloop`.
  // rootMargin ~150px so the render loop spins up just before the host
  // scrolls into view, avoiding a visible cold-start.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { rootMargin: "150px" },
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={hostRef} className={className}>
      <CanvasInner inView={inView} reducedMotion={reducedMotion}>
        {children}
      </CanvasInner>
    </div>
  );
}
