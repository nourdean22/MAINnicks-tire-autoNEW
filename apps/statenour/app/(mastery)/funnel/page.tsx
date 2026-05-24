"use client";

/**
 * /funnel · Intelligence Dispersal Wave 3 (2026-05-24)
 *
 * The statenour home for nickstire shop's conversion funnel:
 *   Leads → Estimates → Drop-Offs → Jobs Done → Reviews → Retained
 *
 * Pulls via the bridge contract v11.6:
 *   · funnel_overview · 6-stage Customer Journey
 *   · funnel_first_visit · per-source first-visit conversion
 *
 * Both actions live on nickstire (see apps/nickstire/server/routes/
 * nour-os-query.ts) and are wrapped by the browser-safe proxy at
 * /api/nickstire/query. Bridge contract:
 * apps/nickstire/docs/NICKSTIRE-QUERY-CONTRACT.md §v11.6.
 *
 * Aesthetic: editorial-minimalist · matches /scoreboard's NickHealth-
 * Section. Card visual contract: `border-white/10 bg-white/[0.02]` +
 * `text-[10px] uppercase tracking-[0.18em] text-white/40` eyebrow.
 *
 * Graceful degradation: self-hides on bridge failure · no error toast ·
 * matches the pattern from /scoreboard NickHealthSection.
 *
 * Mobile: single column · stages stack · same value-first hierarchy.
 *
 * Per docs/2026-05-24-intelligence-dispersal-plan.md §5 Wave 3 · this
 * is the statenour gap surface that absorbed the nickstire admin
 * Intelligence Overview Customer Journey Funnel + First Visit
 * Conversion panels (both retired in Wave 2).
 */

import { useEffect, useState } from "react";
import { MasterySectionLabel } from "@/components/mastery/mastery-section-label";

interface FunnelStage {
  label: string;
  value: number;
  conversionFromPrev: number;
  pctOfTopOfFunnel: number;
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

export default function FunnelPage() {
  const [overview, setOverview] = useState<FunnelOverview | null>(null);
  const [firstVisit, setFirstVisit] = useState<FirstVisitData | null>(null);
  const [bridgeOk, setBridgeOk] = useState<"loading" | "ok" | "down">("loading");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [oRes, fRes] = await Promise.all([
          fetch("/api/nickstire/query?q=funnel_overview"),
          fetch("/api/nickstire/query?q=funnel_first_visit"),
        ]);
        const [oJson, fJson] = await Promise.all([oRes.json(), fRes.json()]);
        if (cancelled) return;
        // Bridge returns { data, query, timestamp } on success; inner
        // `data` is the handler return: { ok, ... } or { ok: false }.
        const oData = oJson?.data;
        const fData = fJson?.data;
        if (!oData || oData.ok !== true) {
          setBridgeOk("down");
          return;
        }
        setOverview(oData as FunnelOverview);
        // First-visit may fail independently · don't block the page
        if (fData && fData.ok === true) {
          setFirstVisit(fData as FirstVisitData);
        }
        setBridgeOk("ok");
      } catch {
        if (!cancelled) setBridgeOk("down");
      }
    };
    void load();
    // Refresh every 5 minutes · funnel data is slow-moving (daily roll-up)
    const id = setInterval(load, 300_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (bridgeOk === "down") {
    return (
      <main className="min-h-[100dvh] bg-[var(--bg-base)] text-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
          <h1 className="text-2xl font-medium tracking-tight">Funnel</h1>
          <p className="mt-4 text-sm text-white/40">
            Bridge to nickstire unavailable · the funnel data lives there.
            Check the bridge status on /system/brain-bus.
          </p>
        </div>
      </main>
    );
  }

  if (bridgeOk === "loading" || !overview) {
    return (
      <main className="min-h-[100dvh] bg-[var(--bg-base)] text-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
          <h1 className="text-2xl font-medium tracking-tight">Funnel</h1>
          <p className="mt-4 text-sm text-white/30 animate-pulse">Loading…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-[100dvh] bg-[var(--bg-base)] text-white">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
        <header>
          <h1 className="text-2xl font-medium tracking-tight">Funnel</h1>
          <p className="mt-2 text-sm text-white/50">
            Nick&apos;s shop conversion · Leads through Retained ·{" "}
            <span className="text-emerald-300 font-mono">{overview.leadToJobRate}%</span>{" "}
            lead-to-job ·{" "}
            <span className="text-emerald-300 font-mono">{overview.leadToRetainedRate}%</span>{" "}
            lead-to-retained.
          </p>
        </header>

        {/* 6-stage funnel */}
        <section className="mt-8 space-y-3">
          <MasterySectionLabel label="Stages" count={overview.stages.length} />
          <div className="space-y-2">
            {overview.stages.map((stage, i) => {
              const colorClass = stage.conversionFromPrev >= 60
                ? "bg-emerald-400/70"
                : stage.conversionFromPrev >= 30
                ? "bg-amber-400/60"
                : "bg-red-400/60";
              const widthPct = Math.max(stage.pctOfTopOfFunnel, 3);
              return (
                <div key={stage.label} className="flex items-center gap-3">
                  <div className="w-24 text-right shrink-0">
                    <span className="text-[11px] text-white/60">{stage.label}</span>
                  </div>
                  <div className="flex-1 relative">
                    <div className="h-7 bg-white/[0.03] rounded-sm overflow-hidden">
                      <div
                        className={`h-full ${colorClass} rounded-sm transition-all duration-700 flex items-center justify-end pr-2`}
                        style={{ width: `${widthPct}%` }}
                      >
                        {widthPct > 15 && (
                          <span className="text-[11px] font-medium text-black/80 tabular-nums">
                            {stage.value.toLocaleString()}
                          </span>
                        )}
                      </div>
                    </div>
                    {widthPct <= 15 && (
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] font-medium text-white/60 tabular-nums">
                        {stage.value.toLocaleString()}
                      </span>
                    )}
                  </div>
                  <div className="w-14 text-right shrink-0">
                    {i > 0 ? (
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
                    ) : (
                      <span className="text-[10px] text-white/30">top</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
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
          via nickstire bridge · v11.6 · refreshes every 5 min
        </p>
      </div>
    </main>
  );
}
