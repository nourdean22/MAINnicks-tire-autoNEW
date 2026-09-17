/**
 * WHICH Ollama models can THIS ACCOUNT actually serve?
 *
 * A model appearing in the public ollama.com catalog is NOT evidence that this
 * key can serve it. `lib/ai/model-liveness.ts` answers "is what we CONFIGURED
 * still alive?"; this answers the other half — "what ELSE could we configure?".
 * Neither substitutes for the other.
 *
 * Cost: Ollama Cloud is flat / un-metered on this account
 * (`config/ai-providers.ts`), so liveness calls add no incremental spend. Each
 * probe requests ONE token and discards it.
 *
 * ⚠ NEVER PRINTS THE KEY. It reports presence and length only.
 *
 * All logic lives in `./lib/ollama-census.mjs` behind an injectable fetch, so
 * `tests/scripts/ollama-census.test.ts` can break it and assert failure — the
 * embedded incumbent check is a RUNTIME control, which cannot catch a parsing
 * or classification regression before an operator acts on the census.
 *
 * READ-ONLY against the provider; touches no database.
 * Usage: railway run -s statenour-web -- node apps/statenour/scripts/probe-ollama-account-models.mjs
 */
import { pathToFileURL } from "node:url";
import { runCensus, DEFAULT_TIMEOUT_MS } from "./lib/ollama-census.mjs";

/** Incumbents come FIRST and act as the positive control. */
export const INCUMBENTS = ["minimax-m3", "deepseek-v4-flash:0731"];
export const CANDIDATES = [
  "glm-5.3",
  "glm-5.3-flash",
  "deepseek-v4-pro",
  "kimi-k3",
  "qwen3-coder",
  "gemma4:31b",
];

export function formatCensus(result, { base, keyLength }) {
  const out = [`base: ${base}  ·  key present (${keyLength} chars, not shown)`];
  const { listing, rows, controlOk, newlyAlive } = result;

  out.push(
    listing.path
      ? `\nlisting via ${listing.path}: ${listing.names.length} model(s) visible to this key`
      : "\n⚠ no listing endpoint answered — 'listed' below is UNKNOWN, not false",
  );
  // The FULL listing matters: a candidate may be alive under a TAGGED id while
  // the bare name 404s. It also caught that the listing is INCOMPLETE —
  // deepseek-v4-pro answers 200 while absent — so `listed: no` is not evidence.
  if (listing.names.length) out.push(`  ${[...listing.names].sort().join("\n  ")}`);

  const pad = (v, n) => String(v).padEnd(n);
  out.push(`\n${pad("model", 24)}${pad("listed", 8)}${pad("state", 7)}${pad("status", 10)}ms`);
  for (const r of rows) {
    out.push(
      `${pad(r.model + (r.incumbent ? " *" : ""), 24)}${pad(r.listed, 8)}${pad(r.state, 7)}${pad(r.status, 10)}${r.ms}`,
    );
  }
  out.push("  * = incumbent (the positive control)");

  if (!controlOk) {
    out.push(
      "\nABORT-LEVEL: NO incumbent answered ALIVE. Production is currently using one\n" +
        "of these, so the probe — not the catalog — is what is broken. Every 'DEAD'\n" +
        "above is meaningless until this passes. Do NOT act on this run.",
    );
    return out;
  }

  out.push(
    `\ncontrol OK. ${newlyAlive.length} candidate(s) serveable: ${newlyAlive.join(", ") || "none"}`,
  );
  out.push(
    "\n⚠ SERVEABLE IS NOT BETTER. This says a model answers, nothing about quality,\n" +
      "  tool-calling correctness or false-refusal rate on real work. Route nothing on\n" +
      "  this alone — it is the INPUT to a championship, not a result.",
  );
  return out;
}

async function main() {
  const key = process.env.OLLAMA_API_KEY;
  const base = (process.env.OLLAMA_BASE_URL || "https://ollama.com").replace(/\/+$/, "");
  if (!key) {
    console.error("OLLAMA_API_KEY absent — refusing to guess an account.");
    process.exit(2);
  }
  const result = await runCensus({
    base,
    key,
    incumbents: INCUMBENTS,
    candidates: CANDIDATES,
    fetchImpl: fetch,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  });
  for (const line of formatCensus(result, { base, keyLength: key.length })) console.log(line);
  if (!result.controlOk) process.exit(2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error("probe failed:", e.message);
    process.exit(1);
  });
}
