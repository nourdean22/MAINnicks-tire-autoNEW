/**
 * Cage match (2026-08-06) — an adversarial caller red-teams the phone agent,
 * entirely offline.
 *
 * The synthetic-call harness checks config drift and agenticAuditor grades
 * REAL logged calls; neither replays a conversation. This is the missing
 * middle: an LLM plays the worst callers the shop has actually had (seeded
 * from real failed calls — lost_opportunity / callback_needed / tech_failure
 * rows, with full transcripts from vapi_call_archives once the Ossuary
 * fills), against the SAME system prompt the live assistant serves
 * (ASSISTANT_SYSTEM_PROMPT — read-only import, not a copy that can drift).
 *
 * ZERO customer contact: no VAPI calls, no sends, no writes. Losses become
 * eval-case JSONL under eval-datasets/ for the regression corpus.
 *
 * Grading is DETERMINISTIC (v1): extractCallSignals over the simulated
 * transcript + a resolution-offered check. No LLM judge — the judge lane is
 * credit-dead (2026-08-06 probe), and a deterministic grade cannot be
 * sweet-talked by the agent under test.
 *
 * Run:  pnpm exec tsx scripts/cage-match.ts --probe      # one-call LLM lane check
 *       pnpm exec tsx scripts/cage-match.ts --seeds 3 --turns 6
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

function loadEnvFromDotenv(): void {
  try {
    const text = readFileSync(resolve(process.cwd(), ".env"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* shell may already carry the vars */ }
}
loadEnvFromDotenv();

interface SeedRow {
  vapiCallId: string;
  aiSummary: string | null;
  evalOutcome: string | null;
  evalReasoning: string | null;
  transcript: string | null;
}

/**
 * Role diversity (2026-08-06 directive): the adversarial caller runs on a
 * DIFFERENT model from the receptionist under test — the same model on both
 * sides of a duel creates correlated blind spots. Default set by TOURNAMENT
 * EVIDENCE, not reputation (#1396 scorecard): gpt-oss:120b scored 100% pass /
 * 100% consistency at 1835ms and is a different model family from the
 * deepseek receptionist lane — maximum family diversity. (glm-5.2 also
 * scored 100/100 but was slowest at 3403ms and empty-burned once live.)
 * The receptionist rides the default lane exactly as production does. The
 * grader is deterministic code — no model at all.
 */
const ADVERSARY_MODEL = process.env.CAGE_ADVERSARY_MODEL || "gpt-oss:120b";

async function llm(system: string, user: string, maxTokens: number, model?: string): Promise<string> {
  const { invokeLLM } = await import("../server/_core/llm");
  const res = await invokeLLM({
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    maxTokens,
    timeoutMs: 60000,
    ...(model ? { model } : {}),
  });
  const raw = res.choices?.[0]?.message?.content ?? "";
  const text = typeof raw === "string" ? raw : JSON.stringify(raw);
  // Thinking models can burn the whole token budget on reasoning and emit
  // empty content. An empty line must be a LOUD failure — the first live run
  // graded 9 turns of empty strings as "losses", a fabricated result.
  if (!text.trim()) throw new Error(`empty model output (reasoning burn? raise maxTokens) from ${model ?? "default lane"}`);
  return text;
}

async function probe(): Promise<boolean> {
  try {
    const out = await llm("Reply with exactly: OK", "liveness probe", 256);
    console.log(`probe OK — LLM lane live (${out.slice(0, 20)})`);
    return true;
  } catch (err) {
    console.log(`probe FAILED — LLM lane down: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`);
    return false;
  }
}

function callerPersona(seed: SeedRow): string {
  return [
    "# ROLE",
    "You are a phone CALLER to Nick's Tire & Auto in Cleveland. You are a composite of a real call that the shop's AI receptionist FAILED to resolve.",
    "# THE REAL CALL YOU ARE REPLAYING (harder)",
    `Summary: ${seed.aiSummary ?? "(none)"}`,
    `Why it failed: ${seed.evalReasoning ?? seed.evalOutcome ?? "unknown"}`,
    seed.transcript ? `Original transcript excerpt:\n${seed.transcript.slice(0, 1200)}` : "",
    "# RULES",
    "- Stay in character as the caller. One short spoken turn at a time, phone-natural.",
    "- Escalate the SAME pressure that broke the original call: be vaguer, more impatient, or more price-resistant than the original caller.",
    "- Never mention being an AI or a test. End the call (say goodbye) only if the agent gives you a concrete, satisfying next step.",
  ].filter(Boolean).join("\n");
}

interface MatchResult {
  vapiCallId: string;
  turns: number;
  transcript: string;
  resolutionOffered: boolean;
  signals: unknown;
  loss: boolean;
}

// Kept in lockstep with ghostReplay.RESOLUTION_RX (transfer language added
// 2026-08-06 — a live transfer IS a resolution).
const RESOLUTION_RX = /(walk[- ]?in|come (on )?(in|by|up)|pull up|we can get you in|book|schedule|call you back|text you|first[- ]come|transfer(ring)? you|connect(ing)? you|put you through|get(ting)? you (over )?to (him|her|them|the shop|someone|a person|the manager))/i;

async function runMatch(seed: SeedRow, maxTurns: number): Promise<MatchResult> {
  const { ASSISTANT_SYSTEM_PROMPT } = await import("../server/services/vapi");
  const { extractCallSignals } = await import("../server/services/vapiCallClassifier");

  const lines: string[] = [];
  let callerLine = await llm(callerPersona(seed), "Place the call. Your opening line:", 700, ADVERSARY_MODEL);
  lines.push(`User: ${callerLine.trim()}`);

  for (let t = 0; t < maxTurns; t++) {
    const agentLine = await llm(
      ASSISTANT_SYSTEM_PROMPT,
      `Phone call so far:\n${lines.join("\n")}\n\nYour next spoken line as the receptionist (one turn, no stage directions):`,
      700,
    );
    lines.push(`AI: ${agentLine.trim()}`);
    if (/goodbye|bye|see you|thanks,? (that's|that is) all/i.test(callerLine)) break;
    callerLine = await llm(
      callerPersona(seed),
      `Call so far:\n${lines.join("\n")}\n\nYour next line as the caller (stay difficult; hang up only if truly satisfied):`,
      700,
      ADVERSARY_MODEL,
    );
    lines.push(`User: ${callerLine.trim()}`);
  }

  const transcript = lines.join("\n");
  const signals = extractCallSignals({ transcript, summary: seed.aiSummary ?? null });
  const resolutionOffered = RESOLUTION_RX.test(lines.filter((l) => l.startsWith("AI:")).join("\n"));
  return {
    vapiCallId: seed.vapiCallId,
    turns: lines.length,
    transcript,
    resolutionOffered,
    signals,
    loss: !resolutionOffered,
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--probe")) process.exit((await probe()) ? 0 : 1);
  const seedsIdx = args.indexOf("--seeds");
  const turnsIdx = args.indexOf("--turns");
  const seedCount = seedsIdx >= 0 ? Math.max(1, Math.min(10, parseInt(args[seedsIdx + 1], 10) || 3)) : 3;
  const maxTurns = turnsIdx >= 0 ? Math.max(2, Math.min(10, parseInt(args[turnsIdx + 1], 10) || 6)) : 6;

  if (!(await probe())) {
    console.log("aborting — the LLM lane is down (same top-up blocks retro-tournament).");
    process.exit(1);
  }

  const { getDb } = await import("../server/db");
  const d = await getDb();
  if (!d) throw new Error("no DB");
  const { sql } = await import("drizzle-orm");
  const [raw] = await d.execute(sql`
    SELECT l.vapiCallId, l.aiSummary, l.eval_outcome AS evalOutcome,
           l.eval_reasoning AS evalReasoning, a.transcript
    FROM vapi_call_logs l
    LEFT JOIN vapi_call_archives a ON a.vapi_call_id = l.vapiCallId
    WHERE l.eval_outcome IN ('lost_opportunity','callback_needed','tech_failure')
    ORDER BY l.createdAt DESC
    LIMIT ${seedCount}
  `);
  const seeds = raw as unknown as SeedRow[];
  if (!seeds.length) {
    console.log("no failed-call seeds found");
    process.exit(0);
  }

  const results: MatchResult[] = [];
  for (const seed of seeds) {
    console.log(`match vs ${seed.vapiCallId} (${seed.evalOutcome})...`);
    try {
      results.push(await runMatch(seed, maxTurns));
    } catch (err) {
      console.log(`  match failed: ${err instanceof Error ? err.message.slice(0, 120) : String(err)}`);
    }
  }

  const losses = results.filter((r) => r.loss);
  const outDir = join(process.cwd(), "eval-datasets");
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, "cage-match-losses.jsonl");
  writeFileSync(
    file,
    losses.map((r) => JSON.stringify({
      input: { transcript: r.transcript, seededFrom: r.vapiCallId },
      expected: { resolutionOffered: true, note: "the agent must land a concrete next step under this pressure" },
      metadata: { app: "nickstire", feature: "voice-agent-regression", source: "cage-match", exported_at: new Date().toISOString() },
    })).join("\n") + (losses.length ? "\n" : ""),
  );
  console.log(`\n── cage match readout ──`);
  console.log(`${results.length} matches · ${losses.length} losses (no concrete resolution offered) → ${file}`);
  for (const r of results) {
    console.log(`  ${r.loss ? "✗ LOSS" : "✓ hold"} vs ${r.vapiCallId} · ${r.turns} turns · resolutionOffered=${r.resolutionOffered}`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("[cage-match] fatal:", err);
  process.exit(1);
});
