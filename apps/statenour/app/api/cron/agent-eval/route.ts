// CP7 · force-dynamic · Railway build cannot reach Neon during static
// prerender. Runtime semantics unchanged (cached() makes these effectively
// dynamic on Vercel too).
export const dynamic = "force-dynamic";

/**
 * /api/cron/agent-eval · v10.0.370
 *
 * Per /agent-evaluation skill · run the full quality benchmark on a
 * schedule and store results so trends are visible. Pairs with the
 * v10.0.346 canary (single-flow synthetic test) and the v10.0.366
 * judge (per-message real-time score) to form a 3-tier eval system:
 *
 *   · Real-time judge   · every reply, async, immediate visibility
 *   · Daily canary      · one synthetic chat flow, 6 deterministic checks
 *   · Daily eval harness · gold-standard prompts, regression tracking ← this
 *   · Future: weekly LLM-as-judge eval over real conversation samples
 *
 * The benchmark runner (scripts/run-quality-bench.ts · v10.0.345) is the
 * canonical execution path. This route reuses the same gold prompts and
 * stores results in BrainMemory category=eval_run keyed by run timestamp.
 *
 * Folded into mega-evening · runs after Nick's daily activity, no
 * contention with morning canary.
 *
 * Auth · CRON_SECRET bearer (same pattern as v10.0.346 canary).
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { QUALITY_PROMPTS as GOLD_PROMPTS } from "@/tests/fixtures/quality-prompts.gold";
import { brainMemory } from "@/lib/brain/memory-manager";

export const maxDuration = 60;

interface EvalCheckResult {
  promptId: string;
  cat: number;
  pass: boolean;
  failures: string[];
  wordCount: number;
  outputPreview: string;
  durationMs: number;
}

interface EvalRun {
  ranAt: string;
  scenarioCount: number;
  passCount: number;
  failCount: number;
  passRate: number;
  results: EvalCheckResult[];
  regressions: string[]; // prompt IDs that passed yesterday and failed today
  totalDurationMs: number;
}

function authorizeCron(req: Request): boolean {
  const auth = req.headers.get("authorization") ?? "";
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return auth === `Bearer ${expected}`;
}

async function loadYesterdayResults(): Promise<Map<string, boolean>> {
  const since = new Date(Date.now() - 26 * 60 * 60 * 1000); // last 26h
  const yesterday = await prisma.brainMemory.findFirst({
    where: {
      category: "eval_run",
      createdAt: { gte: since },
      deletedAt: null,
    },
    orderBy: { createdAt: "desc" },
    select: { metadata: true },
  });
  if (!yesterday?.metadata) return new Map();
  const meta = yesterday.metadata as { results?: EvalCheckResult[] };
  if (!Array.isArray(meta.results)) return new Map();
  return new Map(meta.results.map((r) => [r.promptId, r.pass]));
}

async function runOnePrompt(prompt: typeof GOLD_PROMPTS[number]): Promise<EvalCheckResult> {
  const startedAt = Date.now();
  const failures: string[] = [];

  // Use the same direct AI call pattern as the canary · cron-only,
  // bypasses chat route, no message persistence.
  const { aiChat } = await import("@/lib/ai/provider");

  let output = "";
  try {
    const result = await aiChat(
      [
        { role: "system", content: "You are Nick · Nour's personal OS AI. Reply concisely, operator-grade." },
        { role: "user", content: prompt.user },
      ],
      "fast",
    );
    output = result.content || "";
  } catch (err) {
    failures.push(`provider_error: ${(err as Error).message?.slice(0, 100)}`);
    return {
      promptId: prompt.id,
      cat: prompt.cat,
      pass: false,
      failures,
      wordCount: 0,
      outputPreview: "",
      durationMs: Date.now() - startedAt,
    };
  }

  const wordCount = output.trim().split(/\s+/).filter(Boolean).length;
  const outputLower = output.toLowerCase();

  // Check mustMention
  if (prompt.checks.mustMention) {
    for (const m of prompt.checks.mustMention) {
      const present =
        m instanceof RegExp ? m.test(output) : outputLower.includes(m.toLowerCase());
      if (!present) failures.push(`missing: ${m instanceof RegExp ? m.source : m}`);
    }
  }
  // Check mustNotContain
  if (prompt.checks.mustNotContain) {
    for (const m of prompt.checks.mustNotContain) {
      const found =
        m instanceof RegExp ? m.test(output) : outputLower.includes(m.toLowerCase());
      if (found) failures.push(`forbidden: ${m instanceof RegExp ? m.source : m}`);
    }
  }
  // Word counts
  if (prompt.checks.minWords && wordCount < prompt.checks.minWords) {
    failures.push(`under_min_words: ${wordCount} < ${prompt.checks.minWords}`);
  }
  if (prompt.checks.maxWords && wordCount > prompt.checks.maxWords) {
    failures.push(`over_max_words: ${wordCount} > ${prompt.checks.maxWords}`);
  }

  return {
    promptId: prompt.id,
    cat: prompt.cat,
    pass: failures.length === 0,
    failures,
    wordCount,
    outputPreview: output.slice(0, 200),
    durationMs: Date.now() - startedAt,
  };
}

async function runEval(): Promise<EvalRun> {
  const startedAt = Date.now();
  const ranAt = new Date().toISOString();

  // Load yesterday for regression detection
  const yesterdayMap = await loadYesterdayResults();

  // Run prompts serially · keeps provider load predictable, no rate-limit risk
  const results: EvalCheckResult[] = [];
  for (const prompt of GOLD_PROMPTS) {
    results.push(await runOnePrompt(prompt));
  }

  const passCount = results.filter((r) => r.pass).length;
  const failCount = results.length - passCount;
  const passRate = results.length === 0 ? 0 : passCount / results.length;

  // Detect regressions · prompts passing yesterday but failing today
  const regressions: string[] = [];
  for (const r of results) {
    if (!r.pass && yesterdayMap.get(r.promptId) === true) {
      regressions.push(r.promptId);
    }
  }

  return {
    ranAt,
    scenarioCount: results.length,
    passCount,
    failCount,
    passRate: Math.round(passRate * 1000) / 1000,
    results,
    regressions,
    totalDurationMs: Date.now() - startedAt,
  };
}

export async function GET(req: Request) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const run = await runEval();

    // Persist · category=eval_run · keyed by ISO timestamp · idempotent
    // for the same minute (rare, but the upsert tolerates it)
    const key = `eval_run_${run.ranAt}`;
    const summary = `Eval ${run.passCount}/${run.scenarioCount} passed (${(run.passRate * 100).toFixed(1)}%)${
      run.regressions.length > 0 ? ` · ${run.regressions.length} regressions: ${run.regressions.join(", ")}` : ""
    }`;
    await brainMemory.remember(
      "eval_run",
      key,
      summary,
      "eval-harness",
      JSON.parse(JSON.stringify(run)) as Record<string, unknown>,
    );

    return NextResponse.json({
      ok: true,
      summary,
      passRate: run.passRate,
      regressions: run.regressions,
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message?.slice(0, 200) ?? "eval failed" },
      { status: 500 },
    );
  }
}
