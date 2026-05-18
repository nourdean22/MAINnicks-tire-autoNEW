"use client";

/**
 * MasterySkeleton · shared loading skeleton for the 4 mastery surfaces.
 *
 * Phase D follow-up · 2026-05-18 · extracted from the duplicated
 * SkeletonView implementations that were inline in goals/page.tsx
 * (lines 437-454) and scoreboard/page.tsx (lines 225-242). Both
 * implementations were hand-rolled static placeholders with NO
 * shimmer animation, while /journal and /tasks use the shared
 * `<ShimmerSkeleton>` component with the gold-shimmer keyframe.
 *
 * Audit (feature-dev:code-reviewer agent, 2026-05-18) flagged this
 * as aesthetic drift #3 + pattern duplication #2.
 *
 * This component delegates to the existing ShimmerSkeleton primitive
 * so all 4 mastery surfaces get the same gold-shimmer treatment ·
 * just with a layout shape (header + N cards) the mastery surfaces
 * actually need.
 *
 * The `maxWidth` prop accommodates the only legitimate per-surface
 * difference between goals (max-w-6xl) and scoreboard (max-w-3xl):
 * the dashboard-density of the page they're previewing.
 */

import { cn } from "@/lib/utils";
import { ShimmerSkeleton } from "@/components/ui/shimmer-skeleton";

interface MasterySkeletonProps {
  /** Number of card-shaped placeholders to render (default 3). */
  cards?: number;
  /** Tailwind max-w-* class to match the real page's container. */
  maxWidth?: string;
  /** Grid layout for the cards (default vertical stack). */
  cardGridClass?: string;
}

export function MasterySkeleton({
  cards = 3,
  maxWidth = "max-w-6xl",
  cardGridClass = "space-y-3",
}: MasterySkeletonProps) {
  return (
    <main className="min-h-[100dvh] bg-[#0A0A0A] text-white">
      <div className={cn(maxWidth, "mx-auto px-4 sm:px-6 py-8 sm:py-10")}>
        {/* Header skeleton · supertitle + title */}
        <ShimmerSkeleton className="h-3 w-24 mb-3 !rounded" />
        <ShimmerSkeleton className="h-7 w-40 mb-8 !rounded" />

        {/* Cards skeleton */}
        <div className={cardGridClass}>
          {Array.from({ length: cards }).map((_, i) => (
            <div
              key={i}
              className="rounded-lg border border-white/5 p-4 space-y-3"
            >
              <ShimmerSkeleton className="h-3 w-1/3 !rounded" />
              <ShimmerSkeleton className="h-2 w-full !rounded" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
