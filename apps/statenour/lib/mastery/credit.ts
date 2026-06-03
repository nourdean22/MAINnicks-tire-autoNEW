/**
 * Mastery XP credit · Slice 2 · 2026-05-30
 *
 * The write side of the leveling engine for NON-task signals (habits,
 * journal, chat, email, decisions). Schema-free: each credit is one
 * BrainMemory(category="mastery_xp_event") row, idempotent by sourceKey
 * — re-crediting the same source overwrites instead of double-counting.
 * This doubles as the "+XP feed" (query recent rows) and the dedup log.
 *
 * Task completions stay where they are (MasteryScore.delta, written live
 * by auto-learn) so we never double-count; the character sheet sums both.
 */
import { prisma } from "@/lib/prisma";
import type { MasterySignal } from "./leveling";

export const MASTERY_XP_CATEGORY = "mastery_xp_event";

export interface XpCredit {
  /** Domain key the XP applies to (must be a DOMAINS key). */
  stat: string;
  xp: number;
  signal: MasterySignal;
  /** ≤120-char human "why" — shown in the +XP feed. */
  evidence: string;
  /** Stable per-source id for dedup, e.g. `journal:<entryId>`. */
  sourceKey: string;
  /** Optional · stamps `metadata.backfillRun = <tag>` on NEWLY-created rows
   *  only (preserved across re-runs, NEVER added to a live-credited row on
   *  update) so a backfill run is cleanly reversible via `revertBackfillRun`
   *  without ever deleting a row some live code path created. */
  backfillRun?: string;
}

/**
 * Credit XP to a stat. Idempotent per sourceKey. Returns true when this
 * was a NEW credit (so a backfill can count how much it actually added).
 * Fire-and-forget safe: never throws.
 */
export async function creditStatXp(ev: XpCredit): Promise<boolean> {
  if (ev.xp <= 0 || !ev.stat) return false;
  const key = ev.sourceKey;
  // `existing` powers the was-new return (below) — a BEST-EFFORT flag for a
  // backfill's "added N" count. The upsert is idempotent on (category,key) so
  // stored XP can NEVER double-count; under rare concurrent credits of the
  // SAME sourceKey the flag can over-report (both see existing===null), but the
  // XP stays correct. Left as findUnique+upsert deliberately: this contract is
  // pinned by credit-task-stats.test, and a create+catch-P2002 rewrite buys
  // only an exact concurrent count — negligible for a single-user app.
  const existing = await prisma.brainMemory
    .findUnique({
      where: { category_key: { category: MASTERY_XP_CATEGORY, key } },
      select: { id: true, metadata: true },
    })
    .catch(() => null);
  // Backfill-run marker is stamped ONLY on create, and PRESERVED (never newly
  // added) on update — so re-running a backfill keeps its own rows marked, but
  // a backfill that idempotently re-credits a LIVE row (e.g. a task's
  // goal-task: key) can never mis-mark that live row for deletion.
  const priorRun =
    (existing?.metadata as { backfillRun?: string } | null)?.backfillRun;
  const createMeta: Record<string, unknown> = { stat: ev.stat, xp: ev.xp, signal: ev.signal };
  if (ev.backfillRun) createMeta.backfillRun = ev.backfillRun;
  const updateMeta: Record<string, unknown> = { stat: ev.stat, xp: ev.xp, signal: ev.signal };
  if (priorRun) updateMeta.backfillRun = priorRun;
  await prisma.brainMemory
    .upsert({
      where: { category_key: { category: MASTERY_XP_CATEGORY, key } },
      create: {
        category: MASTERY_XP_CATEGORY,
        key,
        content: ev.evidence.slice(0, 280),
        source: "mastery-xp",
        createdBy: "system",
        metadata: createMeta as object,
      },
      update: {
        content: ev.evidence.slice(0, 280),
        metadata: updateMeta as object,
      },
    })
    .catch(() => {});
  return existing === null;
}

// 2026-06-01 · stat→XP totals. The event log can grow unbounded (every
// completion now credits), and these run on the hot character-sheet read.
// Sum DB-side (GROUP BY → ~33 rows) instead of streaming every row into JS.
// `jsonb_typeof` guards mirror the JS `typeof` checks EXACTLY so the two
// paths agree. On ANY error the SQL path returns null and we fall back to the
// proven JS scan — a column rename or cast surprise can never break the sheet.

async function sumStatXpSql(since?: Date): Promise<Map<string, number> | null> {
  try {
    const rows = since
      ? await prisma.$queryRaw<{ stat: string; xp: number }[]>`
          SELECT metadata->>'stat' AS stat, SUM((metadata->>'xp')::float8) AS xp
          FROM brain_memories
          WHERE category = ${MASTERY_XP_CATEGORY}
            AND created_at >= ${since}
            AND jsonb_typeof(metadata->'stat') = 'string'
            AND jsonb_typeof(metadata->'xp') = 'number'
          GROUP BY metadata->>'stat'`
      : await prisma.$queryRaw<{ stat: string; xp: number }[]>`
          SELECT metadata->>'stat' AS stat, SUM((metadata->>'xp')::float8) AS xp
          FROM brain_memories
          WHERE category = ${MASTERY_XP_CATEGORY}
            AND jsonb_typeof(metadata->'stat') = 'string'
            AND jsonb_typeof(metadata->'xp') = 'number'
          GROUP BY metadata->>'stat'`;
    const totals = new Map<string, number>();
    for (const r of rows) {
      if (typeof r.stat === "string") totals.set(r.stat, Number(r.xp) || 0);
    }
    return totals;
  } catch {
    return null; // fall back to the JS scan
  }
}

/** JS fallback — the original findMany + sum. Matches sumStatXpSql exactly. */
async function sumStatXpJs(since?: Date): Promise<Map<string, number>> {
  const rows = await prisma.brainMemory
    .findMany({
      where: since
        ? { category: MASTERY_XP_CATEGORY, createdAt: { gte: since } }
        : { category: MASTERY_XP_CATEGORY },
      select: { metadata: true },
    })
    .catch((): { metadata: unknown }[] => []);
  const totals = new Map<string, number>();
  for (const r of rows) {
    const m = (r.metadata ?? {}) as { stat?: string; xp?: number };
    if (typeof m.stat === "string" && typeof m.xp === "number") {
      totals.set(m.stat, (totals.get(m.stat) ?? 0) + m.xp);
    }
  }
  return totals;
}

/** Lifetime XP per stat from the XP-event log (every non-task signal). */
export async function xpEventTotals(): Promise<Map<string, number>> {
  return (await sumStatXpSql()) ?? (await sumStatXpJs());
}

/** XP per stat from the event log, but only events CREATED since `since`.
 *  Powers the "rising this week" slope — new momentum, not lifetime total. */
export async function xpEventTotalsSince(
  since: Date,
): Promise<Map<string, number>> {
  return (await sumStatXpSql(since)) ?? (await sumStatXpJs(since));
}

/**
 * Reverse a backfill run · hard-deletes every `mastery_xp_event` row stamped
 * with this `backfillRun` tag — i.e. ONLY rows the run itself CREATED (live
 * code paths never stamp the marker, so their rows are untouched). XP events
 * are fully recomputable, so a hard delete is clean + safe. Returns the count
 * removed. The character sheet re-sums from the surviving rows on next read.
 */
/**
 * Inspect a backfill run's ACTUAL footprint in prod — counts the
 * mastery_xp_event rows it created (`metadata.backfillRun = runTag`) and sums
 * their XP per stat. Read-only. This is the runtime-observable proof that a
 * run's credits landed (and into which stats), distinct from `measureBackfill`
 * which counts what's left to do.
 */
export async function summarizeBackfillRun(
  runTag: string,
): Promise<{ count: number; xpTotal: number; byStat: Record<string, number> }> {
  const rows = await prisma.brainMemory
    .findMany({
      where: {
        category: MASTERY_XP_CATEGORY,
        metadata: { path: ["backfillRun"], equals: runTag },
      },
      select: { metadata: true },
    })
    .catch(() => [] as { metadata: unknown }[]);
  const byStat: Record<string, number> = {};
  let xpTotal = 0;
  for (const r of rows) {
    const m = (r.metadata ?? {}) as { stat?: string; xp?: number };
    if (typeof m.stat === "string" && typeof m.xp === "number") {
      byStat[m.stat] = Math.round(((byStat[m.stat] ?? 0) + m.xp) * 10) / 10;
      xpTotal = Math.round((xpTotal + m.xp) * 10) / 10;
    }
  }
  return { count: rows.length, xpTotal, byStat };
}

export async function revertBackfillRun(runTag: string): Promise<number> {
  if (!runTag) return 0;
  const res = await prisma.brainMemory
    .deleteMany({
      where: {
        category: MASTERY_XP_CATEGORY,
        metadata: { path: ["backfillRun"], equals: runTag },
      },
    })
    .catch(() => ({ count: 0 }));
  return res.count;
}
