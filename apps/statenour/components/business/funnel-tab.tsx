"use client";

/**
 * FunnelTab · the Funnel section of the merged /business surface (Wave 2).
 *
 * Moved verbatim from the former app/(mastery)/funnel/page.tsx — the only
 * change is the outer <StandardPage> wrapper became a fragment (the page-
 * level chrome now lives on /business), and the former StandardPage
 * `description` (lead-to-job / lead-to-retained line) moved to an inline
 * subtitle at the top of the fragment so nothing is lost. Data fetching,
 * loading/down states, and the 6-stage render are unchanged.
 *
 * Pulls via the bridge contract v11.6:
 *   · funnel_overview · 6-stage Customer Journey
 *   · funnel_first_visit · per-source first-visit conversion
 *
 * Both actions live on nickstire (see apps/nickstire/server/routes/
 * nour-os-query.ts) and are wrapped by the browser-safe proxy at
 * /api/nickstire/query. Bridge contract:
 * apps/nickstire/docs/NICKSTIRE-QUERY-CONTRACT.md §v11.6.
 */

import { MasterySectionLabel } from "@/components/mastery/mastery-section-label";
import { BridgeShell } from "@/components/mastery/bridge-shell";
import { usePollingFetch } from "@/hooks/use-polling-fetch";

interface FunnelStage {
  label: string;
  value: number;
  conversionFromPrev: number;
  pctOfTopOfFunnel: number;
  /** v-truth · true when this stage's value is a ratio-derived estimate
   *  (the live source was unavailable), not real data. Rendered muted. */
  synthetic?: boolean;
}

interface FunnelOverview {
  ok: true;
  stages: FunnelStage[];
  leadToJobRate: number;
  leadToRetainedRate: number;
  timestamp: string;
}

interface FirstVisitSource {
  source: string;
  firstVisits: number;
  repeated: number;
  rate: number;
}

interface FirstVisitData {
  ok: true;
  overallRate: number;
  avgDaysToRepeat: number;
  bySource: FirstVisitSource[];
}

export function FunnelTab() {
  // 2026-05-24 · Wave X.g · migrated off the inline 35-LOC fetch loop
  // onto `usePollingFetch` (two independent calls · the funnel page
  // is unusual in fanning out two bridge actions instead of one).
  // Overview is required · drives the down-state. First-visit is
  // optional · the page still renders without it. Both share the
  // 5-min interval since funnel data is daily-roll-up cadence.
  const {
    data: overviewRaw,
    loading: overviewLoading,
    error: overviewError,
  } = usePollingFetch<FunnelOverview>(
    "/api/nickstire/query?q=funnel_overview",
    { intervalMs: 300_000 },
  );
  const { data: firstVisitRaw } = usePollingFetch<FirstVisitData>(
    "/api/nickstire/query?q=funnel_first_visit",
    { intervalMs: 300_000 },
  );

  // Treat `ok !== true` from the handler the same way the old code
  // did · falsy down. First-visit isolated · stays null on its own
  // failure without disrupting the page.
  const overview = overviewRaw && overviewRaw.ok === true ? overviewRaw : null;
  const firstVisit = firstVisitRaw && firstVisitRaw.ok === true ? firstVisitRaw : null;
  const bridgeOk: "loading" | "ok" | "down" =
    overviewError || (overviewRaw && overviewRaw.ok !== true)
      ? "down"
      : overviewLoading && !overview
        ? "loading"
        : "ok";

  if (bridgeOk === "down") return <BridgeShell title="Funnel" state="down" />;
  if (bridgeOk === "loading" || !overview) return <BridgeShell title="Funnel" state="loading" />;

  return (
    <>
      <p className="text-sm text-white/60 mb-4">
        Nick&apos;s shop conversion · Leads through Retained ·{" "}
        <span className="text-emerald-300 font-mono">{overview.leadToJobRate}%</span>
        {overview.stages[3]?.synthetic ? " (est)" : ""}{" "}
        lead-to-job ·{" "}
        <span className="text-emerald-300 font-mono">{overview.leadToRetainedRate}%</span>
        {overview.stages[5]?.synthetic ? " (est)" : ""}{" "}
        lead-to-retained.
      </p>

      {/* 6-stage funnel */}
      <section className="mt-8 space-y-3">
        <MasterySectionLabel label="Stages" count={overview.stages.length} />
        <div className="space-y-2">
          {overview.stages.map((stage, i) => {
            const isEst = !!stage.synthetic;
            // Conversion % is unreliable if THIS stage or the PREVIOUS one
            // is an estimate (the ratio is value / prevValue).
            const convEst = isEst || !!overview.stages[i - 1]?.synthetic;
            const colorClass = isEst
              ? "bg-white/[0.12]" // muted · estimated, not real data
              : stage.conversionFromPrev >= 60
              ? "bg-emerald-400/70"
              : stage.conversionFromPrev >= 30
              ? "bg-amber-400/60"
              : "bg-red-400/60";
            const widthPct = Math.max(stage.pctOfTopOfFunnel, 3);
            const valueText = `${isEst ? "~" : ""}${stage.value.toLocaleString()}`;
            return (
              <div key={stage.label} className="flex items-center gap-3">
                <div className="w-24 text-right shrink-0">
                  <span className="text-[11px] text-white/60">{stage.label}</span>
                  {isEst && (
                    <span className="ml-1 text-[8px] font-mono uppercase tracking-wider text-white/30">
                      est
                    </span>
                  )}
                </div>
                <div className="flex-1 relative">
                  <div className="h-7 bg-white/[0.03] rounded-sm overflow-hidden">
                    <div
                      className={`h-full ${colorClass} rounded-sm transition-all duration-700 flex items-center justify-end pr-2`}
                      style={{ width: `${widthPct}%` }}
                    >
                      {widthPct > 15 && (
                        <span
                          className={`text-[11px] font-medium tabular-nums ${isEst ? "text-white/70" : "text-black/80"}`}
                        >
                          {valueText}
                        </span>
                      )}
                    </div>
                  </div>
                  {widthPct <= 15 && (
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] font-medium text-white/60 tabular-nums">
                      {valueText}
                    </span>
                  )}
                </div>
                <div className="w-14 text-right shrink-0">
                  {i === 0 ? (
                    <span className="text-[10px] text-white/30">top</span>
                  ) : convEst ? (
                    <span className="text-[10px] font-mono text-white/30">est</span>
                  ) : (
                    <span
                      className={`text-[11px] font-mono tabular-nums ${
                        stage.conversionFromPrev >= 60
                          ? "text-emerald-300"
                          : stage.conversionFromPrev >= 30
                          ? "text-amber-300"
                          : "text-red-300"
                      }`}
                    >
                      {stage.conversionFromPrev}%
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {overview.stages.some((s) => s.synthetic) && (
          <p className="text-[10px] text-white/35 leading-snug">
            <span className="text-white/50">~ / est</span> = derived estimate ·
            the live source for that stage was unavailable, so the value is
            inferred from typical ratios. Treat it as a rough placeholder, not real data.
          </p>
        )}
      </section>

      {/* Per-source first-visit conversion · skips when bridge down */}
      {firstVisit && firstVisit.bySource.length > 0 && (
        <section className="mt-10 space-y-3">
          <MasterySectionLabel
            label="First-visit conversion · by source"
            count={firstVisit.bySource.length}
          />
          <p className="text-[11px] text-white/40">
            Overall <span className="text-emerald-300 font-mono">{firstVisit.overallRate}%</span> first-visit-to-repeat ·{" "}
            avg <span className="font-mono text-white/70">{firstVisit.avgDaysToRepeat}d</span> between first and second visit.
          </p>
          <div className="rounded-lg border border-white/10 bg-white/[0.02] divide-y divide-white/[0.04]">
            {firstVisit.bySource.map((s) => (
              <div key={s.source} className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium capitalize text-white/85">{s.source}</p>
                  <p className="text-[10px] text-white/40 tabular-nums">
                    {s.firstVisits} first · {s.repeated} returned
                  </p>
                </div>
                <span
                  className={`text-[14px] font-mono font-medium tabular-nums ${
                    s.rate >= 40
                      ? "text-emerald-300"
                      : s.rate >= 20
                      ? "text-amber-300"
                      : "text-white/50"
                  }`}
                >
                  {s.rate}%
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <p className="mt-12 text-[10px] uppercase tracking-[0.22em] text-white/30">
        via nickstire bridge · refreshes every 5 min
      </p>
    </>
  );
}
