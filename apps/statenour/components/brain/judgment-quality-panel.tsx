"use client";

/**
 * JudgmentQualityPanel — BDN-105 + BDN-106 (2026-08-12).
 *
 * Two readings of the same question: is the machine's judgment any good?
 *   · the wisdom gate now curates PERMANENT memory unattended — trend
 *     its accept/reject/dupe mix (SPC, not per-unit inspection)
 *   · stated confidence on journal takes is now gradeable against real
 *     commitment outcomes
 *
 * Lives on /brain Continuity because both are memory-quality readings,
 * not ops readings — and because /system already carries three
 * instruments; a fourth would recreate the density problem BDN-001 was
 * about. Honest states throughout: an under-sampled reading SAYS it is
 * under-sampled instead of drawing a trend through noise.
 */

import { trpc } from "@/lib/trpc/client";
import { AlertCircle, Scale } from "lucide-react";

export function JudgmentQualityPanel() {
  const spcQ = trpc.system.wisdomGateSpc.useQuery(undefined, { staleTime: 300_000 });
  const calQ = trpc.system.takeCalibration.useQuery(undefined, { staleTime: 300_000 });

  if (spcQ.isLoading || calQ.isLoading) {
    return (
      <section aria-label="judgment-quality" className="rounded-xl border border-white/5 p-4 space-y-2">
        <div className="h-3 w-44 rounded bg-white/5 animate-pulse" />
        <div className="h-16 rounded bg-white/[0.03] animate-pulse" />
      </section>
    );
  }
  if (spcQ.isError || calQ.isError) {
    return (
      <section aria-label="judgment-quality" className="rounded-xl border border-red-500/15 bg-red-500/5 p-4">
        <p className="text-[11px] text-red-400 flex items-center gap-1.5">
          <AlertCircle className="h-3.5 w-3.5" />
          Judgment-quality readings couldn&apos;t load — state unknown, not empty.
        </p>
      </section>
    );
  }

  const spc = spcQ.data;
  const cal = calQ.data;

  return (
    <section
      aria-label="judgment-quality"
      className="rounded-xl border border-white/8 bg-white/[0.01] p-4 flex flex-col space-y-4"
    >
      <div className="flex items-center justify-between gap-2 border-b border-white/6 pb-2">
        <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-300 font-semibold flex items-center gap-1.5">
          <Scale className="h-3.5 w-3.5 text-[var(--gold)]/80" /> Judgment Quality
        </p>
      </div>

      {/* BDN-105 · wisdom gate */}
      <div className="space-y-1.5">
        <p className="text-[9px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">
          wisdom gate · promotion mix
        </p>
        {spc && spc.totals.total === 0 ? (
          <p className="text-[11px] text-zinc-500">
            No promotion attempts recorded in the last 8 weeks. The rule went unattended 2026-08-12 —
            the first runs land on tonight&apos;s engine pass.
          </p>
        ) : (
          <>
            <p className="text-[11px] text-zinc-400">
              {spc?.totals.promoted} promoted · {spc?.totals.gateRejected} gate-rejected ·{" "}
              {spc?.totals.dupeSkipped} dupe-skipped
              {(spc?.totals.failed ?? 0) > 0 && ` · ${spc?.totals.failed} failed`}
            </p>
            {(spc?.totals.parked ?? 0) > 0 && (
              <p className="text-[10px] text-amber-400/80">
                {spc?.totals.parked} attempt{spc?.totals.parked === 1 ? "" : "s"} never reached the
                gate — parked awaiting approval. Those are a wiring reading, not a quality one.
              </p>
            )}
            {spc?.underSampled && (
              <p className="text-[10px] text-amber-400/80">
                Under-sampled ({spc.decided} decided run{spc.decided === 1 ? "" : "s"}) — a shifting
                mix means nothing yet. Hand-audit the first promotions instead of reading this as a
                trend.
              </p>
            )}
            {!spc?.underSampled && (
              <ul className="space-y-0.5">
                {spc?.weeks.slice(0, 4).map((w) => (
                  <li key={w.weekStart} className="text-[10px] font-mono text-zinc-500">
                    {w.weekStart} · {w.promoted}✓ {w.gateRejected}✗ {w.dupeSkipped}⊘
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {/* BDN-106 · confidence calibration */}
      <div className="space-y-1.5 border-t border-white/6 pt-3">
        <p className="text-[9px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">
          stated confidence · vs outcomes
        </p>
        {cal?.note ? (
          <p className="text-[11px] text-zinc-500">{cal.note}</p>
        ) : (
          <ul className="space-y-0.5">
            {cal?.bands.map((b) => (
              <li key={b.band} className="text-[10px] font-mono text-zinc-400">
                {b.band.padEnd(4)} · {b.hitRate === null ? "n/a" : `${Math.round(b.hitRate * 100)}% kept`} (
                {b.kept}/{b.resolved})
                {b.unresolved > 0 && <span className="text-zinc-600"> · {b.unresolved} open</span>}
              </li>
            ))}
          </ul>
        )}
        <p className="text-[9px] text-zinc-600 leading-relaxed">
          If HIGH does not outperform LOW once this fills in, the confidence chip is decoration and
          should be retired rather than trusted.
        </p>
      </div>
    </section>
  );
}
