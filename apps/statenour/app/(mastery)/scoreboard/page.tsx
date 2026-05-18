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

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

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
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSnapshot = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/scoreboard/snapshot");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      setData((await res.json()) as Snapshot);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSnapshot();
  }, [fetchSnapshot]);

  if (loading && !data) return <SkeletonView />;
  if (error)
    return <ErrorView error={error} onRetry={() => void fetchSnapshot()} />;
  if (!data) return null;

  const anomalies = data.numbers.filter((n) => n.anomalous);
  const anchors = data.numbers.filter((n) => !n.anomalous);

  return (
    <main className="min-h-[100dvh] bg-[#0A0A0A] text-white">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
        <Header state={data.state} lastBriefAt={data.lastBriefAt} />

        {anomalies.length > 0 ? (
          <section className="mt-6">
            <h2 className="text-[10px] uppercase tracking-[0.22em] text-amber-300/80 mb-3">
              Anomalous · {anomalies.length}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {anomalies.map((n) => (
                <Card key={n.key} number={n} />
              ))}
            </div>
          </section>
        ) : null}

        <section className="mt-6">
          <h2 className="text-[10px] uppercase tracking-[0.22em] text-white/40 mb-3">
            Anchors · {anchors.length}
          </h2>
          {anchors.length === 0 ? (
            <p className="text-sm text-white/50">No anchor numbers right now.</p>
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
  lastBriefAt,
}: {
  state: "calm" | "alive";
  lastBriefAt: string | null;
}) {
  return (
    <header className="flex items-start justify-between gap-4">
      <div>
        <p className="text-xs uppercase tracking-[0.18em] text-white/40 mb-1">
          What matters now
        </p>
        <h1 className="text-2xl font-medium">Scoreboard</h1>
      </div>
      <span
        className={[
          "inline-flex items-center px-3 py-1 rounded-full text-[10px] uppercase tracking-wider",
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
  if (number.link) {
    return (
      <Link href={number.link} className="block">
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

function SkeletonView() {
  return (
    <main className="min-h-[100dvh] bg-[#0A0A0A] text-white">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <div className="h-3 w-24 bg-white/5 rounded mb-3" />
        <div className="h-7 w-40 bg-white/10 rounded mb-8" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="rounded-lg border border-white/5 p-4">
              <div className="h-3 w-1/3 bg-white/10 rounded mb-3" />
              <div className="h-8 w-1/2 bg-white/5 rounded" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

function ErrorView({
  error,
  onRetry,
}: {
  error: string;
  onRetry: () => void;
}) {
  return (
    <main className="min-h-[100dvh] bg-[#0A0A0A] text-white flex items-center justify-center px-6">
      <div className="max-w-md text-center">
        <p className="text-xs uppercase tracking-[0.18em] text-white/40 mb-3">
          Scoreboard
        </p>
        <p className="text-sm text-red-300">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-6 inline-flex items-center px-4 py-2 rounded border border-white/15 text-sm hover:bg-white/[0.04]"
        >
          retry
        </button>
      </div>
    </main>
  );
}
