"use client";

/**
 * ToolUsageCensusPanel — BDN-202's surface (2026-08-13).
 *
 * The tool catalog only grows; nothing measured whether tools earn
 * their place. This renders never-invoked / high-failure / stale over
 * TOOL_CATALOG × tool_telemetry, with the confound DISCLOSED on
 * screen: a zero is pruner-visibility-confounded, so this panel says
 * "never invoked", never "useless". Report page first — no automation
 * hangs off these readings (the BDN-101 discipline).
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { AlertCircle, Wrench } from "lucide-react";
import { cn } from "@/lib/utils/cn";

type Bucket = "highFailure" | "neverInvoked" | "surfacedNeverChosen" | "neverSurfaced" | "stale";

const BUCKETS: Array<{ key: Bucket; label: string; tone: string; needsSurfacing?: boolean }> = [
  { key: "highFailure", label: "failing", tone: "text-rose-300" },
  { key: "neverInvoked", label: "never invoked", tone: "text-amber-300" },
  // 2026-08-25 · the confound split. Only rendered once `tool.surfaced`
  // rows exist (surfacedWindow.turns > 0) — an absent instrument must not
  // read as a measured zero.
  { key: "surfacedNeverChosen", label: "offered, never chosen", tone: "text-amber-300", needsSurfacing: true },
  { key: "neverSurfaced", label: "never offered", tone: "text-fg-secondary", needsSurfacing: true },
  { key: "stale", label: "stale 30d+", tone: "text-fg-secondary" },
];

export function ToolUsageCensusPanel() {
  const censusQ = trpc.system.toolUsageCensus.useQuery(undefined, { staleTime: 60_000 });
  // A failing WRITER is why a census zero may be a floor rather than a finding.
  // Read separately so a failure here degrades to "unknown", never to a green.
  // Health, not just failures: the failures view could only name what FAILED to
  // write, so an instrument that never wrote, stopped, or wrote one row in 253
  // turns looked identical to a healthy one. `attention` carries all five
  // states; FAILING keeps its own render below because it means the counts on
  // this panel are floors, which the other states do not imply.
  const instrumentsQ = trpc.system.instrumentHealth.useQuery(undefined, { staleTime: 60_000 });
  const [bucket, setBucket] = useState<Bucket>("highFailure");

  if (censusQ.isLoading) {
    return (
      <section aria-label="tool-usage-census" className="rounded-surface border border-edge-subtle p-4 space-y-2">
              <div className="h-3 w-40 rounded bg-surface-interactive animate-pulse" />
        <div className="h-20 rounded bg-surface-interactive animate-pulse" />
      </section>
    );
  }
  if (censusQ.isError || !censusQ.data) {
    return (
      <section aria-label="tool-usage-census" className="rounded-surface border border-red-500/15 bg-red-500/5 p-4">
        <p className="text-[11px] text-red-400 flex items-center gap-1.5">
          <AlertCircle className="h-3.5 w-3.5" />
          Tool census couldn&apos;t load — usage state unknown, not healthy.
        </p>
      </section>
    );
  }

  const c = censusQ.data;
  const attention = instrumentsQ.data?.attention ?? [];
  const failing = attention.filter((r) => r.status === "FAILING");
  const silent = attention.filter((r) => r.status !== "FAILING");
  const hasSurfacing = c.surfacedWindow.turns > 0;
  const visibleBuckets = BUCKETS.filter((b) => !b.needsSurfacing || hasSurfacing);
  const rows = c[bucket];

  return (
    <section
      aria-label="tool-usage-census"
      className="rounded-surface border border-edge-subtle p-4 flex flex-col space-y-3"
    >
      <div className="flex items-center justify-between gap-2 flex-wrap border-b border-edge-subtle pb-2">
              <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg flex items-center gap-1.5">
          <Wrench className="h-3.5 w-3.5 text-fg-secondary" /> Tool Usage Census
        </p>
        <span className="text-[11px] font-mono text-fg-tertiary">
          {c.invokedCount}/{c.catalogSize} invoked · {c.highFailure.length} failing · {c.neverInvoked.length} never
        </span>
      </div>

      {/*
        INSTRUMENT HEALTH — rendered ONLY when something is actually failing.
        Every bucket below counts rows, so a dead writer does not make a number
        wrong, it makes it SMALL: a tool that could not be recorded reads as a
        tool nobody called. This panel already gates two buckets on
        `surfacedWindow.turns > 0` for that reason; this is the same guard for
        the writers themselves, named rather than inferred.
        Absent = nothing FAILED. It is not a health claim — see the reader's
        own caveat — so nothing renders in the quiet case.
      */}
      {failing.length > 0 && (
        <p
          data-testid="instrument-failures"
          className="flex items-start gap-1.5 rounded border border-rose-400/20 bg-rose-400/[0.04] px-2 py-1.5 text-[11px] font-mono text-rose-200"
        >
          <AlertCircle className="mt-[1px] h-3 w-3 shrink-0" />
          <span>
            {failing.length} instrument{failing.length === 1 ? "" : "s"} failed to write in the last
            24h — counts below are understated, not measured:{" "}
            {failing.map((f) => `${f.instrument} ×${f.failuresInWindow}`).join(" · ")}
            {instrumentsQ.data?.failuresTruncated ? " (capped — these are floors)" : ""}
          </span>
        </p>
      )}
      {/*
        The non-failing attention states. Amber, not rose: these do not make the
        counts below wrong, they make a CONCLUSION drawn from the instrument
        unsupported. `n/N` is writes over assistant turns in the window — the
        denominator rides with the number so "1" reads as 1-of-253, not as 1.
      */}
      {silent.length > 0 && (
        <p
          data-testid="instrument-attention"
          className="flex items-start gap-1.5 rounded border border-amber-400/20 bg-amber-400/[0.04] px-2 py-1.5 text-[11px] font-mono text-amber-200"
        >
          <AlertCircle className="mt-[1px] h-3 w-3 shrink-0" />
          <span>
            {silent.length} instrument{silent.length === 1 ? "" : "s"} cannot support a conclusion:{" "}
            {silent
              .map(
                (r) =>
                  `${r.instrument} ${r.status.toLowerCase()} ${r.writesInWindow}/${r.denominator?.count ?? instrumentsQ.data?.assistantTurns ?? "?"}` +
                  (r.conditional ? " (conditional)" : ""),
              )
              .join(" · ")}
          </span>
        </p>
      )}

      <div className="flex gap-1.5" role="tablist" aria-label="census buckets">
        {visibleBuckets.map((b) => (
          <button
            key={b.key}
            role="tab"
            aria-selected={bucket === b.key}
            onClick={() => setBucket(b.key)}
            className={cn(
              "min-h-[32px] px-2.5 rounded border text-[11px] font-mono",
              bucket === b.key
                ? "border-edge-default bg-surface-interactive text-fg"
                : "border-edge-subtle text-fg-tertiary hover:text-fg",
            )}
          >
            {b.label} ({c[b.key].length})
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="text-[11px] text-fg-tertiary">Nothing in this bucket.</p>
      ) : (
        <ul className="space-y-1.5 max-h-[300px] overflow-y-auto scrollbar-thin">
          {rows.map((t) => (
            <li key={t.name} className="flex items-start gap-2 p-2 rounded bg-surface-interactive border border-edge-subtle">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-mono text-fg truncate">{t.name}</span>
                  <span className="text-[11px] font-mono text-fg-tertiary border border-edge-subtle rounded px-1 py-px">
                    {t.category}
                  </span>
                  {t.successRatePct !== null && (
                    <span
                      className={cn(
                        "text-[11px] font-mono",
                        t.successRatePct < 60 ? "text-rose-300" : "text-fg-secondary",
                      )}
                    >
                      {t.successRatePct}% ok · {t.totalCalls} calls
                    </span>
                  )}
                  {t.surfacedCount !== null && (
                    <span className="text-[11px] font-mono text-fg-tertiary">
                      offered {t.surfacedCount}×
                    </span>
                  )}
                  {/* Rendered ONLY when measured. `chosenCount === null` means
                      the tool.chosen lane has no measured turns yet — showing a
                      "0×" there would be the measured-zero lie this panel
                      exists to avoid. */}
                  {t.chosenCount !== null && (
                    <span className="text-[11px] font-mono text-fg-tertiary">
                      chosen {t.chosenCount}×
                    </span>
                  )}
                </div>
                {t.lastError && (
                  <p className="text-[11px] text-fg-tertiary leading-snug mt-0.5 break-words line-clamp-2">
                    {t.lastError}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="border-t border-edge-subtle pt-2 text-[11px] text-fg-tertiary leading-snug">
        {hasSurfacing ? (
          <>
            Surfacing measured over {c.surfacedWindow.turns} turns / {c.surfacedWindow.windowDays}d
            {c.surfacedWindow.since ? ` since ${c.surfacedWindow.since.slice(0, 10)}` : ""}
            {c.chosenWindow.turns > 0
              ? ` · choices measured over ${c.chosenWindow.turns} turns${
                  c.chosenWindow.blindTurns > 0
                    ? ` (${c.chosenWindow.blindTurns} blind turns excluded)`
                    : ""
                }`
              : " · choice data not measured yet"} · {c.caveat}
          </>
        ) : (
          c.caveat
        )}
      </p>
    </section>
  );
}
