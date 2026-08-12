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
const REPS = 2;
const CALL_TIMEOUT_MS = 90_000;

/**
 * Candidates = current pins + the strongest live contenders per lane,
 * refreshed 2026-08-11 against the live /v1/models listing (18 ids).
 * Dead ids from the old registry notes (qwen3-coder:480b, kimi-k2.5,
 * glm-5, mistral-large-3.2) are dropped rather than probed — the
 * discovery step would skip them anyway.
 */
const CANDIDATES = [
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

function messageOf(json: unknown): {
  content: string;
  toolCalls: Array<{ function?: { name?: string; arguments?: string } }>;
} {
  const j = json as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>;
      };
    }>;
  };
  const msg = j.choices?.[0]?.message;
  return { content: (msg?.content ?? "").trim(), toolCalls: msg?.tool_calls ?? [] };
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
        max_tokens: 20,
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
        max_tokens: 400,
      });
      const { content } = messageOf(json);
      // 4*180 + 50 - 75 = 695
      return { probe, pass: /695/.test(content), latencyMs, note: content.slice(0, 40) };
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
      max_tokens: 120,
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
        toolRate: 0, instructionRate: 0, reasoningRate: 0, jsonRate: 0, medianLatencyMs: -1,
      });
      console.log(`SKIP ${model} — not in /v1/models`);
      continue;
    }
    const results: ProbeResult[] = [];
    for (const probe of ["tool", "instruction", "reasoning", "json"]) {
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
    // Tool fidelity dominates — the OS runs on tool calls (provider.ts's
    // own model-selection rationale). Weights: tool .4 · reasoning .25 ·
    // instruction .2 · json .15.
    const score = toolRate * 0.4 + reasoningRate * 0.25 + instructionRate * 0.2 + jsonRate * 0.15;
    reports.push({
      model,
      live: results.some((r) => r.latencyMs >= 0),
      results,
      score: Math.round(score * 1000) / 1000,
      toolRate, instructionRate, reasoningRate, jsonRate,
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
    `Reps per probe: ${REPS} · weights: tool .4 / reasoning .25 / instruction .2 / json .15`,
    "",
    "| model | score | tool | reasoning | instruction | json | median ms |",
    "|---|---|---|---|---|---|---|",
    ...reports.map(
      (r) =>
        `| ${r.model} | ${r.live ? r.score : "DEAD"} | ${r.toolRate} | ${r.reasoningRate} | ${r.instructionRate} | ${r.jsonRate} | ${r.medianLatencyMs} |`,
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
