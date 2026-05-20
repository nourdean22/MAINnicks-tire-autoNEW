"use client";

/**
 * SplineCanvas · v10.0.290 · the ONLY module in the app that imports
 * the Spline runtime. It is never imported statically — `<SplineScene>`
 * pulls it in via `next/dynamic(..., { ssr: false })`, and even that
 * dynamic import only fires once a *real* (non-TBD) scene URL mounts.
 *
 * Why a separate module (mirrors components/goals/mastery-polyhedron):
 *   · `@splinetool/react-spline/next` exports an async server component;
 *     wrapping it in this `"use client"` module + `dynamic(ssr:false)`
 *     keeps Spline's WebGL runtime out of the SSR bundle entirely and
 *     sidesteps any server/client boundary friction.
 *   · Pages that never mount a ready scene never pay the bundle cost —
 *     the chunk is code-split per route.
 *
 * Performance · the parent `<SplineScene>` owns the IntersectionObserver
 * pause logic and only renders this component while the host is in (or
 * near) the viewport. `renderOnDemand` is left at its default (true) so
 * Spline only repaints on change, not every frame.
 */
import Spline from "@splinetool/react-spline/next";
import type { Application } from "@splinetool/runtime";

interface SplineCanvasProps {
  /** A real, exported `prod.spline.design/<id>/scene.splinecode` URL. */
  scene: string;
  /** Forwarded once the runtime Application instance is ready. */
  onLoad?: (app: Application) => void;
  /** Sizing / positioning — owned by the caller. */
  className?: string;
}

export default function SplineCanvas({
  scene,
  onLoad,
  className,
}: SplineCanvasProps) {
  return <Spline scene={scene} onLoad={onLoad} className={className} />;
}
