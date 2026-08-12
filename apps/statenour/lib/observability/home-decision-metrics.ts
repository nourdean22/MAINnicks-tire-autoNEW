/**
 * Home decision metrics — BDN-104 (2026-08-12).
 *
 * The compact-Home composition (BDN-001) shipped in #1539 with a cheap
 * test specified — time-to-first-action, verdict rate, resume success —
 * and no sensor to run it with. That matters beyond this one feature:
 * the calibration ledger's rule 3 says downgrade a finding whose cheap
 * test fails, and an UNRUN test silently masquerades as a pass. This is
 * the sensor, so the ledger can say "worked" or "didn't" instead of
 * "shipped".
 *
 * Deliberately narrow: DECISION signals only (verdicts, resume taps) —
 * not expander opens, not scroll, not page views. A record-everything
 * capture layer is exactly what this system has committed against.
 * Signals land as AuditEvent rows (`home:signal`), which data-cleanup
 * already prunes on its 90-day tier — no new table, no new retention
 * policy.
 */

import { prisma } from "@/lib/prisma";

export const HOME_SIGNAL_KINDS = [
  "verdict_accept", // proposal accepted
  "verdict_dismiss", // proposal dismissed
  "followup_convert", // follow-up → task
  "followup_dismiss", // follow-up dismissed
  "resume_tap", // resumed an open loop from the matrix
] as const;

export type HomeSignalKind = (typeof HOME_SIGNAL_KINDS)[number];

export interface HomeDecisionMetrics {
  windowDays: number;
  total: number;
  byKind: Record<string, number>;
  verdicts: number;
  resumes: number;
  /** Days in the window with ≥1 decision — the "did Home get used" number. */
  activeDays: number;
  /** True while n is too small to read anything into. */
  underSampled: boolean;
  note: string | null;
  computedAt: string;
}

const MIN_SIGNALS_FOR_READING = 10;

/** PURE — fold raw signal rows into the metrics. Exported for the pin. */
export function summarizeHomeSignals(
  rows: Array<{ kind: string; createdAt: Date }>,
  windowDays: number,
): HomeDecisionMetrics {
  const byKind: Record<string, number> = {};
  const days = new Set<string>();
  for (const r of rows) {
    byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
    days.add(r.createdAt.toISOString().slice(0, 10));
  }
  const verdicts =
    (byKind.verdict_accept ?? 0) +
    (byKind.verdict_dismiss ?? 0) +
    (byKind.followup_convert ?? 0) +
    (byKind.followup_dismiss ?? 0);
  const resumes = byKind.resume_tap ?? 0;
  const total = rows.length;
  const underSampled = total < MIN_SIGNALS_FOR_READING;
  return {
    windowDays,
    total,
    byKind,
    verdicts,
    resumes,
    activeDays: days.size,
    underSampled,
    note: underSampled
      ? total === 0
        ? "No Home decisions recorded yet — instrumentation began 2026-08-12. Empty here means unmeasured, not unused."
        : `Only ${total} signals — below the ${MIN_SIGNALS_FOR_READING}-signal floor; treat these counts as anecdote, not measurement.`
      : null,
    computedAt: new Date().toISOString(),
  };
}

/** Fire-and-forget writer. Never throws — telemetry must not break a tap. */
export async function recordHomeSignal(kind: HomeSignalKind): Promise<void> {
  await prisma.auditEvent
    .create({
      data: {
        actor: "operator",
        eventType: "home:signal",
        detail: kind,
        payload: { kind, at: new Date().toISOString() },
      },
    })
    .catch(() => undefined);
}

export async function buildHomeDecisionMetrics(windowDays = 7): Promise<HomeDecisionMetrics> {
  const since = new Date(Date.now() - windowDays * 86_400_000);
  const rows = await prisma.auditEvent.findMany({
    where: { eventType: "home:signal", createdAt: { gte: since } },
    select: { detail: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 1000,
  });
  return summarizeHomeSignals(
    rows.map((r) => ({ kind: r.detail ?? "unknown", createdAt: r.createdAt })),
    windowDays,
  );
}
