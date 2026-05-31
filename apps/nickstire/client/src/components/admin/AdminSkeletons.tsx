/**
 * AdminSkeletons — layout-preserving skeletons for the admin shell.
 *
 * Bare spinners (`<Loader2 />`) work but cause layout shift when data
 * arrives — the page jumps as the spinner is replaced by content.
 * Skeletons reserve the final layout space and animate a pulse, so the
 * eye stays anchored.
 *
 * Variants mirror the actual admin layouts:
 *   - `<SkeletonStatCard />`  → matches `StatCard` from shared.tsx
 *   - `<SkeletonKpiGrid />`   → matches the OverviewSection 6-column KPI row
 *   - `<SkeletonRow />`       → matches a table row in DispatchSection / WorkOrders
 *   - `<SkeletonTable />`     → N rows of `SkeletonRow`
 *   - `<SkeletonChart />`     → matches the recharts container size
 *   - `<SkeletonPanel />`     → matches Panel from shared.tsx (header + body)
 *
 * Built 2026-05-07 (wave-82) addressing §9 of ADMIN_PROBLEMS_2026-05-05.md.
 * Uses wave-50 admin tokens (--bg-card-raised, --ring-neutral) so the
 * skeleton matches the loaded-state ring and surface.
 */
import { Skeleton } from "@/components/ui/skeleton";

/** A single stat-card placeholder matching `StatCard` from shared.tsx. */
export function SkeletonStatCard({ tall = false }: { tall?: boolean }) {
  return (
    <div
      role="status"
      aria-busy="true"
      className={[
        "p-3 lg:p-4 rounded-[1rem]",
        "bg-[var(--bg-card-raised)] ring-1 ring-[var(--ring-neutral)]",
        "shadow-[var(--inset-highlight)]",
        tall ? "min-h-[112px]" : "min-h-[96px]",
      ].join(" ")}
    >
      <span className="sr-only">Loading…</span>
      <Skeleton aria-hidden="true" className="h-3 w-24 mb-3 bg-foreground/10" />
      <Skeleton aria-hidden="true" className="h-7 w-32 mb-2 bg-foreground/15" />
      <Skeleton aria-hidden="true" className="h-2.5 w-20 bg-foreground/8" />
    </div>
  );
}

/**
 * Matches the OverviewSection KPI row: `grid-cols-2 lg:grid-cols-3
 * xl:grid-cols-6 gap-4`. Pass `cols` to override.
 */
export function SkeletonKpiGrid({ cols = 6 }: { cols?: 4 | 5 | 6 }) {
  const count = cols;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonStatCard key={i} />
      ))}
    </div>
  );
}

/** Single table-row placeholder. */
export function SkeletonRow({ cells = 4 }: { cells?: number }) {
  return (
    <div role="status" aria-busy="true" className="flex items-center gap-3 px-3 py-2.5 border-b border-border/20">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: cells }).map((_, i) => (
        <Skeleton
          key={i}
          aria-hidden="true"
          className={`h-4 bg-foreground/10 ${
            i === 0 ? "w-32" : i === cells - 1 ? "w-16 ml-auto" : "w-24"
          }`}
        />
      ))}
    </div>
  );
}

/** A skeleton table — header row + N body rows. */
export function SkeletonTable({ rows = 6, cells = 4 }: { rows?: number; cells?: number }) {
  return (
    <div role="status" aria-busy="true" className="bg-card border border-border/30 rounded">
      <span className="sr-only">Loading…</span>
      <div className="flex items-center gap-3 px-3 py-2.5 border-b border-border/30 bg-foreground/[0.02]" aria-hidden="true">
        {Array.from({ length: cells }).map((_, i) => (
          <Skeleton
            key={i}
            className={`h-3 bg-foreground/10 ${
              i === 0 ? "w-24" : i === cells - 1 ? "w-12 ml-auto" : "w-20"
            }`}
          />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonRow key={i} cells={cells} />
      ))}
    </div>
  );
}

/** Recharts-sized chart placeholder. */
export function SkeletonChart({ height = 240 }: { height?: number }) {
  return (
    <div
      role="status"
      aria-busy="true"
      className="w-full bg-[var(--bg-card-raised)] ring-1 ring-[var(--ring-neutral)] rounded-[1rem] p-4 flex flex-col gap-3"
      style={{ height }}
    >
      <span className="sr-only">Loading…</span>
      <Skeleton aria-hidden="true" className="h-4 w-32 bg-foreground/12" />
      <div className="flex-1 flex items-end gap-2" aria-hidden="true">
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton
            key={i}
            className="flex-1 bg-foreground/8 rounded-t"
            style={{ height: `${30 + ((i * 17) % 60)}%` }}
          />
        ))}
      </div>
    </div>
  );
}

/** Panel wrapper skeleton — header + body. */
export function SkeletonPanel({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" aria-busy="true" className="bg-card border border-border/30 rounded">
      <span className="sr-only">Loading…</span>
      <div className="flex items-center gap-3 p-4 border-b border-border/10" aria-hidden="true">
        <Skeleton className="h-4 w-40 bg-foreground/12" />
        <Skeleton className="h-3 w-24 ml-auto bg-foreground/8" />
      </div>
      <div className="p-4 space-y-3" aria-hidden="true">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="w-8 h-8 rounded-full bg-foreground/10 shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-40 bg-foreground/10" />
              <Skeleton className="h-2.5 w-24 bg-foreground/8" />
            </div>
            <Skeleton className="h-3 w-16 bg-foreground/8" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Compound: full OverviewSection-shaped skeleton (KPI grid + 2 panels +
 * chart). Drop-in replacement for `<LoadingState label="Loading
 * dashboard..." />` in the OverviewSection's early-return.
 */
export function SkeletonOverview() {
  return (
    <div className="space-y-6">
      <SkeletonKpiGrid cols={6} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SkeletonPanel rows={5} />
        <SkeletonPanel rows={5} />
      </div>
      <SkeletonChart />
    </div>
  );
}
