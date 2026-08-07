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

/**
 * The receptionist lane is PINNED, not ambient (2026-08-07). Before this pin,
 * the agent side rode whatever the invoking shell's env resolved to — gpt-4o
 * on OpenAI without AI_FORCE_OLLAMA, or the forced model with it — so the
 * lane under test depended on shell state invisible to the readout. Prod runs
 * AI_FORCE_OLLAMA=true → OLLAMA_MODEL || deepseek-v4-pro; this pin mirrors
 * that resolution explicitly. Both pins are Ollama-native substrings, so they
 * route to the Ollama lane with no force flag at all.
 */
const AGENT_MODEL = process.env.CAGE_AGENT_MODEL || "deepseek-v4-pro";

// AI_FORCE_OLLAMA flattens EVERY request onto one model — including the
// adversary pin above, silently putting the same model on both sides of the
// duel. The cage owns its routing (explicit pins both sides), so strip the
// flag from THIS process only; prod config is untouched.
if (process.env.AI_FORCE_OLLAMA === "true") {
  console.log("note: AI_FORCE_OLLAMA=true detected — unset for this process so the two duel lanes stay distinct");
  delete process.env.AI_FORCE_OLLAMA;
}

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
  let text = typeof raw === "string" ? raw : JSON.stringify(raw);
  if (!text.trim()) {
    // ONE bounded retry at a bigger budget — same instrument-parity fix
    // ghostReplay carries: a token-budget artifact is a measurement bug, but
    // a second empty is a LOUD failure (the first live run graded 9 empty
    // turns as "losses", a fabricated result — never again).
    const retry = await invokeLLM({
      messages: [
        { role: "system", content: system },
        { role: "user", content: `${user}\n\n(One short spoken sentence only, no analysis.)` },
      ],
      maxTokens: 1400,
      timeoutMs: 60000,
      ...(model ? { model } : {}),
    });
    const retryRaw = retry.choices?.[0]?.message?.content ?? "";
    text = typeof retryRaw === "string" ? retryRaw : JSON.stringify(retryRaw);
  }
  if (!text.trim()) throw new Error(`empty model output after retry (reasoning burn) from ${model ?? "default lane"}`);
  return text;
}

/**
 * Probe the EXACT lanes the matches will use — one per model. The 2026-08-07
 * gauntlet burned all 8 seeds against a dead adversary lane after a probe of
 * the ambient default lane passed: a liveness check that exercises a
 * different lane than the real work is a false-green generator.
 */
async function probe(model: string, label: string): Promise<boolean> {
  try {
    const out = await llm("Reply with exactly: OK", "liveness probe", 256, model);
    console.log(`probe OK — ${label} lane live on ${model} (${out.slice(0, 20)})`);
    return true;
  } catch (err) {
    console.log(`probe FAILED — ${label} lane (${model}) down: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`);
    return false;
  }
}

async function probeBothLanes(): Promise<boolean> {
  const agentOk = await probe(AGENT_MODEL, "agent");
  const advOk = ADVERSARY_MODEL === AGENT_MODEL ? agentOk : await probe(ADVERSARY_MODEL, "adversary");
  return agentOk && advOk;
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
  /** Set only when the regex missed and the semantic judge was consulted. */
  judgeReason?: string;
  signals: unknown;
  loss: boolean;
}

// Kept in lockstep with ghostReplay.RESOLUTION_RX (transfer language added
// 2026-08-06 — a live transfer IS a resolution).
const RESOLUTION_RX = /(walk[- ]?in|come (on )?(in|by|up)|swing by|stop by|pull up|we can get you in|book|schedule|call you back|text you|first[- ]come|transferr?(ing)?\b|connect(ing)? (you|the call)|put you through|get(ting)? you (over )?(to )?(him|her|them|someone|a person|the (shop|counter|floor|manager))|(let me |i'll )get (him|her|them|someone)\b)/i;

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
      AGENT_MODEL,
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
  const agentLines = lines.filter((l) => l.startsWith("AI:"));
  let resolutionOffered = RESOLUTION_RX.test(agentLines.join("\n"));
  let judgeReason: string | undefined;
  if (!resolutionOffered) {
    // INSTRUMENT PARITY (2026-08-07): the same semantic backstop ghost replay
    // uses. The regex is a fast path; three rounds of MoE re-phrasing proved
    // enumeration loses that race. Unlike ghost replay, the cage's adversary
    // never hangs up, so an "unresolvable" verdict here is genuinely rare —
    // it counts as a non-loss rather than shrinking a denominator.
    const { judgeResolution } = await import("../server/services/resolutionJudge");
    const judged = await judgeResolution(
      lines.filter((l) => l.startsWith("User:")).map((l) => l.slice(6)),
      agentLines.map((l) => l.slice(4)),
    );
    judgeReason = `${judged.verdict}: ${judged.reason}`;
    resolutionOffered = judged.verdict !== "unresolved";
  }
  return {
    vapiCallId: seed.vapiCallId,
    turns: lines.length,
    transcript,
    resolutionOffered,
    judgeReason,
    signals,
    loss: !resolutionOffered,
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (!process.env.OLLAMA_API_KEY) {
    // Both duel pins are Ollama-native. Fail before burning seeds: the key is
    // NOT in apps/nickstire/.env — inject it into the shell for local runs
    // (its home is the statenour service env / apps/statenour/.env).
    console.error("OLLAMA_API_KEY is not set — both cage lanes ride Ollama Cloud. Inject the key before running.");
    process.exit(1);
  }
  if (args.includes("--probe")) process.exit((await probeBothLanes()) ? 0 : 1);
  const seedsIdx = args.indexOf("--seeds");
  const turnsIdx = args.indexOf("--turns");
  const seedCount = seedsIdx >= 0 ? Math.max(1, Math.min(10, parseInt(args[seedsIdx + 1], 10) || 3)) : 3;
  const maxTurns = turnsIdx >= 0 ? Math.max(2, Math.min(10, parseInt(args[turnsIdx + 1], 10) || 6)) : 6;

  if (!(await probeBothLanes())) {
    console.log("aborting — an LLM lane is down (same top-up blocks retro-tournament).");
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

  if (!results.length) {
    // 0 matches must NEVER render as 0 losses — the 2026-08-07 run failed all
    // 8 matches on a dead lane and still printed a clean readout with exit 0.
    console.error(`\nALL ${seeds.length} MATCHES FAILED — no measurement happened. This run proves nothing about the prompt.`);
    process.exit(1);
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
    console.log(`  ${r.loss ? "✗ LOSS" : "✓ hold"} vs ${r.vapiCallId} · ${r.turns} turns · resolutionOffered=${r.resolutionOffered}${r.judgeReason ? ` · judge ${r.judgeReason}` : ""}`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("[cage-match] fatal:", err);
  process.exit(1);
});
