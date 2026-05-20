"use client";

/**
 * SceneSkeleton · v10.0.290 · the fallback rendered while a Spline
 * scene is loading — or, in Phase 1, the permanent placeholder while a
 * scene URL is still a TBD sentinel.
 *
 * Mirrors the existing components/ui/shimmer-skeleton.tsx pattern: a
 * `before:` pseudo-element sweeps the shared `shimmer` keyframe
 * (translateX −100% → 100%, declared in app/globals.css) across a
 * faint gold gradient. Over that sits a low-opacity radial gold glow so
 * the placeholder reads as "depth pending" rather than a flat gray box
 * — gold-on-dial, no purple, no pure black.
 *
 * It is purely visual (`aria-hidden`) and imposes no dimensions of its
 * own — the caller (`<SplineScene>`) owns sizing. The dev-only "scene
 * pending" badge lives in `<SplineScene>`, not here, so this stays a
 * single-purpose shimmer primitive.
 */
import { cn } from "@/lib/utils";

interface SceneSkeletonProps {
  /** Optional className to size / position the skeleton. */
  className?: string;
}

export function SceneSkeleton({ className }: SceneSkeletonProps) {
  return (
    <div
      className={cn(
        "relative h-full w-full overflow-hidden",
        // ambient gold glow — reads as 3D depth loading, not a gray box
        "bg-[radial-gradient(circle_at_50%_45%,_var(--gold-ghost)_0%,_transparent_70%)]",
        // shimmer sweep — same `shimmer` keyframe the rest of the app uses
        "before:absolute before:inset-0",
        "before:bg-gradient-to-r before:from-transparent before:via-[var(--gold-glow)] before:to-transparent",
        "before:animate-[shimmer_2.4s_ease-in-out_infinite]",
        className,
      )}
      aria-hidden
    />
  );
}
