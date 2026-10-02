"use client";

/**
 * WiringCensusPanel — BDN-101's surface (2026-08-12).
 *
 * Dead lanes emit no errors, only silence, and silence reads as health
 * everywhere else in the app. This panel is the one place where "a
 * producer is live and its consumer is missing" is a LOUD state.
 *
 * Honest-states contract: loading → skeleton, failure → FAILURE (unknown
 * ≠ empty), and the census's own uncovered lane classes are DISCLOSED on
 * screen rather than implied to be covered.
 */

import { trpc } from "@/lib/trpc/client";
import { AlertCircle, Cable } from "lucide-react";
import { cn } from "@/lib/utils/cn";

const STATUS_STYLE: Record<string, { dot: string; text: string }> = {
  severed: { dot: "bg-rose-500", text: "text-rose-300" },
  backlog: { dot: "bg-rose-400", text: "text-rose-300" },
  unknown: { dot: "bg-fg-tertiary", text: "text-fg-secondary" },
  never: { dot: "bg-amber-400", text: "text-amber-300" },
  silent: { dot: "bg-amber-400", text: "text-amber-300" },
  quiet: { dot: "bg-fg-tertiary", text: "text-fg-secondary" },
  flowing: { dot: "bg-emerald-400", text: "text-emerald-300" },
};

/** Statuses that mean "look at this now" — they lift to the top strip. */
const ATTENTION = new Set(["severed", "backlog", "unknown", "never", "silent"]);

export function WiringCensusPanel() {
  const censusQ = trpc.system.wiringCensus.useQuery(undefined, { staleTime: 60_000 });

  if (censusQ.isLoading) {
    return (
      <section aria-label="wiring-census" className="rounded-surface border border-edge-subtle p-4 space-y-2">
              <div className="h-3 w-40 rounded-micro bg-surface-interactive animate-pulse" />
        <div className="h-20 rounded-micro bg-surface-interactive animate-pulse" />
      </section>
    );
  }
  if (censusQ.isError) {
    return (
      <section aria-label="wiring-census" className="rounded-surface border border-red-500/15 bg-red-500/5 p-4">
        <p className="text-[11px] text-red-400 flex items-center gap-1.5">
          <AlertCircle className="h-3.5 w-3.5" />
          Wiring census couldn&apos;t load — lane state unknown, not healthy.
        </p>
      </section>
    );
  }

  const lanes = censusQ.data?.lanes ?? [];
  const attention = lanes.filter((l) => ATTENTION.has(l.status));
  const healthy = lanes.length - attention.length;

  return (
    <section
      aria-label="wiring-census"
      className="rounded-surface border border-edge-subtle p-4 flex flex-col space-y-3"
    >
      <div className="flex items-center justify-between gap-2 flex-wrap border-b border-edge-subtle pb-2">
              <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg flex items-center gap-1.5">
          <Cable className="h-3.5 w-3.5 text-fg-secondary" /> Wiring Census
        </p>
        <span className="text-[11px] font-mono text-fg-tertiary">
          {lanes.length} lanes · {attention.length} need a look · {healthy} flowing or idle
        </span>
      </div>

      {lanes.length === 0 ? (
        <p className="text-[11px] text-fg-tertiary">No lanes derived — the registries returned nothing, which is itself unexpected.</p>
      ) : (
        <ul className="space-y-1.5 max-h-[360px] overflow-y-auto scrollbar-thin">
          {lanes.map((lane) => {
            const s = STATUS_STYLE[lane.status] ?? STATUS_STYLE.unknown;
            return (
              <li
                key={`${lane.laneClass}:${lane.id}`}
                className="flex items-start gap-2 p-2 rounded-micro bg-surface-interactive border border-edge-subtle"
              >
                <span aria-hidden className={cn("mt-1.5 inline-block h-1.5 w-1.5 rounded-full shrink-0", s.dot)} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-mono text-fg truncate">{lane.id}</span>
                    <span className={cn("font-mono text-[11px]", s.text)}>
                      {lane.status}
                    </span>
                    <span className="text-[11px] font-mono text-fg-tertiary border border-edge-subtle rounded-micro px-1 py-px">
                      {lane.laneClass}
                    </span>
                  </div>
                  <p className="text-[11px] text-fg-tertiary leading-snug mt-0.5 break-words">{lane.detail}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Scope disclosure — what this census does NOT watch, and where
          that coverage actually lives. An instrument that hides its own
          blind spots is the thing this panel exists to prevent. */}
      <details className="border-t border-edge-subtle pt-2">
              <summary className="font-mono text-[11px] text-fg-tertiary cursor-pointer hover:text-fg min-h-[32px] flex items-center">
          not covered here ({censusQ.data?.notCovered.length ?? 0})
        </summary>
        <ul className="mt-1 space-y-0.5">
          {censusQ.data?.notCovered.map((n) => (
            <li key={n.laneClass} className="text-[11px] text-fg-tertiary">
              <span className="text-fg-secondary">{n.laneClass}</span> → {n.coveredBy}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
