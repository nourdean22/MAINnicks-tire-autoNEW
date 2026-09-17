/**
 * BDN-202 · failure-receipt → tool-description rewrite DRAFTS.
 *
 * The production-proven recipe ("A Single Rewrite Suffices", arXiv
 * 2606.30775): one LLM pass over a tool's recent failures captures the
 * bulk of description-optimization gain. This module drafts — it NEVER
 * applies. Descriptions live in code; a draft lands as a
 * BrainMemory(category: "tool_description_draft") row rendered beside
 * the tool-usage census on /system, and a human carries it into the
 * repo (where the schema snapshots force a deliberate regeneration).
 *
 * Cost doctrine: fast lane (Ollama/DeepSeek), ≤3 tools per nightly run.
 * Idempotent per (tool, description-fingerprint): once a draft exists for
 * the CURRENT description, the tool is skipped, so a stale draft never
 * regenerates nightly forever.
 *
 * TWO EVIDENCE KINDS since 2026-09-16 (this header previously said "only
 * tools with ≥10 calls and <60% success — the census's highFailure bucket",
 * which was the whole problem):
 *
 *   · high_failure          — called and failing. The original queue.
 *   · surfaced_never_chosen — OFFERED repeatedly and never called at all.
 *
 * The second was added because the first is EMPTY. Measured on the first read
 * of the census since #2359 unblinded it: highFailure = 0, so this cron ran
 * nightly and drafted nothing, while 101 tools burned 8.4 of every turn's 24
 * slots having never once been chosen. A never-called tool has no telemetry
 * row, so `getToolStats` structurally could not see the larger problem.
 *
 * Failures are drafted first and never-chosen fills the remaining budget, so
 * the new source cannot starve the original one.
 */

import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { getToolStats, type ToolStat } from "@/lib/ai/tool-telemetry";
import { makeTracedAiChat } from "@/lib/ai/traced-aichat";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("ai/tool-description-rewrite");
const aiChat = makeTracedAiChat("tool-description-rewrite", "cron");

const MAX_TOOLS_PER_RUN = 3;
const MIN_CALLS = 10;
const SUCCESS_FLOOR = 0.6;
export const DRAFT_CATEGORY = "tool_description_draft";

/**
 * NEVER-CHOSEN candidates · added 2026-09-16.
 *
 * WHY. `pickRewriteCandidates` below needs `totalCalls >= 10`, so it can only
 * ever see tools the model DID call. Measured on the first read of the census
 * since #2359 unblinded it: `highFailure` is **0**, so this cron has been
 * running nightly against an EMPTY queue.
 *
 * Meanwhile the bucket the census itself labels "the actionable prune list"
 * held 101 tools, costing **8.4 of every turn's 24 slots** — 3,911 surfaced
 * impressions across 467 turns, never once chosen. `getMasteryScores` alone was
 * offered in 57% of turns and picked zero times.
 *
 * "Offered N times and never chosen" is the textbook description/selection
 * defect — precisely what a description rewriter exists for. It was invisible
 * here only because a never-called tool has no telemetry row to filter on.
 *
 * THRESHOLDS, and why they are relative. `turns` is the denominator; a raw
 * count means nothing without it (the #2359 lesson). MIN_TURNS guards against
 * acting on a thin window, and the ratio keeps this to tools that genuinely
 * cost budget on a large share of turns rather than the long tail.
 */
const NEVER_CHOSEN_MIN_TURNS = 50;
const NEVER_CHOSEN_MIN_SURFACED_RATIO = 0.2;

export interface NeverChosenCandidate {
  name: string;
  category: string;
  surfacedCount: number;
  turns: number;
}

/** Pure — exported for tests. */
export function pickNeverChosenCandidates(
  surfacedNeverChosen: ReadonlyArray<{ name: string; category: string; surfacedCount: number | null }>,
  turns: number,
  limit: number,
): NeverChosenCandidate[] {
  // An absent instrument must not read as a measured zero. With too few turns
  // we cannot tell "never chosen" from "barely observed", so we decline.
  if (turns < NEVER_CHOSEN_MIN_TURNS || limit <= 0) return [];
  return surfacedNeverChosen
    .filter((r) => (r.surfacedCount ?? 0) / turns >= NEVER_CHOSEN_MIN_SURFACED_RATIO)
    .sort((a, b) => (b.surfacedCount ?? 0) - (a.surfacedCount ?? 0))
    .slice(0, limit)
    .map((r) => ({
      name: r.name,
      category: r.category,
      surfacedCount: r.surfacedCount ?? 0,
      turns,
    }));
}

/**
 * Pure — exported for tests. A DIFFERENT task from the failure rewrite.
 *
 * There are no errors to learn from: the tool was never called. The evidence is
 * that the model read this description N times, alongside ~23 others, and chose
 * something else every time. So the prompt asks for discriminative clarity —
 * when to reach for THIS tool — rather than a constraint the failures violated.
 *
 * It deliberately invites "this tool may be redundant" as an answer. A rewrite
 * cannot fix a tool nobody needs, and the operator reviewing the draft is
 * better served by an honest verdict than by prettier wording.
 */
export function buildNeverChosenPrompt(args: {
  toolName: string;
  category: string;
  currentDescription: string;
  surfacedCount: number;
  turns: number;
}): string {
  const pct = Math.round((args.surfacedCount / Math.max(args.turns, 1)) * 100);
  return [
    `Tool name: ${args.toolName}  (category: ${args.category})`,
    `Current description (what the model reads when deciding whether to call it):`,
    args.currentDescription,
    ``,
    `Evidence: over ${args.turns} chat turns this tool was OFFERED to the model ${args.surfacedCount} times (${pct}% of turns) and chosen ZERO times. It never failed — it was never selected. Other tools were available in the same turns and won.`,
    ``,
    `Rewrite the description so the model can tell WHEN THIS TOOL IS THE RIGHT CHOICE and when it is not. Name the concrete situation or question it answers, and what distinguishes it from neighbouring tools.`,
    `If, on this evidence, the tool looks genuinely redundant or superseded, say so in one sentence INSTEAD of rewriting — that is a useful answer, not a failure.`,
    `Rules: under 500 characters; keep the original intent and any Example; no marketing language; output ONLY the new description text (or the one-sentence redundancy verdict).`,
  ].join("\n");
}

/** Pure — exported for tests. */
export function pickRewriteCandidates(stats: ToolStat[]): ToolStat[] {
  return stats
    .filter((s) => s.totalCalls >= MIN_CALLS && s.successRate < SUCCESS_FLOOR && s.lastErrors.length > 0)
    .sort((a, b) => a.successRate - b.successRate)
    .slice(0, MAX_TOOLS_PER_RUN);
}

/** Pure — exported for tests. The single-pass rewrite prompt. */
export function buildRewritePrompt(args: {
  toolName: string;
  currentDescription: string;
  failures: Array<{ message: string }>;
}): string {
  const failureList = args.failures
    .slice(0, 5)
    .map((f, i) => `${i + 1}. ${f.message.slice(0, 300)}`)
    .join("\n");
  return [
    `Tool name: ${args.toolName}`,
    `Current description (what the model reads when deciding to call it):`,
    args.currentDescription,
    ``,
    `Recent FAILED calls (error messages):`,
    failureList,
    ``,
    `Rewrite the description so a model reading only it would avoid these failures.`,
    `Rules: keep it under 500 characters; keep the original intent and any Example; state the constraint the failures violated; no marketing language; output ONLY the new description text.`,
  ].join("\n");
}

function descriptionFingerprint(description: string): string {
  return createHash("sha256").update(description).digest("hex").slice(0, 16);
}

export interface RewriteRunResult {
  considered: number;
  drafted: string[];
  skippedExisting: string[];
  failed: string[];
}

/**
 * Two evidence kinds, one draft loop.
 *
 *   failure      — the tool was called and failed (>=10 calls, <60% success).
 *   never_chosen — the tool was OFFERED repeatedly and never called at all.
 *
 * Failures run first: they are rarer, higher-signal, and carry concrete error
 * text. Never-chosen candidates fill whatever budget remains, so adding them
 * cannot starve the original queue.
 */
type RewriteCandidate =
  | { kind: "failure"; name: string; stat: ToolStat }
  | { kind: "never_chosen"; name: string; info: NeverChosenCandidate };

export async function runToolDescriptionRewrite(): Promise<RewriteRunResult> {
  const stats = await getToolStats(500);
  const failureCandidates = pickRewriteCandidates(stats);

  // The census bucket this cron could never see: a never-called tool has no
  // telemetry row, so `stats` cannot contain it. Read it from the census.
  let neverChosen: NeverChosenCandidate[] = [];
  try {
    const { buildToolUsageCensus } = await import("@/lib/observability/tool-usage-census");
    const census = await buildToolUsageCensus();
    neverChosen = pickNeverChosenCandidates(
      census.surfacedNeverChosen,
      census.surfacedWindow.turns,
      MAX_TOOLS_PER_RUN - failureCandidates.length,
    );
  } catch (e) {
    // NOT silent: a census that cannot be read must not look like "no
    // never-chosen tools exist" (the #2359 failure mode exactly).
    log.warn("never_chosen_census_unavailable", { error: e instanceof Error ? e.message : String(e) });
  }

  const candidates: RewriteCandidate[] = [
    ...failureCandidates.map((stat) => ({ kind: "failure" as const, name: stat.toolName, stat })),
    ...neverChosen.map((info) => ({ kind: "never_chosen" as const, name: info.name, info })),
  ];

  const result: RewriteRunResult = { considered: candidates.length, drafted: [], skippedExisting: [], failed: [] };
  if (candidates.length === 0) return result;

  const { nourTools } = (await import("@/lib/ai/tools")) as unknown as {
    nourTools: Record<string, { description?: string }>;
  };

  for (const cand of candidates) {
    const name = cand.name;
    try {
      const currentDescription = nourTools[name]?.description;
      if (!currentDescription) {
        result.failed.push(`${name}: no description found in nourTools`);
        continue;
      }
      const fingerprint = descriptionFingerprint(currentDescription);
      const key = `tool-desc-draft:${name}`;
      const existing = await prisma.brainMemory.findUnique({
        where: { category_key: { category: DRAFT_CATEGORY, key } },
        select: { metadata: true },
      });
      const existingFp = (existing?.metadata as { descriptionFingerprint?: string } | null)?.descriptionFingerprint;
      if (existingFp === fingerprint) {
        result.skippedExisting.push(name);
        continue;
      }

      const prompt =
        cand.kind === "failure"
          ? buildRewritePrompt({
              toolName: name,
              currentDescription,
              failures: cand.stat.lastErrors,
            })
          : buildNeverChosenPrompt({
              toolName: name,
              category: cand.info.category,
              currentDescription,
              surfacedCount: cand.info.surfacedCount,
              turns: cand.info.turns,
            });

      const llm = await aiChat(
        [
          {
            role: "system",
            content:
              "You optimize AI tool descriptions from real evidence. Output only the rewritten description text — no preamble, no fences.",
          },
          { role: "user", content: prompt },
        ],
        "fast",
      );
      const draft = llm.content.trim().slice(0, 600);
      if (draft.length < 20) {
        result.failed.push(`${name}: draft too short (${draft.length} chars)`);
        continue;
      }

      // The evidence travels with the draft so /system shows WHY it exists —
      // a reviewer judging "offered 266 times, chosen 0" needs that number,
      // not just prettier wording.
      const metadata =
        cand.kind === "failure"
          ? {
              toolName: name,
              reason: "high_failure" as const,
              descriptionFingerprint: fingerprint,
              successRatePct: Math.round(cand.stat.successRate * 100),
              totalCalls: cand.stat.totalCalls,
              evidence: cand.stat.lastErrors.slice(0, 5),
              note: "DRAFT ONLY — apply by editing the tool file + regenerating snapshots (pnpm snapshot:tool-schemas / snapshot:mcp-surface).",
            }
          : {
              toolName: name,
              reason: "surfaced_never_chosen" as const,
              descriptionFingerprint: fingerprint,
              surfacedCount: cand.info.surfacedCount,
              turns: cand.info.turns,
              surfacedPct: Math.round((cand.info.surfacedCount / Math.max(cand.info.turns, 1)) * 100),
              totalCalls: 0,
              note: "DRAFT ONLY — offered repeatedly, never chosen. The draft may also argue the tool is redundant; that is a valid outcome. Apply by editing the tool file + regenerating snapshots.",
            };

      await prisma.brainMemory.upsert({
        where: { category_key: { category: DRAFT_CATEGORY, key } },
        create: {
          category: DRAFT_CATEGORY,
          key,
          content: draft,
          confidence: 0.5,
          source: "tool-description-rewrite-cron",
          metadata,
        },
        update: { content: draft, lastSeen: new Date(), metadata },
      });
      result.drafted.push(name);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.warn("rewrite_draft_failed", { tool: name, error: msg });
      result.failed.push(`${name}: ${msg}`);
    }
  }
  return result;
}
