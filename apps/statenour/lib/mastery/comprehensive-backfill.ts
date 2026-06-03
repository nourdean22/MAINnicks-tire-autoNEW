/**
 * Comprehensive mastery-XP backfill · 2026-06-03
 *
 * Extends the recent-25 `backfillStatXp` into an ALL-TIME, ALL-SOURCE pass
 * that credits the operator's history into the 33-stat character sheet so the
 * board reads who he actually is — not just forward-counting from boot.
 *
 * SAFETY (database-architect lens · the whole game):
 *  · IDEMPOTENT — every credit rides `creditStatXp`'s upsert on a stable
 *    sourceKey. Re-runs never double-count; already-credited rows are skipped
 *    BEFORE the (costly) AI call, so a re-run is cheap.
 *  · NO DOUBLE-COUNT vs live paths — sources that already credit live (tasks
 *    via creditTaskStats, people via backfillPeopleXp, brain-dumps via
 *    journal-ingest) reuse the SAME sourceKeys, so a live row is a skip here.
 *  · REVERSIBLE — newly-created rows are stamped `metadata.backfillRun=<tag>`
 *    (create-only · see credit.ts); `revertBackfillRun(tag)` undoes exactly
 *    this run, never a live row.
 *  · NON-CIRCULAR — BrainMemory attribution is WHITELISTED to operator-signal
 *    categories; our own AI outputs (briefs, traces, the xp-event log itself)
 *    are excluded so we never attribute the system's own words.
 *
 * COST (performance lens): structured sources (body) are FREE (rule-based);
 * every other source is one cheap "reason"-tier `attributeText` call per
 * UNCREDITED item. `measureBackfill()` counts the uncredited items per source
 * WITHOUT any AI call, so the operator sees the call-count (≈ the spend)
 * before committing to the real run.
 *
 * Tasks: already credited live via `creditTaskStats` (goal-task:/task-stat:
 * keys) + auto-learn's MasteryScore.delta — NOT re-done here (would be a
 * near-total no-op). People: delegated to the existing idempotent
 * `backfillPeopleXp`. Knowledge files (filesystem): deferred (static low-
 * signal reference).
 */
import "server-only";

import { prisma } from "@/lib/prisma";
import { attributeText } from "./attribution";
import { creditStatXp, MASTERY_XP_CATEGORY } from "./credit";
import { backfillPeopleXp } from "./people-credit";
import type { MasterySignal } from "./leveling";

// BrainMemory categories that carry real operator signal worth attributing.
// WHITELIST (everything else — our own AI outputs, briefs, traces, telemetry,
// the xp-event log itself — is excluded by omission, so attribution can never
// go circular). Email + pins are handled as their own sources below.
const ATTRIBUTABLE_BRAIN_CATEGORIES = [
  "wisdom", "lesson", "pattern", "anti_pattern", "domain_knowledge",
  "teaching_moment", "reflection", "skill", "learning_journal", "belief",
  "belief_manual", "decision_log", "decision_manual", "nick_advice", "brain",
  "personal_development", "discipline", "health", "mental", "physical",
  "spiritual",
] as const;

const EMAIL_CATEGORIES = ["gmail_thread", "gmail_outgoing"] as const;

interface SourceItem {
  /** Stable dedup sourceKey (matches any existing live key for this row). */
  key: string;
  /** Text fed to the AI attributor (unstructured sources). */
  text: string;
}

interface AiSource {
  name: string;
  signal: MasterySignal;
  /** All-time fetch · returns {key, text} per row. Cheap selects only. */
  fetch: (limit: number | null) => Promise<SourceItem[]>;
}

/** Trim + cap text the way attributeText expects; "" → skipped upstream. */
function clip(s: string | null | undefined): string {
  return (s ?? "").trim();
}

// ── AI-attributed sources (all-time) ────────────────────────────────────
const AI_SOURCES: AiSource[] = [
  {
    name: "chat",
    signal: "chat",
    fetch: async (limit) =>
      (await prisma.chatMessage
        .findMany({
          where: { role: "user" },
          orderBy: { createdAt: "desc" },
          ...(limit ? { take: limit } : {}),
          select: { id: true, content: true },
        })
        .catch(() => []))
        .map((r) => ({ key: `chat:${r.id}`, text: clip(r.content) })),
  },
  {
    name: "journal-braindump",
    signal: "journal",
    fetch: async (limit) =>
      (await prisma.brainDump
        .findMany({
          where: { deletedAt: null },
          orderBy: { createdAt: "desc" },
          ...(limit ? { take: limit } : {}),
          select: { id: true, rawThoughts: true },
        })
        .catch(() => []))
        // matches the live journal-ingest baseline key → live rows are skips
        .map((r) => ({ key: `journal-base:${r.id}`, text: clip(r.rawThoughts) })),
  },
  {
    name: "journal-reflection",
    signal: "journal",
    fetch: async (limit) =>
      (await prisma.reflection
        .findMany({
          where: { deletedAt: null },
          orderBy: { createdAt: "desc" },
          ...(limit ? { take: limit } : {}),
          select: { id: true, insight: true },
        })
        .catch(() => []))
        .map((r) => ({ key: `journal-reflection:${r.id}`, text: clip(r.insight) })),
  },
  {
    name: "journal-situation",
    signal: "journal",
    fetch: async (limit) =>
      (await prisma.situationLog
        .findMany({
          orderBy: { createdAt: "desc" },
          ...(limit ? { take: limit } : {}),
          select: { id: true, situation: true, context: true },
        })
        .catch(() => []))
        .map((r) => ({
          key: `journal-situation:${r.id}`,
          text: clip(`${r.context ?? ""}\n${r.situation}`),
        })),
  },
  {
    name: "journal-replay",
    signal: "journal",
    fetch: async (limit) =>
      (await prisma.decisionReplay
        .findMany({
          orderBy: { createdAt: "desc" },
          ...(limit ? { take: limit } : {}),
          select: { id: true, title: true, context: true, reasoning: true },
        })
        .catch(() => []))
        .map((r) => ({
          key: `journal-replay:${r.id}`,
          text: clip(`${r.title}\n${r.context ?? ""}\n${r.reasoning ?? ""}`),
        })),
  },
  {
    name: "captures",
    signal: "journal",
    fetch: async (limit) =>
      (await prisma.captureInboxItem
        .findMany({
          orderBy: { createdAt: "desc" },
          ...(limit ? { take: limit } : {}),
          select: { id: true, title: true, summary: true },
        })
        .catch(() => []))
        .map((r) => ({ key: `capture:${r.id}`, text: clip(`${r.title}\n${r.summary}`) })),
  },
  {
    name: "decisions",
    signal: "decision",
    fetch: async (limit) =>
      (await prisma.masteryDecision
        .findMany({
          where: { deletedAt: null },
          orderBy: { id: "desc" },
          ...(limit ? { take: limit } : {}),
          select: { id: true, title: true, context: true, reasoning: true },
        })
        .catch(() => []))
        .map((r) => ({
          key: `decision:${r.id}`,
          text: clip(`${r.title}\n${r.context ?? ""}\n${r.reasoning ?? ""}`),
        })),
  },
  {
    name: "email",
    signal: "email",
    fetch: async (limit) =>
      (await prisma.brainMemory
        .findMany({
          where: { category: { in: [...EMAIL_CATEGORIES] }, deletedAt: null },
          orderBy: { createdAt: "desc" },
          ...(limit ? { take: limit } : {}),
          select: { id: true, content: true },
        })
        .catch(() => []))
        .map((r) => ({ key: `email:${r.id}`, text: clip(r.content) })),
  },
  {
    name: "pins",
    signal: "journal",
    fetch: async (limit) =>
      (await prisma.brainMemory
        .findMany({
          where: { category: "pinned_user", deletedAt: null },
          orderBy: { createdAt: "desc" },
          ...(limit ? { take: limit } : {}),
          select: { id: true, content: true },
        })
        .catch(() => []))
        .map((r) => ({ key: `pin:${r.id}`, text: clip(r.content) })),
  },
  {
    name: "brain-memory",
    signal: "journal",
    fetch: async (limit) =>
      (await prisma.brainMemory
        .findMany({
          where: {
            category: { in: [...ATTRIBUTABLE_BRAIN_CATEGORIES] },
            deletedAt: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
          orderBy: { createdAt: "desc" },
          ...(limit ? { take: limit } : {}),
          select: { id: true, content: true },
        })
        .catch(() => []))
        .map((r) => ({ key: `brain:${r.id}`, text: clip(r.content) })),
  },
  {
    name: "goals-achieved",
    signal: "decision",
    fetch: async (limit) =>
      (await prisma.lifeGoal
        .findMany({
          where: { status: "achieved", deletedAt: null },
          orderBy: { createdAt: "desc" },
          ...(limit ? { take: limit } : {}),
          select: { id: true, title: true },
        })
        .catch(() => []))
        .map((r) => ({ key: `goal-achieved:${r.id}`, text: clip(r.title) })),
  },
];

export interface SourceTally {
  scanned: number;
  credited: number;
  xp: number;
  aiCalls: number;
}
export interface BackfillResult {
  dryRun: boolean;
  runTag: string;
  scanned: number;
  credited: number;
  xpAdded: number;
  aiCalls: number;
  byStat: Record<string, number>;
  bySource: Record<string, SourceTally>;
}

/** Which of these keys already have a mastery_xp_event row (so we skip them
 *  BEFORE any AI call). One batched query per source. */
async function existingKeys(keys: string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const rows = await prisma.brainMemory
    .findMany({
      where: { category: MASTERY_XP_CATEGORY, key: { in: keys } },
      select: { key: true },
    })
    .catch(() => [] as { key: string }[]);
  return new Set(rows.map((r) => r.key));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * CHEAP cost preview · counts UNCREDITED items per source with ZERO AI calls.
 * `uncredited` ≈ the number of AI attribution calls the real run will make.
 */
export async function measureBackfill(
  perSourceCap: number | null = null,
): Promise<{
  totalUncredited: number;
  bySource: Record<string, { total: number; credited: number; uncredited: number }>;
}> {
  const bySource: Record<string, { total: number; credited: number; uncredited: number }> = {};
  let totalUncredited = 0;
  for (const src of AI_SOURCES) {
    const items = await src.fetch(perSourceCap);
    const have = await existingKeys(items.map((i) => i.key));
    const uncredited = items.filter((i) => !have.has(i.key) && i.text.length >= 12).length;
    bySource[src.name] = { total: items.length, credited: have.size, uncredited };
    totalUncredited += uncredited;
  }
  // Body (rule-based · free, no AI) — count workout reps not yet credited.
  const workouts = await prisma.bodyTracking
    .findMany({ where: { workoutDone: true }, select: { id: true } })
    .catch(() => [] as { id: number }[]);
  const bodyHave = await existingKeys(workouts.map((w) => `body:${w.id}:conditioning`));
  bySource["body"] = {
    total: workouts.length,
    credited: bodyHave.size,
    uncredited: 0, // free (rule-based) — not an AI cost
  };
  return { totalUncredited, bySource };
}

/**
 * Run the backfill. `dryRun` attributes (real AI) but does NOT write — pass a
 * small `perSourceCap` for a cheap sample preview. The real run: dryRun=false,
 * perSourceCap=null (all-time).
 */
export async function runComprehensiveBackfill(opts?: {
  dryRun?: boolean;
  runTag?: string;
  perSourceCap?: number | null;
  /** Restrict to these source names (default: all). */
  sources?: string[];
}): Promise<BackfillResult> {
  const dryRun = opts?.dryRun ?? false;
  const runTag = opts?.runTag ?? `backfill-${new Date().toISOString().slice(0, 19)}`;
  const cap = opts?.perSourceCap ?? null;
  const only = opts?.sources ? new Set(opts.sources) : null;

  const res: BackfillResult = {
    dryRun,
    runTag,
    scanned: 0,
    credited: 0,
    xpAdded: 0,
    aiCalls: 0,
    byStat: {},
    bySource: {},
  };
  const tally = (name: string): SourceTally =>
    (res.bySource[name] ??= { scanned: 0, credited: 0, xp: 0, aiCalls: 0 });

  // ── AI-attributed sources ──────────────────────────────────────────
  for (const src of AI_SOURCES) {
    if (only && !only.has(src.name)) continue;
    const t = tally(src.name);
    const items = await src.fetch(cap);
    const have = await existingKeys(items.map((i) => i.key));
    for (const item of items) {
      t.scanned++;
      res.scanned++;
      if (have.has(item.key)) continue; // already credited → no AI, no double-count
      if (item.text.length < 12) continue;
      const attr = await attributeText(item.text, src.name);
      t.aiCalls++;
      res.aiCalls++;
      if (!attr) continue;
      if (dryRun) {
        t.credited++; t.xp = round1(t.xp + attr.xp);
        res.credited++; res.xpAdded = round1(res.xpAdded + attr.xp);
        res.byStat[attr.stat] = round1((res.byStat[attr.stat] ?? 0) + attr.xp);
        continue;
      }
      const isNew = await creditStatXp({
        stat: attr.stat,
        xp: attr.xp,
        signal: src.signal,
        evidence: attr.evidence,
        sourceKey: item.key,
        backfillRun: runTag,
      });
      if (isNew) {
        t.credited++; t.xp = round1(t.xp + attr.xp);
        res.credited++; res.xpAdded = round1(res.xpAdded + attr.xp);
        res.byStat[attr.stat] = round1((res.byStat[attr.stat] ?? 0) + attr.xp);
      }
    }
  }

  // ── Body · FREE rule-based (a logged workout = a conditioning rep) ───
  if (!only || only.has("body")) {
    const t = tally("body");
    const workouts = await prisma.bodyTracking
      .findMany({
        where: { workoutDone: true },
        orderBy: { createdAt: "desc" },
        ...(cap ? { take: cap } : {}),
        select: { id: true },
      })
      .catch(() => [] as { id: number }[]);
    for (const w of workouts) {
      t.scanned++;
      res.scanned++;
      if (dryRun) {
        t.credited++; t.xp = round1(t.xp + 0.5);
        res.credited++; res.xpAdded = round1(res.xpAdded + 0.5);
        res.byStat["conditioning"] = round1((res.byStat["conditioning"] ?? 0) + 0.5);
        continue;
      }
      const isNew = await creditStatXp({
        stat: "conditioning",
        xp: 0.5,
        signal: "habit",
        evidence: "logged a workout",
        sourceKey: `body:${w.id}:conditioning`,
        backfillRun: runTag,
      });
      if (isNew) {
        t.credited++; t.xp = round1(t.xp + 0.5);
        res.credited++; res.xpAdded = round1(res.xpAdded + 0.5);
        res.byStat["conditioning"] = round1((res.byStat["conditioning"] ?? 0) + 0.5);
      }
    }
  }

  // ── People · delegate to the existing idempotent backfill ───────────
  if (!dryRun && (!only || only.has("people"))) {
    const p = await backfillPeopleXp().catch(() => ({ deposits: 0, plays: 0 }));
    res.bySource["people"] = {
      scanned: p.deposits + p.plays,
      credited: p.deposits + p.plays,
      xp: 0, // people-credit computes its own xp internally
      aiCalls: 0,
    };
  }

  return res;
}
