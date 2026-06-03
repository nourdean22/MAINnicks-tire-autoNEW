"use client";

/**
 * PageSkeleton · the shared whole-page loading body for statenour
 * mastery surfaces. Composes the existing `ShimmerSkeleton` primitive
 * (gold-on-dark shimmer · SSR-safe stable heights · no purple, no pure
 * black) into a uniform page-shaped placeholder so every page shows the
 * SAME loading state instead of an ad-hoc "..." flash or a blank screen.
 *
 * Intended use is the `loading` slot on `<StandardPage>` (which reserves
 * "loading skeletons" as a cross-cutting concern per its header), but it
 * can also be dropped into any loading branch directly:
 *
 *   if (query.isLoading) return <PageSkeleton stats={3} />;
 *
 * Purely visual: `aria-hidden` + `aria-busy` so screen readers announce
 * "busy" and skip the decorative bars.
 */
import { cn } from "@/lib/utils";
import { ShimmerSkeleton } from "@/components/ui/shimmer-skeleton";

interface PageSkeletonProps {
  /** Stat tiles in the top row (default 4). Pass 0 to hide the row. */
  stats?: number;
  /** Card blocks below the chart (default 2). */
  cards?: number;
  /** Render a chart placeholder between the stats and cards (default true). */
  chart?: boolean;
  /** Outer className for spacing / width overrides · rare. */
  className?: string;
}

export function PageSkeleton({
  stats = 4,
  cards = 2,
  chart = true,
  className,
}: PageSkeletonProps) {
  return (
    <div
      className={cn("space-y-3", className)}
      aria-hidden
      aria-busy="true"
      data-testid="page-skeleton"
    >
      {stats > 0 ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {Array.from({ length: stats }).map((_, i) => (
            <ShimmerSkeleton key={i} variant="stat" />
          ))}
        </div>
      ) : null}
      {chart ? <ShimmerSkeleton variant="chart" /> : null}
      {Array.from({ length: cards }).map((_, i) => (
        <ShimmerSkeleton key={i} variant="card" />
      ))}
    </div>
  );
}
