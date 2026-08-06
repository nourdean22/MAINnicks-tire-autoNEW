/**
 * v9.1.6 · Shadow-mode metric persistence · Apr 30.
 *
 * When NICK_PRIME_PROMPT=shadow runs, every chat reply that triggers a
 * system-prompt build also (silently) builds v2 in parallel. We were
 * already logging the delta to console; this module persists the same
 * data to SystemMetric so it can be trended on the operator dashboard.
 *
 * Why a separate file: the shadow path lives in lib/ai/system-prompt.ts
 * (1700+ lines) and has very tight read/build/cache choreography. The
 * persistence write is best-effort and async-isolated — keeping it out
 * of that file makes it impossible for a Prisma stall to block prompt
 * delivery.
 *
 * Metric shape:
 *   metric: "prompt.shadow.<dimension>"
 *   value:  Float — chars / pct / sections-only-in-v1
 *   tags:   { tier, slot, builderVersion, charsV1, charsV2 }
 *   source: "prompt-shadow"
 *
 * Three rows per shadow run lets the dashboard build three sparklines
 * with one query each — no JOINs, no Json filters, no schema change.
 */

import { prisma } from "@/lib/prisma";
import { logError } from "@/lib/utils/error-log";

export interface ShadowDelta {
  charsV1: number;
  charsV2: number;
  charsDelta: number;
  charsDeltaPct: number;
  sectionsOnlyInV1: number;
  sectionsOnlyInV2: number;
  sectionsInBoth: number;
  tier: string;
  slot: string;
  builderVersion: string;
}

/**
 * Persist a shadow comparison run as 3 SystemMetric rows. All writes
 * go through one Promise.all + a top-level catch — a Prisma failure
 * never throws back to the caller.
 */
export async function recordShadowDelta(d: ShadowDelta): Promise<void> {
  const tags = {
    tier: d.tier,
    slot: d.slot,
    builderVersion: d.builderVersion,
    charsV1: d.charsV1,
    charsV2: d.charsV2,
  };

  try {
    await prisma.$transaction([
      prisma.systemMetric.create({
        data: {
          metric: "prompt.shadow.chars_delta",
          value: d.charsDelta,
          unit: "chars",
          tags,
          source: "prompt-shadow",
        },
      }),
      prisma.systemMetric.create({
        data: {
          metric: "prompt.shadow.chars_delta_pct",
          value: d.charsDeltaPct,
          unit: "pct",
          tags,
          source: "prompt-shadow",
        },
      }),
      prisma.systemMetric.create({
        data: {
          metric: "prompt.shadow.sections_only_v1",
          value: d.sectionsOnlyInV1,
          unit: "count",
          tags: {
            ...tags,
            sectionsOnlyInV2: d.sectionsOnlyInV2,
            sectionsInBoth: d.sectionsInBoth,
          },
          source: "prompt-shadow",
        },
      }),
    ]);
  } catch (err) {
    // Best-effort. Don't surface to caller — shadow telemetry must
    // never affect the chat reply.
    logError("ai.shadow-metrics", err, { fn: "recordShadowDelta" });
  }
}

/**
 * 2026-05-23 · Wave C+ · Q2 · enqueue a paired (userMessage, v1Prompt,
 * v2Prompt) row for the judge-eval replay cron to score.
 *
 * Why a queue · not an inline judge call: the shadow path runs on
 * every chat turn. Inline judging would mean 2 extra LLM calls per
 * turn (build v2 reply + judge). Queue + cron decouples that cost
 * from the chat-path latency.
 *
 * Why key by userMessage hash + timestamp · NOT messageId: the
 * shadow path fires BEFORE the assistant message is created · the
 * messageId doesn't exist yet. Operator-feedback joining is a
 * separate concern handled by the M1 calibration loop (Wave H).
 *
 * Sampling: caller decides. Recommended ~10% of shadow runs to keep
 * the queue tractable for the daily replay cron.
 *
 * Idempotency: keyed by a SHA-1 hash of (userMessage + tier + slot) ·
 * same user message in same tier/slot won't re-queue (the v2 prompt
 * is rebuilt deterministically, no value in re-scoring).
 */
export async function enqueueShadowJudgePair(args: {
  userMessage: string;
  v1Prompt: string;
  v2Prompt: string;
  tier: string;
  slot: string;
  intentClass?: string | null;
}): Promise<void> {
  try {
    const { createHash } = await import("node:crypto");
    const { BRAIN_CATEGORIES } = await import("@/lib/brain/categories");
    const key = createHash("sha1")
      .update(`${args.userMessage}|${args.tier}|${args.slot}`)
      .digest("hex")
      .slice(0, 16);
    const metadata = {
      userMessage: args.userMessage.slice(0, 2000),
      v1Prompt: args.v1Prompt,
      v2Prompt: args.v2Prompt,
      tier: args.tier,
      slot: args.slot,
      intentClass: args.intentClass ?? null,
      queuedAt: new Date().toISOString(),
      judged: false,
    };
    await prisma.brainMemory.upsert({
      where: {
        category_key: {
          category: BRAIN_CATEGORIES.PROMPT_SHADOW_JUDGE_QUEUE,
          key,
        },
      },
      create: {
        category: BRAIN_CATEGORIES.PROMPT_SHADOW_JUDGE_QUEUE,
        key,
        // Content = browseable snippet · full prompts in metadata.
        content: `v1=${args.v1Prompt.length}ch v2=${args.v2Prompt.length}ch · ${args.tier}/${args.slot} · ${args.userMessage.slice(0, 80)}`,
        confidence: 0,
        source: "prompt-shadow",
        createdBy: "system:shadow-metrics",
        // 14d TTL · long enough for the daily replay cron to catch up.
        expiresAt: new Date(Date.now() + 14 * 86_400_000),
        metadata: JSON.parse(JSON.stringify(metadata)),
      },
      update: {
        // Upsert just refreshes lastSeen · don't re-overwrite the
        // prompts since they're deterministic for the same key.
        lastSeen: new Date(),
      },
    });
  } catch (err) {
    // Best-effort. Queue write must never block chat.
    logError("ai.shadow-metrics", err, { fn: "enqueueShadowJudgePair" });
  }
}

/**
 * Read shadow trend data — last `windowDays` worth of three metric
 * series. Used by the operator dashboard. Returns one array per
 * metric; each element has createdAt + value + tier/slot tags so the
 * UI can filter or pivot.
 */
export async function readShadowTrend(windowDays: number = 7): Promise<{
  charsDelta: ShadowMetricPoint[];
  charsDeltaPct: ShadowMetricPoint[];
  sectionsOnlyInV1: ShadowMetricPoint[];
}> {
  const since = new Date(Date.now() - windowDays * 86_400_000);
  const [charsDelta, charsDeltaPct, sectionsOnlyInV1] = await Promise.all([
    prisma.systemMetric.findMany({
      where: { metric: "prompt.shadow.chars_delta", createdAt: { gte: since } },
      orderBy: { createdAt: "asc" },
      take: 1000,
      select: { id: true, value: true, tags: true, createdAt: true },
    }),
    prisma.systemMetric.findMany({
      where: { metric: "prompt.shadow.chars_delta_pct", createdAt: { gte: since } },
      orderBy: { createdAt: "asc" },
      take: 1000,
      select: { id: true, value: true, tags: true, createdAt: true },
    }),
    prisma.systemMetric.findMany({
      where: { metric: "prompt.shadow.sections_only_v1", createdAt: { gte: since } },
      orderBy: { createdAt: "asc" },
      take: 1000,
      select: { id: true, value: true, tags: true, createdAt: true },
    }),
  ]);

  const project = (rows: typeof charsDelta): ShadowMetricPoint[] =>
    rows.map((r) => ({
      id: r.id,
      value: r.value,
      tags: (r.tags as ShadowMetricPoint["tags"]) ?? {},
      createdAt: r.createdAt.toISOString(),
    }));

  return {
    charsDelta: project(charsDelta),
    charsDeltaPct: project(charsDeltaPct),
    sectionsOnlyInV1: project(sectionsOnlyInV1),
  };
}

export interface ShadowMetricPoint {
  id: string;
  value: number;
  tags: Record<string, unknown>;
  createdAt: string;
}

/**
 * Pure helper — extract section headings (lines starting with "## ")
 * from a built prompt. Lifted here so both the shadow builder and the
 * comparison surface use the exact same regex.
 */
export function extractSections(prompt: string): string[] {
  return prompt
    .split("\n")
    .filter((l) => l.startsWith("## "))
    .map((l) => l.slice(3).trim());
}

/**
 * Compute the full delta from two prompts.
 *
 * 2026-08-06 · this claimed to be shared with "the on-demand
 * /api/system/prompt-compare endpoint, so the numbers always agree". Both
 * halves of that were false: prompt-compare carried its OWN private copy of
 * the heading extraction and delta math (it never imported this), and the
 * route has since been deleted for reporting a self-comparison as parity.
 *
 * CURRENT TRUTH: this function has no non-test callers. Its intended
 * producer was the `NICK_PRIME_PROMPT=shadow` branch, which stopped existing
 * at the 2026-06-29 V2 prime cutover — with one builder there is no second
 * candidate to diff. Kept, not deleted, because the delta shape and the
 * `prompt.shadow.*` SystemMetric sink are still the right ledger if a real
 * second candidate is ever introduced. Do not read the empty trend series as
 * "the prompts have converged"; nothing has ever written to it.
 */
export function computeShadowDelta(
  v1Prompt: string,
  v2Prompt: string,
  builderVersion: string,
  tier: string,
  slot: string,
): ShadowDelta {
  const v1Sections = extractSections(v1Prompt);
  const v2Sections = extractSections(v2Prompt);
  const v1Set = new Set(v1Sections);
  const v2Set = new Set(v2Sections);
  const sectionsInBoth = v1Sections.filter((s) => v2Set.has(s));
  const sectionsOnlyInV1 = v1Sections.filter((s) => !v2Set.has(s));
  const sectionsOnlyInV2 = v2Sections.filter((s) => !v1Set.has(s));

  const charsDelta = v2Prompt.length - v1Prompt.length;
  const charsDeltaPct =
    v1Prompt.length === 0
      ? 0
      : Math.round((charsDelta / v1Prompt.length) * 1000) / 10;

  return {
    charsV1: v1Prompt.length,
    charsV2: v2Prompt.length,
    charsDelta,
    charsDeltaPct,
    sectionsOnlyInV1: sectionsOnlyInV1.length,
    sectionsOnlyInV2: sectionsOnlyInV2.length,
    sectionsInBoth: sectionsInBoth.length,
    tier,
    slot,
    builderVersion,
  };
}
