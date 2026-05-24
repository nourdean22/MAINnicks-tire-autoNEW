"use client";

/**
 * /scoreboard · Phase A.2 (2026-05-18)
 *
 * The "What matters now" meta-scoreboard.
 * Per brainstorm Decisions 5-7 + ADR-0011.
 *
 * Shape:
 *   · State badge at top · "calm" or "alive"
 *   · Numbers grid · 5-10 cards · anomalous (with Nick's why) on top
 *   · Each card: label · big value · trend arrow · delta · link
 *   · Footer: composedAt + lastBriefAt timestamps
 *
 * 2026-05-24 · Intelligence Dispersal Wave 1.5 · NickHealthSection
 * added below OperatorPulse · pulls master_report from the nickstire
 * bridge (NICKSTIRE-QUERY-CONTRACT v11.5) · renders 4 KPI cards +
 * collapsible 13-component breakdown. Statenour is the canonical
 * home for "intelligence-about-Nick-shop" · the nickstire admin
 * Intelligence page is being deleted in favor of this surface.
 *
 * Aesthetic: editorial-minimalist · matches /goals + /customer-360.
 * The page is a SINGLE-PAGE pull-anytime surface that complements
 * the morning brief push (Phase 5).
 *
 * Mobile: single column · cards stack · same value-first hierarchy.
 *
 * See: ADR-0011 · lib/services/meta-scoreboard.ts · /api/scoreboard/snapshot
 */

import Link from "next/link";
import { useEffect, useState } from "react";
// Phase WW (2026-05-19 AM) · useAuthedFetch swapped for trpc.
import { trpc } from "@/lib/trpc/client";
import { MasteryErrorView } from "@/components/mastery/mastery-error-view";
import { MasterySkeleton } from "@/components/mastery/mastery-skeleton";
import { MasterySectionLabel } from "@/components/mastery/mastery-section-label";
// Phase E (2026-05-18 PM) · OperatorPulse · top anomaly + 7d motion +
// cross-surface trailing-axis drift. Right above the anomaly grid so
// the operator gets the action-forward narration BEFORE the raw numbers.
import { OperatorPulse } from "@/components/operator/operator-pulse";
// Phase G (2026-05-18 PM) · CompoundChain · this-week chain · what
// compounded into the current scoreboard numbers. Mounted at the
// bottom (below cards) because it's a "look back at what moved the
// numbers" view · the cards themselves are the primary read.
import { CompoundChain } from "@/components/operator/compound-chain";
// TRACK consolidation (2026-05-21) · task-execution telemetry (streaks ·
// pace · project momentum · warning queue · routine heatmap) · rehomed
// here from the deleted /tasks TRACK tab. KPI cards above are business
// numbers; this is the execution layer beneath them.
import { KommandoTrack } from "@/components/actions/mode-track";

type Trend = "up" | "down" | "flat";

interface ScoreNumber {
  key: string;
  label: string;
  value: number;
  unit: string;
  display: string;
  delta7d: number | null;
  trend: Trend;
  anomalous: boolean;
  why: string | null;
  link: string | null;
}

interface Snapshot {
  numbers: ScoreNumber[];
  composedAt: string;
  lastBriefAt: string | null;
  state: "calm" | "alive";
}

export default function ScoreboardPage() {
  // Phase WW (2026-05-19 AM) · tRPC migration · same Snapshot shape
  // via the buildMetaScoreboard service · 30s staleTime matches the
  // route's prior Cache-Control: max-age=30. Same MasteryErrorView +
  // MasterySkeleton primitives so the visual contract is unchanged.
  const snapshotQuery = trpc.operator.scoreboardSnapshot.useQuery(undefined, {
    staleTime: 30_000,
  });
  const data = snapshotQuery.data as Snapshot | undefined;
  const loading = snapshotQuery.isLoading;
  const error = snapshotQuery.error;
  const reload = () => void snapshotQuery.refetch();

  if (loading && !data) {
    return (
      <MasterySkeleton
        cards={4}
        maxWidth="max-w-3xl"
        cardGridClass="grid grid-cols-1 sm:grid-cols-2 gap-3"
      />
    );
  }
  if (error)
    return <MasteryErrorView label="Scoreboard" error={error.message} onRetry={reload} />;
  if (!data) return null;

  const anomalies = data.numbers.filter((n) => n.anomalous);
  const anchors = data.numbers.filter((n) => !n.anomalous);

  return (
    <main className="min-h-[100dvh] bg-[var(--bg-base)] text-white">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
        <Header state={data.state} lastBriefAt={data.lastBriefAt} />

        {/* Phase E (2026-05-18 PM) · OperatorPulse · top anomaly narration
            + 7d motion across anchors + cross-surface trailing-axis drift.
            Sits between the state badge and the cards · gives the
            operator the "right now" story in one strip before the raw
            number grid. */}
        <OperatorPulse surface="scoreboard" className="mt-6 px-0 mx-0" />

        {/* Intelligence Dispersal Wave 1.5 (2026-05-24) · Nick shop
            health from the nickstire master_report bridge. Self-hides
            when bridge is down or returns ok:false. Editorial-mini-
            malist match to the existing Card visual contract. */}
        <NickHealthSection />

        {anomalies.length > 0 ? (
          <section className="mt-6 space-y-3">
            <MasterySectionLabel
              label="Anomalous"
              count={anomalies.length}
              tone="amber"
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {anomalies.map((n) => (
                <Card key={n.key} number={n} />
              ))}
            </div>
          </section>
        ) : null}

        <section className="mt-6 space-y-3">
          <MasterySectionLabel
            label="Anchors"
            count={anchors.length}
          />
          {anchors.length === 0 ? (
            <p className="text-sm text-[var(--text-secondary)]">
              No anchor numbers right now.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {anchors.map((n) => (
                <Card key={n.key} number={n} />
              ))}
            </div>
          )}
        </section>

        {/* Phase G (2026-05-18 PM) · CompoundChain · "what compounded
            INTO these numbers this week" · backward-looking from anchors
            to the tasks that fed them. Self-hides if no chained work
            happened in the window. */}
        <CompoundChain surface="scoreboard" className="mt-8 px-0 mx-0" />

        {/* TRACK consolidation (2026-05-21) · task-execution telemetry ·
            rehomed from the deleted /tasks TRACK tab. Complements the KPI
            cards above — those are outcomes, this is the work that feeds
            them. */}
        <KommandoTrack />

        <Footer composedAt={data.composedAt} lastBriefAt={data.lastBriefAt} />
      </div>
    </main>
  );
}

function Header({
  state,
  lastBriefAt: _lastBriefAt,
}: {
  state: "calm" | "alive";
  lastBriefAt: string | null;
}) {
  return (
    <header className="flex items-start justify-between gap-4">
      <div>
        {/* Canonical eyebrow tracking 0.14em + .eyebrow weight ·
            matches /goals + /brain pattern post-2026-05-18 PM
            design-tokens pass (ADR-0015). */}
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)] mb-1">
          What matters now
        </p>
        <h1 className="text-2xl font-medium text-[var(--text-primary)]">
          Scoreboard
        </h1>
      </div>
      <span
        className={[
          "inline-flex items-center px-3 py-1 rounded-full text-[10px] uppercase tracking-[0.14em] font-semibold",
          state === "alive"
            ? "bg-amber-500/10 text-amber-200 border border-amber-500/30"
            : "bg-emerald-500/10 text-emerald-200 border border-emerald-500/30",
        ].join(" ")}
      >
        {state}
      </span>
    </header>
  );
}

function Card({ number }: { number: ScoreNumber }) {
  const inner = (
    <div
      className={[
        "rounded-lg border p-4 transition",
        number.anomalous
          ? "border-amber-500/30 bg-amber-500/[0.04] hover:bg-amber-500/[0.08]"
          : "border-white/10 bg-white/[0.02] hover:bg-white/[0.04]",
        number.link ? "cursor-pointer" : "",
      ].join(" ")}
    >
      <p className="text-[10px] uppercase tracking-[0.18em] text-white/40 mb-2">
        {number.label}
      </p>
      <p className="text-2xl font-medium tabular-nums">{number.display}</p>
      {number.why ? (
        <p className="mt-2 text-xs text-amber-200/80 italic line-clamp-2">
          {number.why}
        </p>
      ) : null}
      {number.delta7d != null && number.delta7d !== 0 ? (
        <p
          className={[
            "mt-2 text-[10px] tabular-nums",
            number.trend === "up"
              ? "text-emerald-300"
              : number.trend === "down"
                ? "text-red-300"
                : "text-white/40",
          ].join(" ")}
        >
          {number.trend === "up" ? "↑" : number.trend === "down" ? "↓" : "·"}{" "}
          {Math.abs(number.delta7d).toFixed(1)} · 7d
        </p>
      ) : null}
    </div>
  );
  // Phase D follow-up audit (2026-05-18) · cross-link #3 · default
  // an anomalous card with no explicit `link` to a /journal search
  // pre-filtered by the metric label. Operator sees what they've
  // journaled about the same theme · closes the audit's 'no
  // scoreboard anomaly links to /goals or /journal' gap. Explicit
  // `number.link` from the snapshot service still wins · this is
  // purely a fallback for anomalies with no narrator-supplied link.
  const resolvedHref =
    number.link ??
    (number.anomalous
      ? `/journal?search=${encodeURIComponent(number.label)}`
      : null);
  if (resolvedHref) {
    return (
      <Link
        href={resolvedHref}
        className="block"
        title={
          number.link
            ? undefined
            : `journal entries about '${number.label}'`
        }
      >
        {inner}
      </Link>
    );
  }
  return inner;
}

// Intelligence Dispersal Wave 1.5 (2026-05-24) · Nick shop health
// section. Fetches master_report via the browser-safe proxy at
// /api/nickstire/query (which wraps queryNick + the bridge contract
// v11.5). Renders 4 KPI cards above the existing scoreboard cards +
// a collapsible 13-signal score breakdown.
//
// Aesthetic match: uses the same `border-white/10 bg-white/[0.02]`
// + `text-[10px] uppercase tracking-[0.18em] text-white/40` label
// style as the existing Card component. No new design language.
//
// Graceful degradation: self-hides entirely when the bridge is down
// or returns `ok: false` · no error toast · no broken card · matches
// the pattern documented in app/api/nickstire/query/route.ts ("the
// client differentiates by looking for .error vs .data").

interface ScoreBreakdownComponent {
  label: string;
  points: number;
  maxPoints: number;
  reason: string;
  hasData: boolean;
}

interface MasterReportShape {
  ok: true;
  timestamp: string;
  summary: {
    score: number;
    topAlert: string;
    topOpportunity: string;
    topRisk: string;
    scoreBreakdown: ScoreBreakdownComponent[];
  };
  // Other sub-engine results are fetched but not rendered in this
  // first scoreboard surface · `/brain` extensions will consume them.
}

function NickHealthSection() {
  const [data, setData] = useState<MasterReportShape | null>(null);
  const [bridgeOk, setBridgeOk] = useState<"loading" | "ok" | "down">("loading");
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/nickstire/query?q=master_report");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (cancelled) return;
        // Bridge proxy returns { data, query, timestamp } on success
        // or { error } on failure. Then the inner `data` is the
        // handler return: { ok: true, summary, ... } OR { ok: false }.
        const payload = json?.data;
        if (!payload || payload.ok !== true) {
          setBridgeOk("down");
          return;
        }
        setData(payload as MasterReportShape);
        setBridgeOk("ok");
      } catch {
        if (!cancelled) setBridgeOk("down");
      }
    };
    void load();
    // Refresh every 2 minutes · matches the nickstire 60s memoize
    // cache on master_report + adds 60s breathing room.
    const id = setInterval(load, 120_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Self-hide when bridge is unreachable or hasn't responded yet.
  // No loading skeleton · this surface is a bonus · the rest of the
  // page already renders.
  if (bridgeOk !== "ok" || !data) return null;

  const score = data.summary.score;
  const scoreLabel = score >= 80 ? "STRONG" : score >= 60 ? "OK" : score >= 40 ? "MIXED" : "WEAK";
  const scoreColor = score >= 80
    ? "text-emerald-300"
    : score >= 60
    ? "text-white"
    : score >= 40
    ? "text-amber-300"
    : "text-red-300";

  // Per-component breakdown sorted by impact (largest absolute
  // contribution first) so the operator scans top-to-bottom.
  const breakdown = [...(data.summary.scoreBreakdown ?? [])].sort(
    (a, b) => Math.abs(b.points) - Math.abs(a.points),
  );

  return (
    <section className="mt-6 space-y-3">
      <MasterySectionLabel label="Nick · shop health" />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Business Health Score */}
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
          <p className="text-[10px] uppercase tracking-[0.18em] text-white/40 mb-2">
            Business Health
          </p>
          <div className="flex items-baseline gap-2">
            <p className={`text-3xl font-medium tabular-nums ${scoreColor}`}>{score}</p>
            <span className={`text-[10px] uppercase tracking-wider ${scoreColor}`}>{scoreLabel}</span>
          </div>
        </div>

        {/* Top Alert · amber tint matches anomalous card pattern */}
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.04] p-4">
          <p className="text-[10px] uppercase tracking-[0.18em] text-amber-300/70 mb-2">
            Top Alert
          </p>
          <p className="text-[13px] text-amber-100 leading-snug line-clamp-3">
            {data.summary.topAlert || "—"}
          </p>
        </div>

        {/* Top Opportunity · emerald tint */}
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.04] p-4">
          <p className="text-[10px] uppercase tracking-[0.18em] text-emerald-300/70 mb-2">
            Top Opportunity
          </p>
          <p className="text-[13px] text-emerald-100 leading-snug line-clamp-3">
            {data.summary.topOpportunity || "—"}
          </p>
        </div>

        {/* Top Risk · amber tint (medium severity) */}
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
          <p className="text-[10px] uppercase tracking-[0.18em] text-white/40 mb-2">
            Top Risk
          </p>
          <p className="text-[13px] text-white/80 leading-snug line-clamp-3">
            {data.summary.topRisk || "—"}
          </p>
        </div>
      </div>

      {/* Collapsible 13-signal breakdown */}
      {breakdown.length > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-[10px] uppercase tracking-[0.18em] text-white/40 hover:text-white/70 transition-colors"
        >
          {expanded ? "− Hide" : "+ Show"} 13-signal breakdown
        </button>
      )}
      {expanded && breakdown.length > 0 && (
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5">
          {breakdown.map((c, i) => (
            <div key={`${c.label}-${i}`} className="flex items-start gap-3 py-1">
              <span
                className={[
                  "font-mono font-medium text-xs w-12 text-right shrink-0 tabular-nums",
                  !c.hasData
                    ? "text-white/30"
                    : c.points > 0
                    ? "text-emerald-300"
                    : c.points < 0
                    ? "text-red-300"
                    : "text-white/50",
                ].join(" ")}
              >
                {!c.hasData ? "—" : `${c.points > 0 ? "+" : ""}${c.points}`}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-[12px] font-medium text-white/85">{c.label}</span>
                  <span className="text-[9px] text-white/30 font-mono">±{c.maxPoints}</span>
                </div>
                <div className="text-[10px] text-white/40 leading-tight line-clamp-2">{c.reason}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Footer({
  composedAt,
  lastBriefAt,
}: {
  composedAt: string;
  lastBriefAt: string | null;
}) {
  const composed = new Date(composedAt).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  const brief = lastBriefAt
    ? new Date(lastBriefAt).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "no brief yet";
  return (
    <p className="mt-12 text-[10px] uppercase tracking-[0.22em] text-white/30 flex items-center justify-between">
      <span>composed · {composed}</span>
      <span>brief · {brief}</span>
    </p>
  );
}

// SkeletonView + ErrorView extracted to components/mastery/ on 2026-05-18 ·
// see MasterySkeleton + MasteryErrorView. Same primitives the /goals page
// uses now, with different cards/maxWidth/gridClass per surface needs.
