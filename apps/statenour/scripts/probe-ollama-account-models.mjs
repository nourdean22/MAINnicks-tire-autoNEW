/**
 * WHICH Ollama models can THIS ACCOUNT actually serve?
 *
 * ⚠ THE WHOLE POINT: a model appearing in the public ollama.com catalog is NOT
 * evidence that this key can serve it. That distinction has already cost this
 * repo real outages — see `lib/ai/model-liveness.ts`, which records TWO silent
 * retirements (qwen3-vl:235b, deepseek-v3.1:671b) and a SIX-WEEK vision outage
 * where a Railway env override pinned a retired id and every image turn 410'd.
 *
 * `model-liveness.ts` answers "is what we CONFIGURED still alive?". This answers
 * the other half: "what ELSE could we configure?" — the candidate side. Neither
 * substitutes for the other.
 *
 * Cost: Ollama Cloud is flat / un-metered on this account
 * (`config/ai-providers.ts` header), so liveness calls add no incremental spend.
 * Each probe requests ONE token and discards it.
 *
 * ⚠ NEVER PRINTS THE KEY. It reports presence and length only.
 *
 * READ-ONLY against the provider; touches no database.
 * Usage: railway run -s statenour-web -- node apps/statenour/scripts/probe-ollama-account-models.mjs
 */

const KEY = process.env.OLLAMA_API_KEY;
const BASE = (process.env.OLLAMA_BASE_URL || "https://ollama.com").replace(/\/+$/, "");

if (!KEY) {
  console.error("OLLAMA_API_KEY absent — refusing to guess an account.");
  process.exit(2);
}
console.log(`base: ${BASE}  ·  key present (${KEY.length} chars, not shown)`);

/**
 * Candidates. The incumbents come FIRST and act as the positive control: if
 * even the model production is currently using reads as dead, the probe itself
 * is broken and every other "dead" below is meaningless.
 */
const INCUMBENTS = ["minimax-m3", "deepseek-v4-flash:0731"];
const CANDIDATES = [
  "glm-5.3",
  "glm-5.3-flash",
  "deepseek-v4-pro",
  "kimi-k3",
  "qwen3-coder",
  "gemma4:31b",
];

async function listed() {
  for (const path of ["/api/tags", "/v1/models"]) {
    try {
      const res = await fetch(`${BASE}${path}`, {
        headers: { Authorization: `Bearer ${KEY}` },
      });
      if (!res.ok) continue;
      const j = await res.json();
      const names = (j.models ?? j.data ?? [])
        .map((m) => m.name ?? m.id ?? m.model)
        .filter(Boolean);
      if (names.length) return { path, names };
    } catch {
      /* try the next shape */
    }
  }
  return { path: null, names: [] };
}

/** One token, discarded. Distinguishes ALIVE from 404/410/402/401. */
async function liveness(model) {
  const started = Date.now();
  try {
    const res = await fetch(`${BASE}/api/chat`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "hi" }],
        stream: false,
        options: { num_predict: 1 },
      }),
    });
    const ms = Date.now() - started;
    if (res.ok) return { state: "ALIVE", status: res.status, ms };
    // 402 = payment/plan, 404/410 = retired or never served to this key,
    // 401/403 = auth. Each means something different and must not be merged.
    return { state: "DEAD", status: res.status, ms };
  } catch (e) {
    return { state: "ERROR", status: String(e.message).slice(0, 60), ms: Date.now() - started };
  }
}

async function main() {
  const { path, names } = await listed();
  console.log(
    path
      ? `\nlisting via ${path}: ${names.length} model(s) visible to this key`
      : "\n⚠ no listing endpoint answered — 'listed' below is UNKNOWN, not false",
  );
  // The FULL listing matters: a candidate may be alive under a TAGGED id
  // (`qwen3-coder:480b`) while the bare name 404s, and reporting the bare 404
  // as "retired" would be a false alarm of exactly the kind this file warns
  // about. It also caught that the listing is INCOMPLETE — deepseek-v4-pro
  // answers 200 while absent from /api/tags — so `listed: no` is not evidence.
  if (names.length) console.log(`  ${[...names].sort().join("\n  ")}`);

  const rows = [];
  for (const m of [...INCUMBENTS, ...CANDIDATES]) {
    const r = await liveness(m);
    rows.push({
      model: m,
      incumbent: INCUMBENTS.includes(m),
      listed: path ? (names.includes(m) ? "yes" : "no") : "?",
      ...r,
    });
  }

  const pad = (v, n) => String(v).padEnd(n);
  console.log(`\n${pad("model", 24)}${pad("listed", 8)}${pad("state", 7)}${pad("status", 8)}ms`);
  for (const r of rows) {
    console.log(
      `${pad(r.model + (r.incumbent ? " *" : ""), 24)}${pad(r.listed, 8)}${pad(r.state, 7)}${pad(r.status, 8)}${r.ms}`,
    );
  }
  console.log("  * = incumbent (the positive control)");

  // ── POSITIVE CONTROL ────────────────────────────────────────────────
  const controlAlive = rows.filter((r) => r.incumbent && r.state === "ALIVE");
  if (controlAlive.length === 0) {
    console.error(
      "\nABORT-LEVEL: NO incumbent answered ALIVE. Production is currently using one\n" +
        "of these, so the probe — not the catalog — is what is broken. Every 'DEAD'\n" +
        "above is meaningless until this passes. Do NOT act on this run.",
    );
    process.exitCode = 2;
    return;
  }

  const newlyAlive = rows.filter((r) => !r.incumbent && r.state === "ALIVE");
  console.log(
    `\ncontrol OK (${controlAlive.length}/${INCUMBENTS.length} incumbents alive).` +
      ` ${newlyAlive.length} candidate(s) serveable: ${newlyAlive.map((r) => r.model).join(", ") || "none"}`,
  );
  console.log(
    "\n⚠ SERVEABLE IS NOT BETTER. This says a model answers, nothing about quality,\n" +
      "  tool-calling correctness or false-refusal rate on real work. Route nothing on\n" +
      "  this alone — it is the INPUT to a championship, not a result.",
  );
}

main().catch((e) => {
  console.error("probe failed:", e.message);
  process.exit(1);
});
