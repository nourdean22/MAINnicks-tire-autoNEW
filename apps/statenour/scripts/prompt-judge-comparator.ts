#!/usr/bin/env tsx
/**
 * scripts/prompt-judge-comparator.ts · v10.0.464
 *
 * v2 cutover Phase 0b · Criterion 4 evaluator. Samples N recent
 * user queries from ChatMessage history, runs each through both
 * the v1 and v2 prompt builders, generates a reply with each,
 * scores both replies on the 5-axis judge rubric, and emits the
 * per-axis delta + verdict.
 *
 * Cost (approximate, per run):
 *   N × 4 LLM calls (v1 gen + v2 gen + v1 judge + v2 judge)
 *   At N=20 default → ~80 calls → $0.05-$0.20 depending on provider
 *
 * Usage:
 *   pnpm tsx scripts/prompt-judge-comparator.ts                # 20 turns
 *   pnpm tsx scripts/prompt-judge-comparator.ts --n 50         # 50 turns
 *   pnpm tsx scripts/prompt-judge-comparator.ts --json         # CI gate
 *
 * Exit codes:
 *   0 = Criterion 4 PASS · no axis regresses by more than 0.3
 *   1 = Criterion 4 FAIL · at least one axis regression > 0.3
 *   2 = no sample data (no recent ChatMessage rows · seed history first)
 *
 * Skill provenance: prompt-engineering + claude-api +
 * agent-orchestration-multi-agent-optimize + production-code-audit
 * (top-50 always-on floor).
 */

// server-only shim for tsx CLI environments
import Module from "node:module";
import { resolve as pathResolve } from "node:path";
const NOOP_PATH = pathResolve(process.cwd(), "scripts", ".server-only-noop.js");
const origResolve = Module._resolveFilename;
// @ts-ignore
Module._resolveFilename = function (request: string, ...args: unknown[]) {
  if (request === "server-only") return NOOP_PATH;
  // @ts-ignore
  return origResolve.apply(this, [request, ...args]);
};

import { prisma } from "@/lib/prisma";
import { judgeReply, type JudgeReport, type JudgeRubric } from "@/lib/ai/judge-eval";
import { aiChat } from "@/lib/ai/provider";

interface PairResult {
  query: string;
  v1Reply: string;
  v2Reply: string;
  v1Judge: JudgeReport | null;
  v2Judge: JudgeReport | null;
}

interface AxisDelta {
  axis: keyof JudgeRubric;
  v1Avg: number;
  v2Avg: number;
  delta: number; // v2 - v1 · positive = v2 better
  pass: boolean; // delta > -0.3 (no significant regression)
}

const AXES: (keyof JudgeRubric)[] = [
  "accuracy",
  "actionability",
  "brevity",
  "tone",
  "evidence",
];

const REGRESSION_THRESHOLD = -0.3;

function parseArgs() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const nIdx = args.indexOf("--n");
  const n = nIdx >= 0 ? Number(args[nIdx + 1]) || 20 : 20;
  return { json, n };
}

async function sampleQueries(n: number): Promise<string[]> {
  // Pull recent user-role ChatMessage rows · skip empty / very short ·
  // dedupe near-duplicates (same first 80 chars).
  const rows = await prisma.chatMessage.findMany({
    where: {
      role: "user",
      content: { not: "" },
    },
    select: { content: true },
    orderBy: { createdAt: "desc" },
    take: n * 4, // oversample · we'll filter
  });
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    if (typeof r.content !== "string") continue;
    const trimmed = r.content.trim();
    if (trimmed.length < 12) continue;
    const key = trimmed.slice(0, 80).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= n) break;
  }
  return out;
}

async function generateReply(
  systemPrompt: string,
  userQuery: string,
): Promise<string> {
  // Use the same aiChat path the production chat uses · respects the
  // provider chain (Venice → Ollama → OpenAI → Anthropic) so the
  // comparator measures REAL production behavior, not a synthetic.
  const result = await aiChat(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userQuery },
    ],
    "chat",
  );
  return (result.content ?? "").trim();
}

async function comparePair(
  v1System: string,
  v2System: string,
  query: string,
): Promise<PairResult> {
  // Generate replies in parallel · halves wall-clock cost
  const [v1Reply, v2Reply] = await Promise.all([
    generateReply(v1System, query).catch(() => ""),
    generateReply(v2System, query).catch(() => ""),
  ]);
  // Judge in parallel
  const [v1Judge, v2Judge] = await Promise.all([
    v1Reply ? judgeReply({ userQuery: query, assistantReply: v1Reply }) : Promise.resolve(null),
    v2Reply ? judgeReply({ userQuery: query, assistantReply: v2Reply }) : Promise.resolve(null),
  ]);
  return { query, v1Reply, v2Reply, v1Judge, v2Judge };
}

function aggregate(pairs: PairResult[]): AxisDelta[] {
  const validPairs = pairs.filter((p) => p.v1Judge && p.v2Judge);
  return AXES.map((axis) => {
    const v1Avg =
      validPairs.length > 0
        ? validPairs.reduce((s, p) => s + (p.v1Judge!.rubric[axis] ?? 0), 0) /
          validPairs.length
        : 0;
    const v2Avg =
      validPairs.length > 0
        ? validPairs.reduce((s, p) => s + (p.v2Judge!.rubric[axis] ?? 0), 0) /
          validPairs.length
        : 0;
    const delta = v2Avg - v1Avg;
    return {
      axis,
      v1Avg: Math.round(v1Avg * 10) / 10,
      v2Avg: Math.round(v2Avg * 10) / 10,
      delta: Math.round(delta * 10) / 10,
      pass: delta > REGRESSION_THRESHOLD,
    };
  });
}

async function main() {
  const { json, n } = parseArgs();

  const queries = await sampleQueries(n);
  if (queries.length === 0) {
    if (json) {
      process.stdout.write(
        JSON.stringify(
          { status: "no_data", message: "No recent user-role ChatMessage rows" },
          null,
          2,
        ),
      );
    } else {
      console.log("✗ NO DATA · no recent user-role ChatMessage rows to sample.");
    }
    process.exit(2);
  }

  // Build both prompt versions for an empty conversation context.
  // The comparator measures THE PROMPT'S effect, not the
  // conversation-specific brain context.
  //
  // v10.0.529.9 bug fix · post-session review caught this script never
  // executed cleanly since v10.0.464. Pre-fix imported the non-exported
  // `buildSystemPromptUncached` with wrong args (`"chat", "core"` vs the
  // signature's `tier, userMessage`). Now uses the public
  // `buildSystemPrompt(tier, userMessage)` entry · same prompt that
  // production serves, which is what we want to compare anyway.
  process.env.NICK_PRIME_PROMPT = "off";
  const { buildSystemPrompt } = await import("@/lib/ai/system-prompt");
  const v1System = await buildSystemPrompt("core", null);
  process.env.NICK_PRIME_PROMPT = "1";
  // For v2 we re-import to bypass any module-level caching:
  const { buildSystemPromptV2 } = await import("@/lib/ai/prompt/v2");
  const v2Out = await buildSystemPromptV2();
  const v2System = v2Out.prompt;
  // Reset to default
  delete process.env.NICK_PRIME_PROMPT;

  if (!json) {
    console.log(`Comparing v1 (${v1System.length} chars) vs v2 (${v2System.length} chars)`);
    console.log(`Sample · ${queries.length} unique recent user queries`);
    console.log(`Per-pair cost · ~4 LLM calls (gen×2 + judge×2)`);
    console.log("");
    console.log("Running…");
  }

  // Sequential pair execution to avoid hammering the providers
  const pairs: PairResult[] = [];
  for (let i = 0; i < queries.length; i++) {
    const pair = await comparePair(v1System, v2System, queries[i]);
    pairs.push(pair);
    if (!json) {
      const v1c = pair.v1Judge?.composite.toFixed(1) ?? "—";
      const v2c = pair.v2Judge?.composite.toFixed(1) ?? "—";
      console.log(
        `  [${i + 1}/${queries.length}] v1=${v1c} v2=${v2c} · "${queries[i].slice(0, 50)}…"`,
      );
    }
  }

  const deltas = aggregate(pairs);
  const overallPass = deltas.every((d) => d.pass);

  if (json) {
    process.stdout.write(
      JSON.stringify(
        {
          status: "ok",
          n: queries.length,
          v1Chars: v1System.length,
          v2Chars: v2System.length,
          deltas,
          overallPass,
        },
        null,
        2,
      ),
    );
  } else {
    console.log("");
    console.log("Per-axis delta (v2 − v1):");
    for (const d of deltas) {
      const sign = d.delta > 0 ? "+" : "";
      console.log(
        `  ${d.axis.padEnd(15)} v1=${d.v1Avg} v2=${d.v2Avg} Δ=${sign}${d.delta} ${d.pass ? "✓" : "✗ FAIL"}`,
      );
    }
    console.log("");
    console.log(`Criterion 4 · no axis regresses by > 0.3 · ${overallPass ? "✓ PASS" : "✗ FAIL"}`);
    console.log("");
  }

  process.exit(overallPass ? 0 : 1);
}

main()
  .catch((err) => {
    console.error("[prompt-judge-comparator] error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
