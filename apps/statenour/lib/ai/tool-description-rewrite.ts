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
 * Cost doctrine: fast lane (Ollama/DeepSeek), ≤3 tools per nightly run,
 * only tools with ≥10 calls and <60% success — the census's highFailure
 * bucket. Idempotent per (tool, description-fingerprint): once a draft
 * exists for the CURRENT description, the tool is skipped, so a stale
 * draft never regenerates nightly forever.
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

export async function runToolDescriptionRewrite(): Promise<RewriteRunResult> {
  const stats = await getToolStats(500);
  const candidates = pickRewriteCandidates(stats);
  const result: RewriteRunResult = { considered: candidates.length, drafted: [], skippedExisting: [], failed: [] };
  if (candidates.length === 0) return result;

  const { nourTools } = (await import("@/lib/ai/tools")) as unknown as {
    nourTools: Record<string, { description?: string }>;
  };

  for (const stat of candidates) {
    const name = stat.toolName;
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
      const prompt = buildRewritePrompt({
        toolName: name,
        currentDescription,
        failures: stat.lastErrors,
      });
      const llm = await aiChat(
        [
          {
            role: "system",
            content:
              "You optimize AI tool descriptions from real failure evidence. Output only the rewritten description text — no preamble, no fences.",
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
      await prisma.brainMemory.upsert({
        where: { category_key: { category: DRAFT_CATEGORY, key } },
        create: {
          category: DRAFT_CATEGORY,
          key,
          content: draft,
          confidence: 0.5,
          source: "tool-description-rewrite-cron",
          metadata: {
            toolName: name,
            descriptionFingerprint: fingerprint,
            successRatePct: Math.round(stat.successRate * 100),
            totalCalls: stat.totalCalls,
            evidence: stat.lastErrors.slice(0, 5),
            note: "DRAFT ONLY — apply by editing the tool file + regenerating snapshots (pnpm snapshot:tool-schemas / snapshot:mcp-surface).",
          },
        },
        update: {
          content: draft,
          lastSeen: new Date(),
          metadata: {
            toolName: name,
            descriptionFingerprint: fingerprint,
            successRatePct: Math.round(stat.successRate * 100),
            totalCalls: stat.totalCalls,
            evidence: stat.lastErrors.slice(0, 5),
            note: "DRAFT ONLY — apply by editing the tool file + regenerating snapshots (pnpm snapshot:tool-schemas / snapshot:mcp-surface).",
          },
        },
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
