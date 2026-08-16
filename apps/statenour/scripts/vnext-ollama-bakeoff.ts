/**
 * NICK VNEXT · Ollama Cloud model bake-off — runs INSIDE the existing
 * flat subscription (operator directive 2026-08-11: no new LLM spend).
 *
 * Standalone by design: talks to the Ollama Cloud OpenAI-compat endpoint
 * with bare fetch — lib/ai/provider.ts explicitly warns against importing
 * it from standalone tsx scripts, and a bake-off must not inherit the
 * runtime's fallback/rotation behavior anyway (we want raw per-model
 * truth, not the chain's self-healing).
 *
 * Method (deterministic scoring — no LLM judge, so the measurement can't
 * flatter itself):
 *   1. discover live models via GET /v1/models (Ollama Cloud retires
 *      models silently — deepseek-v3.1 died with HTTP 410, qwen3-vl with
 *      404 — so liveness-first is mandatory), intersect with CANDIDATES;
 *   2. per model x probe x REPS: tool-call fidelity (the OS's hard
 *      constraint — every action rides tool_calls), instruction
 *      discipline, deterministic reasoning, JSON validity; latency
 *      recorded per call;
 *   3. weighted score → chat-lane + fast-lane recommendations, written
 *      to docs/OLLAMA-BAKEOFF-<date>.md + .json.
 *
 * Usage (key never printed):
 *   $env:OLLAMA_API_KEY=<key>; pnpm exec tsx scripts/vnext-ollama-bakeoff.ts
 */

const BASE_URL = (process.env.OLLAMA_BASE_URL || "https://ollama.com").replace(/\/$/, "");
const API_KEY = (process.env.OLLAMA_API_KEY || "").trim();
// 2026-08-12 · rerunnable-by-subset: BAKEOFF_REPS + BAKEOFF_MODELS (comma
// list) let a finalist rerun raise the rep count without re-probing the
// whole catalog. Defaults preserve the original sweep behavior.
const REPS = Math.max(1, Number(process.env.BAKEOFF_REPS) || 2);
const CALL_TIMEOUT_MS = 90_000;

/**
 * Candidates = current pins + the strongest live contenders per lane,
 * refreshed 2026-08-11 against the live /v1/models listing (18 ids).
 * Dead ids from the old registry notes (qwen3-coder:480b, kimi-k2.5,
 * glm-5, mistral-large-3.2) are dropped rather than probed — the
 * discovery step would skip them anyway.
 */
const DEFAULT_CANDIDATES = [
  "deepseek-v4-pro", // current OLLAMA_MODEL (chat/reason lane)
  "glm-5.2", // current OLLAMA_FAST_MODEL
  "glm-5.1",
  "qwen3.5:397b",
  "kimi-k3",
  "mistral-large-3:675b",
  "nemotron-3-ultra",
  "minimax-m3",
  "gpt-oss:120b",
  // fast-lane contenders
  "deepseek-v4-flash:0731",
  "nemotron-3-nano:30b",
  "gpt-oss:20b",
];

const CANDIDATES = (process.env.BAKEOFF_MODELS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean).length
  ? (process.env.BAKEOFF_MODELS as string).split(",").map((s) => s.trim()).filter(Boolean)
  : DEFAULT_CANDIDATES;

interface ProbeResult {
  probe: string;
  pass: boolean;
  latencyMs: number;
  note?: string;
}

interface ModelReport {
  model: string;
  live: boolean;
  results: ProbeResult[];
  score: number;
  toolRate: number;
  instructionRate: number;
  reasoningRate: number;
  insightRate: number;
  jsonRate: number;
  medianLatencyMs: number;
}

async function chat(
  model: string,
  body: Record<string, unknown>,
): Promise<{ json: unknown; latencyMs: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({ model, stream: false, ...body }),
      signal: controller.signal,
    });
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${text.slice(0, 160)}`);
    }
    return { json: await res.json(), latencyMs };
  } finally {
    clearTimeout(timer);
  }
}

// 2026-08-15 · THE CONFOUND THIS FIXES.
// Every serious candidate on Ollama Cloud is a THINKING model (the catalog
// lists `thinking` on deepseek-v4-pro, minimax-m3, kimi-k3, nemotron-3-ultra,
// qwen3.5). They emit a reasoning trace before the answer — either fenced in
// <think> tags inside content, or in a sibling `reasoning_content` field.
//
// The original instruction probe asked for "Reply with exactly the word OK"
// with max_tokens: 20. A thinking model spends those 20 tokens on its trace and
// never reaches "OK", so `content === "OK"` fails for reasons that have nothing
// to do with instruction-following. In the 2026-08-11 sweep NINE of twelve
// models scored instruction 0 — that is the signature of a broken probe, not
// twelve models that cannot follow a one-word instruction. Instruction carried
// weight .2, so ~20% of every score was an artifact, and the published ranking
// (and the pin chosen from it) inherited it.
//
// Fix: separate the trace from the answer and score only the answer. Token
// budgets are raised at each call site for the same reason.
function messageOf(json: unknown): {
  content: string;
  reasoning: string;
  toolCalls: Array<{ function?: { name?: string; arguments?: string } }>;
} {
  const j = json as {
    choices?: Array<{
      message?: {
        content?: string | null;
        reasoning_content?: string | null;
        tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>;
      };
    }>;
  };
  const msg = j.choices?.[0]?.message;
  const raw = msg?.content ?? "";
  // Fenced traces: <think>…</think>, and an unterminated <think> when the
  // budget truncated mid-trace (answer never arrived — correctly scores 0).
  const fenced = raw.match(/<think>[\s\S]*?<\/think>/gi)?.join("\n") ?? "";
  const answer = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/i, "")
    .trim();
  return {
    content: answer,
    reasoning: [msg?.reasoning_content ?? "", fenced].filter(Boolean).join("\n").trim(),
    toolCalls: msg?.tool_calls ?? [],
  };
}

// ── The insight axis (2026-08-15, operator-requested) ────────────────────
//
// Operator: "it's not opening up new avenues and ideas and horizons... it's
// just telling me what I already know." NOTHING in this bake-off measured that.
// Its axes — tool fidelity, arithmetic, format discipline, JSON validity — all
// measure whether the model keeps the OS's machinery working. A model can score
// 0.9 on all of them and still be a boring thinking partner, which is exactly
// the state the operator is describing.
//
// HONEST LIMIT, read this before trusting the number: insight is not
// deterministically measurable. What follows is a set of PROXIES, and a
// determined model could game every one of them. They are kept deterministic on
// purpose — this file's founding rule is "no LLM judge, so the measurement
// can't flatter itself" — and they are directionally right rather than precise.
// Treat a low insight score as strong evidence and a high one as weak evidence.
//
// The prompt names the obvious answers and forbids them. That converts the
// operator's actual complaint into a measurable event: a model that returns the
// excluded answers is, literally, telling him what he already knows.
const INSIGHT_PROMPT =
  "77% of my auto shop's customers never come back after the first visit. " +
  "Give me your best thinking on why, and what to actually do about it. " +
  "I already know about loyalty programs, follow-up texts, and reminder emails — " +
  "do not suggest those.";

const OBVIOUS_EXCLUDED = /\b(loyalty program|rewards program|follow[- ]?up text|reminder email|punch card)\b/gi;
const TRADEOFF = /\b(but|however|unless|trade[- ]?off|downside|risk|caveat|the catch|fails? when|counter)\b/gi;
const HEDGE = /\b(it depends|consider|make sure|important to|be sure to|keep in mind|in general|generally speaking)\b/gi;
// Insight usually REFRAMES rather than answers: it attacks the premise, or says
// the number means something other than what was assumed. Slop accepts the
// question as posed and returns tactics.
const REFRAME = /\b(the real (question|problem|issue)|measuring the wrong|wrong (question|metric|thing)|premise|reframe|actually (a|an|the)|isn'?t (a|an|the) .{0,20}problem|misread)\b/gi;

/**
 * Length-normalised insight proxies.
 *
 * v1 (2026-08-15, same day) counted RAW OCCURRENCES: novel words >= 40,
 * numbers >= 2. Every real model blew through both by 6-10x simply by writing a
 * long answer — first run showed novel=287/249/262 against a threshold of 40 —
 * so the axis saturated at 1.0 and discriminated nothing. Worse, the check I ran
 * before shipping it compared a SHORT slop sample against a LONG good sample, so
 * what it actually validated was that the scorer separates short from long.
 * Real answers are all long. The verification was as length-confounded as the
 * metric.
 *
 * v2 scores DENSITIES (per 100 words) plus lexical variety, both invariant to
 * answer length, and adds a reframing signal. `words` is now reported in the
 * note so thresholds can be calibrated against a real distribution instead of
 * guessed a second time.
 *
 * Still proxies, still gameable, still deterministic on purpose. A low score
 * remains strong evidence; a high score remains weak evidence.
 */
function scoreInsight(answer: string): { points: number; note: string } {
  const text = answer.toLowerCase();
  const allWords = text.match(/[a-z][a-z'-]{2,}/g) ?? [];
  const words = allWords.length;
  if (words < 60) {
    return { points: -2, note: `words=${words} (too short to assess)` };
  }
  const per100 = 100 / words;

  const promptTerms = new Set(INSIGHT_PROMPT.toLowerCase().match(/[a-z]{5,}/g) ?? []);
  const content = allWords.filter((w) => w.length >= 5);
  const distinct = new Set(content);
  const novel = new Set([...distinct].filter((w) => !promptTerms.has(w)));

  // Lexical variety: distinct content words / content words. Slop recycles a
  // small vocabulary of advice nouns; dense analysis keeps introducing terms.
  const variety = content.length > 0 ? distinct.size / content.length : 0;
  const novelShare = distinct.size > 0 ? novel.size / distinct.size : 0;

  const tradeoffD = (answer.match(TRADEOFF) ?? []).length * per100;
  const numberD = (answer.match(/\b\d+(\.\d+)?%?\b/g) ?? []).length * per100;
  const hedgeD = (answer.match(HEDGE) ?? []).length * per100;
  const obvious = (answer.match(OBVIOUS_EXCLUDED) ?? []).length;
  const reframes = (answer.match(REFRAME) ?? []).length;

  let points = 0;
  if (variety >= 0.5) points += 1;      // varied vocabulary, not recycled advice nouns
  if (novelShare >= 0.85) points += 1;  // brings its own terms rather than echoing the prompt
  if (tradeoffD >= 0.5) points += 1;    // names a cost at least once per 200 words
  if (numberD >= 0.5) points += 1;      // concrete at least once per 200 words
  if (reframes >= 1) points += 1;       // challenges the premise instead of answering it flat
  if (hedgeD >= 1) points -= 1;         // advice-shaped filler
  if (obvious > 0) points -= 3;         // returned an answer the prompt ruled out

  return {
    points,
    note:
      `words=${words} var=${variety.toFixed(2)} novelShare=${novelShare.toFixed(2)} ` +
      `tradeoff/100=${tradeoffD.toFixed(2)} num/100=${numberD.toFixed(2)} ` +
      `hedge/100=${hedgeD.toFixed(2)} reframe=${reframes} obvious=${obvious}`,
  };
}

const CREATE_TASK_TOOL = {
  type: "function" as const,
  function: {
    name: "createTask",
    description: "Create a task in the operator's task system.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short task title" },
        due: { type: "string", description: "Due date, ISO or natural language" },
      },
      required: ["title"],
    },
  },
};

async function runProbe(model: string, probe: string): Promise<ProbeResult> {
  try {
    if (probe === "tool") {
      const { json, latencyMs } = await chat(model, {
        messages: [
          {
            role: "system",
            content: "You operate a task system. When asked to create a task you MUST call the createTask tool.",
          },
          { role: "user", content: "Add a task called Rotate the shop tires due tomorrow." },
        ],
        tools: [CREATE_TASK_TOOL],
        tool_choice: "required",
        max_tokens: 300,
      });
      const { toolCalls } = messageOf(json);
      const call = toolCalls[0];
      let argsOk = false;
      try {
        const args = JSON.parse(call?.function?.arguments || "{}") as { title?: unknown };
        argsOk = typeof args.title === "string" && /tire/i.test(args.title);
      } catch {
        argsOk = false;
      }
      const pass = call?.function?.name === "createTask" && argsOk;
      return { probe, pass, latencyMs, note: pass ? undefined : `calls=${toolCalls.length}` };
    }
    if (probe === "instruction") {
      const { json, latencyMs } = await chat(model, {
        messages: [{ role: "user", content: "Reply with exactly the word OK and nothing else." }],
        // 1500, not 20: a thinking model needs room to finish its trace before
        // the answer exists at all. See messageOf().
        max_tokens: 1500,
      });
      const { content } = messageOf(json);
      return { probe, pass: content.replace(/[.!]/g, "").trim() === "OK", latencyMs, note: content.slice(0, 40) };
    }
    if (probe === "reasoning") {
      const { json, latencyMs } = await chat(model, {
        messages: [
          {
            role: "user",
            content:
              "A shop sells 4 tires at $180 each with a $50 install package, minus a $75 rebate. Reply with only the final total dollar amount.",
          },
        ],
        max_tokens: 3000,
      });
      const { content } = messageOf(json);
      // 4*180 + 50 - 75 = 695
      return { probe, pass: /695/.test(content), latencyMs, note: content.slice(0, 40) };
    }
    if (probe === "insight") {
      const { json, latencyMs } = await chat(model, {
        messages: [{ role: "user", content: INSIGHT_PROMPT }],
        max_tokens: 4000,
      });
      const { content } = messageOf(json);
      const { points, note } = scoreInsight(content);
      return { probe, pass: points >= 3, latencyMs, note };
    }
    // json probe
    const { json, latencyMs } = await chat(model, {
      messages: [
        {
          role: "user",
          content:
            'Return ONLY a JSON object with keys "status" (string "green") and "count" (number 3). No prose, no code fence.',
        },
      ],
      max_tokens: 1500,
    });
    const { content } = messageOf(json);
    let pass = false;
    try {
      const cleaned = content.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
      const parsed = JSON.parse(cleaned) as { status?: unknown; count?: unknown };
      pass = parsed.status === "green" && parsed.count === 3;
    } catch {
      pass = false;
    }
    return { probe: "json", pass, latencyMs, note: pass ? undefined : content.slice(0, 40) };
  } catch (err) {
    return {
      probe,
      pass: false,
      latencyMs: -1,
      note: (err instanceof Error ? err.message : String(err)).slice(0, 120),
    };
  }
}

function rate(results: ProbeResult[], probe: string): number {
  const subset = results.filter((r) => r.probe === probe);
  if (subset.length === 0) return 0;
  return subset.filter((r) => r.pass).length / subset.length;
}

function median(nums: number[]): number {
  const clean = nums.filter((n) => n >= 0).sort((a, b) => a - b);
  if (clean.length === 0) return -1;
  return clean[Math.floor(clean.length / 2)];
}

async function main(): Promise<void> {
  if (!API_KEY) {
    console.error("OLLAMA_API_KEY is not set — aborting (no probes were run).");
    process.exitCode = 2;
    return;
  }

  // 1 · liveness discovery
  let liveIds: Set<string> | null = null;
  try {
    const res = await fetch(`${BASE_URL}/v1/models`, {
      headers: { authorization: `Bearer ${API_KEY}` },
    });
    if (res.ok) {
      const j = (await res.json()) as { data?: Array<{ id?: string }> };
      liveIds = new Set((j.data ?? []).map((m) => String(m.id)));
      console.log(`models endpoint: ${liveIds.size} live ids`);
    } else {
      console.log(`models endpoint HTTP ${res.status} — falling back to per-model liveness`);
    }
  } catch (err) {
    console.log(`models endpoint unreachable (${err instanceof Error ? err.message : err}) — per-model liveness`);
  }

  const reports: ModelReport[] = [];
  for (const model of CANDIDATES) {
    if (liveIds && !liveIds.has(model)) {
      reports.push({
        model, live: false, results: [], score: 0,
        toolRate: 0, instructionRate: 0, reasoningRate: 0, jsonRate: 0, insightRate: 0, medianLatencyMs: -1,
      });
      console.log(`SKIP ${model} — not in /v1/models`);
      continue;
    }
    const results: ProbeResult[] = [];
    const PROBE_SET = (process.env.BAKEOFF_PROBES || "")
      .split(",").map((x) => x.trim()).filter(Boolean);
    const probes = PROBE_SET.length > 0 ? PROBE_SET : ["tool", "instruction", "reasoning", "json", "insight"];
    for (const probe of probes) {
      for (let i = 0; i < REPS; i++) {
        const r = await runProbe(model, probe);
        results.push(r);
        console.log(`${model} · ${probe} #${i + 1}: ${r.pass ? "PASS" : "fail"} ${r.latencyMs}ms ${r.note ?? ""}`);
      }
    }
    const toolRate = rate(results, "tool");
    const instructionRate = rate(results, "instruction");
    const reasoningRate = rate(results, "reasoning");
    const jsonRate = rate(results, "json");
    const insightRate = rate(results, "insight");
    // Tool fidelity still leads — the OS runs on tool calls, and a model that
    // cannot call them breaks the product no matter how interesting it is. But
    // insight now carries real weight (.25): the previous weighting could not
    // distinguish a sharp thinking partner from a dull one, which is the exact
    // complaint that prompted this axis. Weights: tool .3 · insight .25 ·
    // reasoning .2 · instruction .15 · json .1.
    const score =
      toolRate * 0.3 + insightRate * 0.25 + reasoningRate * 0.2 + instructionRate * 0.15 + jsonRate * 0.1;
    reports.push({
      model,
      live: results.some((r) => r.latencyMs >= 0),
      results,
      score: Math.round(score * 1000) / 1000,
      toolRate, instructionRate, reasoningRate, jsonRate, insightRate,
      medianLatencyMs: median(results.map((r) => r.latencyMs)),
    });
  }

  const ranked = reports.filter((r) => r.live).sort((a, b) => b.score - a.score);
  const chatPick = ranked[0];
  const fastPick = [...ranked]
    .filter((r) => r.medianLatencyMs > 0)
    .sort(
      (a, b) =>
        b.instructionRate + b.jsonRate - (a.instructionRate + a.jsonRate) ||
        a.medianLatencyMs - b.medianLatencyMs,
    )[0];

  const date = process.env.BAKEOFF_DATE || "undated";
  const lines: string[] = [
    `# Ollama Cloud bake-off · ${date}`,
    "",
    "Deterministic probes on the existing flat subscription (no judge, no new spend).",
    `Reps per probe: ${REPS} · weights: tool .3 / insight .25 / reasoning .2 / instruction .15 / json .1`,
    "",
    "Insight is scored by deterministic PROXIES (novel vocabulary, named trade-offs,",
    "concreteness, and a penalty for returning answers the prompt explicitly excluded).",
    "A low score is strong evidence; a high score is weak evidence. See scoreInsight().",
    "",
    "| model | score | tool | insight | reasoning | instruction | json | median ms |",
    "|---|---|---|---|---|---|---|",
    ...reports.map(
      (r) =>
        `| ${r.model} | ${r.live ? r.score : "DEAD"} | ${r.toolRate} | ${r.insightRate} | ${r.reasoningRate} | ${r.instructionRate} | ${r.jsonRate} | ${r.medianLatencyMs} |`,
    ),
    "",
    `**Chat/reason lane pick:** ${chatPick ? `${chatPick.model} (score ${chatPick.score})` : "none live"}`,
    `**Fast lane pick:** ${fastPick ? `${fastPick.model} (instr ${fastPick.instructionRate} · json ${fastPick.jsonRate} · ${fastPick.medianLatencyMs}ms)` : "none live"}`,
    "",
    "Pins are Railway env (`OLLAMA_MODEL` / `OLLAMA_FAST_MODEL`) — operator applies; this script never mutates config.",
  ];

  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const outDir = path.join(process.cwd(), "docs");
  await fs.writeFile(path.join(outDir, `OLLAMA-BAKEOFF-${date}.md`), lines.join("\n"), "utf8");
  await fs.writeFile(
    path.join(outDir, `OLLAMA-BAKEOFF-${date}.json`),
    JSON.stringify(reports, null, 2),
    "utf8",
  );
  console.log(`\nwrote docs/OLLAMA-BAKEOFF-${date}.md (+ .json)`);
  console.log(`chat pick: ${chatPick?.model ?? "none"} · fast pick: ${fastPick?.model ?? "none"}`);
}

void main();
