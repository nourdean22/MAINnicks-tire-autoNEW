"use client";

/**
 * SceneSkeleton · v10.0.290 · fallback rendered while a Spline scene
 * is loading (or when the scene URL is empty / TBD).
 *
 * Mirrors the existing components/ui/shimmer-skeleton.tsx pattern but
 * with a 3D-leaning radial-gradient that matches the gold-on-dark
 * brand stance · subtle ambient glow rather than a flat gray rectangle.
 *
 * In dev, when the scene URL is missing, also renders a tiny "scene
 * pending" badge so the operator knows the slot exists but is awaiting
 * a Spline export. Hidden in production builds.
 */
import { cn } from "@/lib/utils";

interface SceneSkeletonProps {
  /** When true and NODE_ENV !== "production", renders a "scene pending" badge. */
  pending?: boolean;
  /** Slot label, used only in the pending badge. */
  slotLabel?: string;
  /** Optional className to size/position the skeleton. */
  className?: string;
}

export function SceneSkeleton({
  pending = false,
  slotLabel,
  className,
}: SceneSkeletonProps) {
  const showDevBadge = pending && process.env.NODE_ENV !== "production";
  return (
    <div
      className={cn(
        "relative w-full h-full overflow-hidden",
        "bg-[radial-gradient(circle_at_50%_50%,_rgba(253,185,19,0.08)_0%,_rgba(10,10,10,0.0)_70%)]",
        "before:absolute before:inset-0 before:animate-pulse",
        "before:bg-[radial-gradient(circle_at_50%_50%,_rgba(253,185,19,0.04)_0%,_transparent_60%)]",
        className,
      )}
      aria-hidden
    >
      {showDevBadge && (
        <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded text-[8px] font-mono uppercase tracking-wider bg-[var(--bg-base)]/80 border border-[var(--gold)]/30 text-[var(--gold)]">
          scene pending{slotLabel ? ` · ${slotLabel}` : ""}
        </div>
      )}
    </div>
  );
}
