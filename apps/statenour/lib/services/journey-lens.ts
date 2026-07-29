/**
 * lib/services/journey-lens.ts — Wave-6 (2026-07-29).
 *
 * The Journey lens: "who was I becoming" over months, not just today's
 * dashboard. The 06-10 evolution audit named chronological blindness as
 * THE 3-year moat gap ("architecturally rich but chronologically
 * blind") — identity history, XP events, anti-pattern revisit counts,
 * and graduated skills all EXIST; no surface ever compared across time.
 * Pure lens over existing rows — zero new capture, zero migrations.
 *
 * Honesty rules: every section carries enoughData + since + source;
 * growth against a zero prior renders as null (no fake infinities);
 * empty data is stated, never dramatized.
 */
import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { loadIdentityHistory } from "@/lib/brain/identity-snapshot";
import { xpEventTotalsSince } from "@/lib/mastery/credit";

export interface JourneySection<T> {
  enoughData: boolean;
  since: string;
  source: string;
  data: T;
}

export interface IdentityDelta {
  axis: string;
  from: number;
  to: number;
  delta: number;
}

export interface JourneyLens {
  identity: JourneySection<IdentityDelta[]>;
  xp: JourneySection<{ current30: number; prior30: number; growthPct: number | null }>;
  enemies: JourneySection<Array<{ name: string; revisits: number }>>;
  skills: JourneySection<Array<{ name: string; timesFired: number }>>;
}

/**
 * Pure: earliest vs latest snapshot per axis, top movers first.
 * Exported for tests. Requires the two snapshots to be ≥ minSpanDays
 * apart before claiming enough data — a two-day-old system comparing
 * "3 months ago" would be theater.
 */
export function identityDeltas(
  history: Array<{ date: string; axes: Partial<Record<string, number>> }>,
  minSpanDays = 30,
): { deltas: IdentityDelta[]; spanDays: number } {
  if (history.length < 2) return { deltas: [], spanDays: 0 };
  const first = history[0];
  const last = history[history.length - 1];
  const spanDays = Math.round(
    (new Date(last.date).getTime() - new Date(first.date).getTime()) / 86_400_000,
  );
  if (spanDays < minSpanDays) return { deltas: [], spanDays };
  const axes = new Set([...Object.keys(first.axes), ...Object.keys(last.axes)]);
  const deltas: IdentityDelta[] = [];
  for (const axis of axes) {
    const from = first.axes[axis];
    const to = last.axes[axis];
    if (typeof from !== "number" || typeof to !== "number") continue;
    deltas.push({
      axis,
      from: Math.round(from * 10) / 10,
      to: Math.round(to * 10) / 10,
      delta: Math.round((to - from) * 10) / 10,
    });
  }
  deltas.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return { deltas: deltas.slice(0, 4), spanDays };
}

/** Pure: growth of current vs prior window. Null when the prior window
 *  is empty — a percentage against zero is a lie. Exported for tests. */
export function xpGrowthPct(current30: number, prior30: number): number | null {
  if (prior30 <= 0) return null;
  return Math.round(((current30 - prior30) / prior30) * 1000) / 10;
}

const sumMap = (m: Map<string, number>) => [...m.values()].reduce((s, v) => s + v, 0);

export async function buildJourneyLens(): Promise<JourneyLens> {
  const now = Date.now();
  const d30 = new Date(now - 30 * 86_400_000);
  const d60 = new Date(now - 60 * 86_400_000);

  const [history, since30, since60, antiPatterns, skills] = await Promise.all([
    loadIdentityHistory(90).catch(() => []),
    xpEventTotalsSince(d30).catch(() => new Map<string, number>()),
    xpEventTotalsSince(d60).catch(() => new Map<string, number>()),
    prisma.brainMemory.findMany({
      where: { category: BRAIN_CATEGORIES.ANTI_PATTERN, deletedAt: null },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: { content: true, metadata: true },
    }),
    prisma.brainMemory.findMany({
      where: { category: BRAIN_CATEGORIES.SKILL, deletedAt: null },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: { content: true, metadata: true },
    }),
  ]);

  const { deltas, spanDays } = identityDeltas(history);
  const current30 = sumMap(since30);
  const prior30 = Math.max(0, sumMap(since60) - current30);

  const enemies = antiPatterns
    .map((r) => ({
      name: r.content.slice(0, 120),
      revisits: Number((r.metadata as { revisitCount?: number } | null)?.revisitCount ?? 0),
    }))
    .filter((e) => e.revisits >= 2)
    .sort((a, b) => b.revisits - a.revisits)
    .slice(0, 3);

  const graduated = skills
    .map((r) => ({
      name: r.content.slice(0, 120),
      timesFired: Number((r.metadata as { times_fired?: number } | null)?.times_fired ?? 0),
    }))
    .filter((s) => s.timesFired >= 5)
    .sort((a, b) => b.timesFired - a.timesFired)
    .slice(0, 3);

  return {
    identity: {
      enoughData: deltas.length > 0,
      since: `${spanDays}d span`,
      source: "identity_snapshot history rows",
      data: deltas,
    },
    xp: {
      enoughData: current30 > 0 || prior30 > 0,
      since: "30d vs prior 30d",
      source: "mastery_xp_event totals",
      data: { current30, prior30, growthPct: xpGrowthPct(current30, prior30) },
    },
    enemies: {
      enoughData: enemies.length > 0,
      since: "all time",
      source: "anti_pattern revisitCount",
      data: enemies,
    },
    skills: {
      enoughData: graduated.length > 0,
      since: "all time",
      source: "skill times_fired ≥ 5",
      data: graduated,
    },
  };
}
