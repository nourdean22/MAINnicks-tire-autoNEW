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
 * Aesthetic: editorial-minimalist · matches /goals + /customer-360.
 * The page is a SINGLE-PAGE pull-anytime surface that complements
 * the morning brief push (Phase 5).
 *
 * Mobile: single column · cards stack · same value-first hierarchy.
 *
 * See: ADR-0011 · lib/services/meta-scoreboard.ts · /api/scoreboard/snapshot
 */

import Link from "next/link";
import { useAuthedFetch } from "@/hooks/use-authed-fetch";
import { MasteryErrorView } from "@/components/mastery/mastery-error-view";
import { MasterySkeleton } from "@/components/mastery/mastery-skeleton";
import { MasterySectionLabel } from "@/components/mastery/mastery-section-label";
// Phase E (2026-05-18 PM) · OperatorPulse · top anomaly + 7d motion +
// cross-surface trailing-axis drift. Right above the anomaly grid so
// the operator gets the action-forward narration BEFORE the raw numbers.
import { OperatorPulse } from "@/components/operator/operator-pulse";

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
  // Phase D follow-up audit (2026-05-18) · collapsed bespoke
  // fetch+state mgmt to the shared useAuthedFetch hook · pairs
  // with MasteryErrorView + MasterySkeleton. Same primitives now
  // used by /goals and the 3 /journal thread components.
  const { data, error, loading, reload } = useAuthedFetch<Snapshot>(
    "/api/scoreboard/snapshot",
  );

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
    return <MasteryErrorView label="Scoreboard" error={error} onRetry={reload} />;
  if (!data) return null;

  const anomalies = data.numbers.filter((n) => n.anomalous);
  const anchors = data.numbers.filter((n) => !n.anomalous);

  return (
    <main className="min-h-[100dvh] bg-[#0A0A0A] text-white">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
        <Header state={data.state} lastBriefAt={data.lastBriefAt} />

        {/* Phase E (2026-05-18 PM) · OperatorPulse · top anomaly narration
            + 7d motion across anchors + cross-surface trailing-axis drift.
            Sits between the state badge and the cards · gives the
            operator the "right now" story in one strip before the raw
            number grid. */}
        <OperatorPulse surface="scoreboard" className="mt-6 px-0 mx-0" />

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
