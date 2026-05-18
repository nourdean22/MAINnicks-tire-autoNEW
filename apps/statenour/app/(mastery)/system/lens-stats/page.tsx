"use client";

/**
 * /system/lens-stats — operational visibility on the strategic-frameworks
 * lens-injection system shipped in v10.0.235 → v10.0.260.
 *
 * Shows:
 *   · Total lens fires + fallback rate (how often the generic block
 *     fires vs a specific lens like Pricing Power / OODA / Inversion)
 *   · Top-fired frameworks (counts + avg score) — reveals which lenses
 *     Nick is actually using vs dead-weight in the registry
 *   · Per-surface breakdown — chat / assist / coach-goal / review /
 *     teach / tasks / suggest-goals / nick-noticed
 *   · Window selector · 1d / 7d / 30d / 90d
 *
 * Phase U.4 (2026-05-18 PM) · migrated from `useAuthedFetch` to
 * `trpc.system.lensStats.useQuery({ days })`. Types now flow from
 * `lib/services/lens-stats.ts` via the system router · the 3 manual
 * interfaces (FrameworkAgg / SurfaceAgg / LensStats) are gone.
 * React Query's refetchInterval replaces the manual 60s setInterval.
 */

import { useState } from "react";
import { Panel } from "@/components/panel";
import { StandardPage } from "@/components/layout/standard-page";
import { cn } from "@/lib/utils/cn";
import { trpc } from "@/lib/trpc/client";
import { FrameworkOrbit } from "@/components/3d/framework-orbit";

const WINDOWS = [
  { label: "1d", days: 1 },
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
] as const;

export default function LensStatsPage() {
  const [days, setDays] = useState<number>(7);

  // Phase U.4 · React Query handles per-window refetch + 60s
  // refetchInterval automatically. `days` is part of the input key
  // so changing the window triggers an automatic refetch.
  const { data, error, isLoading: loading } = trpc.system.lensStats.useQuery(
    { days },
    {
      refetchInterval: 60_000,
      staleTime: 30_000,
    },
  );

  const maxFrameworkCount = data?.topFrameworks[0]?.count ?? 1;
  const maxSurfaceCount = data?.surfaces[0]?.count ?? 1;

  return (
    <StandardPage
      eyebrow="System / observability"
      title="Lens-firing stats"
      description="Which strategic frameworks Nick actually applies vs dead-weight registry."
    >
      {/* Window selector */}
      <div className="flex gap-1.5">
        {WINDOWS.map((w) => (
          <button
            key={w.label}
            type="button"
            onClick={() => setDays(w.days)}
            className={cn(
              "px-2.5 py-1 rounded border text-[11px] font-mono uppercase tracking-wider transition-colors",
              days === w.days
                ? "text-amber-300 bg-amber-500/15 border-amber-500/40"
                : "text-zinc-400 border-zinc-800/60 hover:bg-zinc-900/60",
            )}
          >
            {w.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-[12px] text-red-300">
          Failed to load · {error.message}
        </div>
      )}

      {/* Summary scorecard */}
      <Panel className="space-y-1.5">
        <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
          {data ? `Last ${data.windowDays}d` : "Loading"}
        </div>
        <div className="flex items-baseline gap-3 flex-wrap">
          <div>
            <div className="text-[28px] font-bold text-zinc-100 leading-none">
              {data?.totalFires ?? 0}
            </div>
            <div className="text-[10px] text-zinc-500 mt-0.5">total lens fires</div>
          </div>
          <div className="text-zinc-800">·</div>
          <div>
            <div
              className={cn(
                "text-[20px] font-bold leading-none",
                (data?.fallbackRate ?? 0) > 30 ? "text-amber-400" : "text-emerald-400",
              )}
            >
              {data?.fallbackRate ?? 0}%
            </div>
            <div className="text-[10px] text-zinc-500 mt-0.5">fallback rate</div>
          </div>
          {data && data.fallbackRate > 30 && (
            <div className="text-[10px] text-amber-400/80 italic ml-1">
              high fallback · pickFrameworks misses too often · audit trigger regex
            </div>
          )}
        </div>
      </Panel>

      {/* v10.0.291 · FrameworkOrbit Spline scene · 52 framework
          spheres orbiting a center, top-fired ones grow larger.
          Lives above the data table as a memorable visual anchor.
          Renders SceneSkeleton (pending badge in dev) until the
          scene URL lands in components/3d/scene-registry.ts. */}
      <Panel>
        <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-2">
          framework orbit
        </div>
        <FrameworkOrbit className="w-full h-[280px] rounded-lg overflow-hidden" />
      </Panel>

      {/* Top-fired frameworks */}
      <Panel>
        <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-2">
          top-fired frameworks
        </div>
        {loading && !data && <div className="text-[11px] text-zinc-600">loading…</div>}
        {data && data.topFrameworks.length === 0 && (
          <div className="text-[11px] text-zinc-600 italic">
            No fires yet in this window · the system is silent or no business-intent queries hit it.
          </div>
        )}
        <div className="space-y-1">
          {data?.topFrameworks.slice(0, 25).map((f) => (
            <div key={f.framework} className="flex items-center gap-2 text-[11px] font-mono">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "truncate",
                      f.framework === "(fallback)" ? "text-amber-400/80 italic" : "text-zinc-200",
                    )}
                  >
                    {f.framework}
                  </span>
                  <span className="text-zinc-600 text-[9px]">avg {f.avgScore}</span>
                </div>
                <div className="h-1 bg-zinc-900 rounded mt-0.5 overflow-hidden">
                  <div
                    className={cn(
                      "h-full transition-all",
                      f.framework === "(fallback)" ? "bg-amber-500/60" : "bg-emerald-500/60",
                    )}
                    style={{ width: `${(f.count / maxFrameworkCount) * 100}%` }}
                  />
                </div>
              </div>
              <span className="text-zinc-300 text-[11px] tabular-nums shrink-0 w-10 text-right">
                {f.count}
              </span>
            </div>
          ))}
        </div>
      </Panel>

      {/* Per-surface breakdown */}
      <Panel>
        <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-2">
          per-surface breakdown
        </div>
        {data && data.surfaces.length === 0 && (
          <div className="text-[11px] text-zinc-600 italic">No surface activity yet.</div>
        )}
        <div className="space-y-1">
          {data?.surfaces.map((s) => (
            <div key={s.surface} className="flex items-center gap-2 text-[11px] font-mono">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-zinc-200">{s.surface}</span>
                  <span
                    className={cn(
                      "text-[9px]",
                      s.fallbackRate > 30 ? "text-amber-400" : "text-zinc-600",
                    )}
                  >
                    {s.fallbackRate}% fallback
                  </span>
                </div>
                <div className="h-1 bg-zinc-900 rounded mt-0.5 overflow-hidden flex">
                  <div
                    className="h-full bg-emerald-500/60"
                    style={{
                      width: `${((s.count - s.fallbackCount) / maxSurfaceCount) * 100}%`,
                    }}
                  />
                  <div
                    className="h-full bg-amber-500/60"
                    style={{ width: `${(s.fallbackCount / maxSurfaceCount) * 100}%` }}
                  />
                </div>
              </div>
              <span className="text-zinc-300 text-[11px] tabular-nums shrink-0 w-10 text-right">
                {s.count}
              </span>
            </div>
          ))}
        </div>
      </Panel>

      <div className="text-[9px] text-zinc-700 text-center font-mono">
        Auto-refresh 60s · ai.lens_fired metric · v10.0.315 baseline
      </div>
    </StandardPage>
  );
}
