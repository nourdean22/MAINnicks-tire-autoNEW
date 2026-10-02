"use client";

/**
 * SceneSkeleton · v10.0.290 · the gold-on-dark loading shimmer shown
 * while a 3D scene's lazy chunk resolves. Wave 53: it is now the
 * `loading` fallback for the React Three Fiber `<Canvas>` chunk
 * (`next/dynamic` in `scene-canvas.tsx`); the Spline-era TBD-sentinel
 * placeholder role is gone — R3F scenes are code, always "ready".
 *
 * Mirrors the existing components/ui/shimmer-skeleton.tsx pattern: a
 * `before:` pseudo-element sweeps the shared `shimmer` keyframe
 * (translateX −100% → 100%, declared in app/globals.css) across a
 * faint neutral gradient. Over that sits a low-opacity radial lift so
 * the placeholder reads as "depth pending" rather than a flat gray box
 * — gold-on-dark, no purple, no pure black.
 *
 * It is purely visual (`aria-hidden`) and imposes no dimensions of its
 * own — the caller (`<SceneCanvas>`) owns sizing.
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
        // ambient neutral lift — reads as 3D depth loading, not a flat box
        "bg-[radial-gradient(circle_at_50%_45%,_var(--surface-raised)_0%,_transparent_70%)]",
        // shimmer sweep — same `shimmer` keyframe the rest of the app uses
        "before:absolute before:inset-0",
        "before:bg-gradient-to-r before:from-transparent before:via-[var(--edge-subtle)] before:to-transparent",
        "before:animate-[shimmer_2.4s_ease-in-out_infinite]",
        className,
      )}
      aria-hidden
    />
  );
}
