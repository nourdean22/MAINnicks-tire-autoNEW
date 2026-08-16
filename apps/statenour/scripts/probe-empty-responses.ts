/**
 * READ-ONLY probe · why does the chat model return EMPTY responses?
 *
 * Measured 2026-08-15 in the persona A/B: 4 of 16 calls to minimax-m3 came back
 * with `chars=0` — not short, empty. Evenly split across both arms and all four
 * cases, so it is not a prompt effect. Production shows the same signature:
 * `provider.garbage provider="ollama" chars=0 preview=""`.
 *
 * Two candidate mechanisms, and they need different fixes:
 *
 *   A. TOKEN EXHAUSTION BY THINKING. minimax-m3 is a thinking model. If the
 *      trace consumes max_tokens, the API returns finish_reason="length" with
 *      empty `content` and the answer in `reasoning_content` (or nowhere).
 *      Fix = larger budget, and/or read reasoning_content as a fallback.
 *      This is the same confound that made the bake-off's instruction probe
 *      score nine models at zero.
 *
 *   B. UPSTREAM FLAKINESS. finish_reason="stop" with genuinely empty content.
 *      Fix = retry + failover (the rescue hop already covers this).
 *
 * finish_reason distinguishes them. No mutation, no DB, flat-subscription only.
 *
 * Usage: $env:OLLAMA_API_KEY=<key>; pnpm exec tsx scripts/probe-empty-responses.ts
 */
const BASE_URL = (process.env.OLLAMA_BASE_URL || "https://ollama.com").replace(/\/$/, "");
const API_KEY = (process.env.OLLAMA_API_KEY || "").trim();
const MODEL = process.env.PROBE_MODEL || "minimax-m3";
const N = Math.max(1, Number(process.env.PROBE_N) || 12);
const MAX_TOKENS = Math.max(256, Number(process.env.PROBE_MAX_TOKENS) || 4000);

const PROMPT =
  "77% of my auto shop's customers never come back after the first visit. Give me your best thinking on why, and what to actually do about it. I already know about loyalty programs, follow-up texts, and reminder emails — do not suggest those.";

interface Row {
  i: number;
  ms: number;
  finish: string;
  content: number;
  reasoning: number;
  completionTokens: number | null;
  err?: string;
}

async function once(i: number): Promise<Row> {
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        max_tokens: MAX_TOKENS,
        messages: [{ role: "user", content: PROMPT }],
      }),
    });
    const ms = Date.now() - t0;
    if (!res.ok) {
      return { i, ms, finish: `HTTP ${res.status}`, content: -1, reasoning: -1, completionTokens: null };
    }
    const j = (await res.json()) as {
      choices?: Array<{ finish_reason?: string; message?: { content?: string | null; reasoning_content?: string | null } }>;
      usage?: { completion_tokens?: number };
    };
    const c = j.choices?.[0];
    return {
      i,
      ms,
      finish: c?.finish_reason ?? "(none)",
      content: (c?.message?.content ?? "").length,
      reasoning: (c?.message?.reasoning_content ?? "").length,
      completionTokens: j.usage?.completion_tokens ?? null,
    };
  } catch (err) {
    return { i, ms: Date.now() - t0, finish: "throw", content: -1, reasoning: -1, completionTokens: null, err: String(err).slice(0, 90) };
  }
}

async function main() {
  if (!API_KEY) {
    console.error("OLLAMA_API_KEY not set");
    return;
  }
  console.log(`probe · model=${MODEL} · n=${N} · max_tokens=${MAX_TOKENS}\n`);
  const rows: Row[] = [];
  for (let i = 1; i <= N; i++) {
    const r = await once(i);
    rows.push(r);
    console.log(
      `#${String(i).padStart(2)} ${String(r.ms).padStart(6)}ms finish=${r.finish.padEnd(10)} content=${String(r.content).padStart(5)} reasoning=${String(r.reasoning).padStart(5)} completionTokens=${r.completionTokens ?? "?"}${r.err ? " " + r.err : ""}`,
    );
  }

  const empty = rows.filter((r) => r.content === 0);
  const byFinish = new Map<string, number>();
  for (const r of rows) byFinish.set(r.finish, (byFinish.get(r.finish) ?? 0) + 1);

  console.log(`\nempty content: ${empty.length}/${rows.length} (${Math.round((empty.length / rows.length) * 100)}%)`);
  console.log("finish_reason:", [...byFinish].map(([k, v]) => `${k}=${v}`).join(" · "));
  if (empty.length > 0) {
    // 2026-08-15 · CORRECTED. The first version keyed the verdict on
    // `reasoning_content` alone and printed "MECHANISM B — upstream returned
    // nothing" for a run whose own numbers disproved it: the empty call had
    // finish_reason="length" and completion_tokens=4000. A provider that
    // returned nothing bills ~0 completion tokens; 4000 generated tokens with
    // zero delivered characters is budget exhaustion by an INVISIBLE trace —
    // this API exposes no reasoning_content at all, so absence of that field
    // says nothing. Token count is the discriminator, not the field.
    const withReasoning = empty.filter((r) => r.reasoning > 0).length;
    const burnedBudget = empty.filter((r) => (r.completionTokens ?? 0) >= MAX_TOKENS * 0.9).length;
    console.log(
      `of the empty ones: ${burnedBudget} burned >=90% of the token budget · ${withReasoning} exposed reasoning_content`,
    );
    // Report BOTH classifications (review, 2026-08-16). A single verdict keyed
    // on `burnedBudget > 0` labelled an entire run mechanism A even when most
    // empties were mechanism B — and the two need DIFFERENT fixes (raise the
    // budget vs retry/failover). One row of the wrong kind would have sent the
    // reader after the wrong repair.
    const upstream = empty.length - burnedBudget;
    console.log(`  MECHANISM A (budget exhausted, raise max_tokens): ${burnedBudget}`);
    console.log(`  MECHANISM B (upstream returned nothing, retry + failover): ${upstream}`);
    if (burnedBudget > 0 && upstream > 0) {
      console.log("verdict: MIXED — both mechanisms present; each needs its own fix, do not treat as one cause");
    } else if (burnedBudget > 0) {
      console.log("verdict: MECHANISM A — every empty response burned its budget; raise max_tokens");
    } else {
      console.log("verdict: MECHANISM B — no empty response burned its budget; budget is not the constraint");
    }
    const truncated = rows.filter((r) => r.finish === "length").length;
    if (truncated > 0) {
      console.log(
        `NOTE: ${truncated}/${rows.length} hit finish_reason="length" — answers are being cut off, not just the empty ones.`,
      );
    }
  }
}

void main();
