"use client";

import { cn } from "@/lib/utils";

// `data-skeleton` (2026-09-16): every skeleton root is discoverable, so a
// render gate can wait for the placeholders to leave before measuring a page.

interface ShimmerSkeletonProps {
  className?: string;
  variant?: "text" | "card" | "stat" | "chart" | "habit";
}

export function ShimmerSkeleton({ className, variant = "text" }: ShimmerSkeletonProps) {
  const base = "rounded-control bg-surface-raised overflow-hidden relative before:absolute before:inset-0 before:bg-gradient-to-r before:from-transparent before:via-[rgba(255,255,255,0.04)] before:to-transparent before:animate-[shimmer_2s_ease-in-out_infinite]";

  if (variant === "card") {
    return (
      <div data-skeleton className={cn("glass-card space-y-3", className)}>
        <div className={cn(base, "h-3 w-24")} />
        <div className={cn(base, "h-8 w-32")} />
        <div className={cn(base, "h-2 w-full")} />
      </div>
    );
  }

  if (variant === "stat") {
    return (
      <div data-skeleton className={cn("glass-card text-center py-3", className)}>
        <div className={cn(base, "h-7 w-16 mx-auto mb-1")} />
        <div className={cn(base, "h-2 w-12 mx-auto")} />
      </div>
    );
  }

  if (variant === "chart") {
    // Static heights — Math.random() here caused SSR/CSR hydration
    // mismatches because the server renders one set of values and the
    // client renders different ones on first paint.
    const stableHeights = [55, 72, 48, 81, 63, 90, 58];
    return (
      <div data-skeleton className={cn("glass-card", className)}>
        <div className={cn(base, "h-3 w-20 mb-3")} />
        <div className="flex items-end gap-1 h-12">
          {stableHeights.map((h, i) => (
            <div
              key={i}
              className={cn(base, "flex-1")}
              style={{ height: `${h}%` }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (variant === "habit") {
    return (
      <div data-skeleton className={cn("grid grid-cols-2 gap-1.5", className)}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={cn(base, "h-10 rounded-surface")} />
        ))}
      </div>
    );
  }

  return <div data-skeleton className={cn(base, "h-4", className)} />;
}
