/**
 * LLM call ledger (2026-09-01, audit F-21).
 *
 * Before this file there was NO per-call record of model usage: the reel
 * pipeline reserved and settled render spend, but chat, SMS drafting, review
 * replies, briefs and every other lane called invokeLLM with no receipt. Spend
 * and failure rate per lane were unknowable.
 *
 * Contract:
 *   - Never throws, never blocks: fire-and-forget, errors swallowed to a
 *     once-per-process warning.
 *   - Gated: LLM_LEDGER_ENABLED must be "true". The llm_calls table is created
 *     by the hand-applied drizzle/0116_llm_calls.sql; until the operator
 *     applies it the gate stays off and this module is inert.
 *   - Raw SQL insert on purpose: no projection-less select anywhere reads this
 *     table, and a raw insert keeps the write byte-stable regardless of how
 *     the Drizzle definition evolves.
 */
import type { InvokeParams, InvokeResult } from "../_core/llm";
import { createLogger } from "../lib/logger";

const log = createLogger("llm-ledger");

export interface LlmCallRecord {
  params: InvokeParams;
  model: string;
  latencyMs: number;
  ok: boolean;
  usage?: InvokeResult["usage"];
  error?: string;
  /** The calling function's name, captured SYNCHRONOUSLY by invokeLLM at entry (see callerLane). */
  lane?: string | null;
}

/** Frames that are plumbing, never a lane. */
const PLUMBING = /^(callerLane|invokeLLM|invokeLLMUnrecorded|recordLlmCall|laneForParams|Promise|Array|Function|Generator|Object|Module|process|processTicksAndRejections|then|catch|finally|next|<anonymous>)$/;

/**
 * The name of the first named function above the LLM wrapper on the current
 * stack — captured synchronously at invokeLLM entry, because by the time the
 * fire-and-forget insert runs the caller's frames are gone. Function names
 * survive the esbuild bundle (the build does not minify); file names do not
 * (production is one dist/index.js), which is why this is a name, not a path.
 * An anonymous caller yields null → "unlabeled": a lane that is wrong is worse
 * than one that is missing.
 */
export function callerLane(): string | null {
  const stack = new Error().stack ?? "";
  for (const line of stack.split("\n").slice(1)) {
    const m = /^\s*at\s+(?:async\s+)?([A-Za-z_$][\w$.<>]*)\s*\(/.exec(line);
    if (!m) continue;
    const segments = m[1].split(".");
    const fn = segments[segments.length - 1];
    if (!fn || PLUMBING.test(fn) || PLUMBING.test(m[1])) continue;
    const clean = fn.replace(/[^A-Za-z0-9_-]/g, "").toLowerCase().slice(0, 48);
    if (clean.length >= 2) return clean;
  }
  return null;
}

let warnedOnce = false;
let disabled = false; // set on the first insert failure — no point retrying a missing table every call

function ledgerEnabled(): boolean {
  return process.env.LLM_LEDGER_ENABLED === "true";
}

/** Provider is derived from the model id — the only stable signal we have. */
function providerForModel(model: string): "ollama" | "gemini" | "openai" | "anthropic" | "unknown" {
  const m = model.toLowerCase();
  if (m.startsWith("gemini") || m.startsWith("google/")) return "gemini";
  if (m.startsWith("gpt") || m.startsWith("o1") || m.startsWith("o3") || m.startsWith("o4")) return "openai";
  if (m.startsWith("claude")) return "anthropic";
  if (m.includes("deepseek") || m.includes("llama") || m.includes("qwen") || m.includes("mistral") || m.includes("gemma") || m.includes(":")) return "ollama";
  return "unknown";
}

/**
 * The lane, in order of trust: an explicit `[lane:<name>]` prefix on the first
 * system message (InvokeParams has no purpose field), then the calling
 * function's name captured by invokeLLM (callerLane), then "unlabeled". The
 * first production read-back (2026-09-02) showed every row "unlabeled" because
 * no caller uses the label — the captured caller is what makes the per-lane
 * view real. Kept deliberately dumb: a lane label that is wrong is worse than
 * "unlabeled".
 */
function laneForParams(params: InvokeParams, captured?: string | null): string {
  const first = params.messages?.[0];
  const content = first && typeof first.content === "string" ? first.content : "";
  const m = /^\[lane:([a-z0-9_-]{2,48})\]/i.exec(content.trim());
  if (m) return m[1].toLowerCase();
  if (captured && /^[a-z0-9_-]{2,48}$/.test(captured)) return captured;
  return "unlabeled";
}

function hadImages(params: InvokeParams): boolean {
  return (params.messages ?? []).some((msg) =>
    Array.isArray(msg.content) && msg.content.some((part) => (part as { type?: string }).type === "image_url"),
  );
}

export function recordLlmCall(rec: LlmCallRecord): void {
  if (!ledgerEnabled() || disabled) return;
  void (async () => {
    try {
      const { getDb } = await import("../db");
      const { sql } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) return;
      const model = rec.model.slice(0, 96);
      const provider = providerForModel(model);
      const lane = laneForParams(rec.params, rec.lane).slice(0, 64);
      // Hoisted out of the template: the raw-SQL column linter reads any
      // snake_case identifier inside sql`` as a column, and these are the
      // provider's usage-object property names, not columns.
      const promptTokens = rec.usage?.prompt_tokens ?? null;
      const completionTokens = rec.usage?.completion_tokens ?? null;
      const latencyMs = Math.max(0, Math.round(rec.latencyMs));
      const errorText = rec.ok ? null : (rec.error ?? "").slice(0, 200);
      const images = hadImages(rec.params) ? 1 : 0;
      await db.execute(sql`
        INSERT INTO llm_calls (model, provider, lane, promptTokens, completionTokens, latencyMs, ok, error, hadImages)
        VALUES (${model}, ${provider}, ${lane}, ${promptTokens}, ${completionTokens}, ${latencyMs}, ${rec.ok ? 1 : 0}, ${errorText}, ${images})
      `);
    } catch (err) {
      disabled = true;
      if (!warnedOnce) {
        warnedOnce = true;
        log.warn("llm_calls insert failed — ledger disabled for this process until restart (is 0116 applied?)", {
          err: err instanceof Error ? err.message.slice(0, 200) : String(err),
        });
      }
    }
  })();
}
