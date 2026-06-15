/**
 * NickGPT client · the fine-tuned 3B SMS-drafter
 *
 * Calls an Ollama-hosted fine-tuned Llama-3.2-3B model trained on
 * operator-approved SMS reply pairs. The training pipeline lives at
 * docs/runbooks/nickgpt-finetune.md. The export script lives at
 * scripts/export-sms-corpus.ts.
 *
 * This file is the SERVING layer · feature-flag-gated, with a clear
 * fallback to the existing Anthropic/Venice drafter so flipping the
 * flag OFF is a safe rollback.
 *
 * Activation order (operator action):
 *   1. Run scripts/export-sms-corpus.ts → produces a JSONL training set
 *   2. Run docs/runbooks/nickgpt-finetune.md (LoRA on Modal · 4hr · ~$50)
 *   3. Deploy resulting .gguf to Ollama on Railway as a new service
 *   4. Set NICKGPT_OLLAMA_URL + NICKGPT_MODEL_NAME env vars
 *   5. Enable feature flag `nickgpt_drafter_enabled`
 *   6. Monitor draft quality + iterate · re-fine-tune monthly
 */

import { createLogger } from "../lib/logger";
import { withTimeout } from "@nour/utils";
import { BUSINESS } from "@shared/business";

const log = createLogger("nickgpt-client");

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_TOKENS = 320; // SMS-length cap

interface DraftOpts {
  /** Inbound customer message that needs a reply */
  inboundMessage: string;
  /** Optional · the last N turns of conversation context for grounding */
  conversationContext?: Array<{ role: "user" | "assistant"; content: string }>;
  /** Optional · operator-tuned system prompt override */
  systemPrompt?: string;
  /** Optional · max tokens; SMS-length default 320 */
  maxTokens?: number;
  /** Optional · temperature; 0.5 default · balance between voice fidelity and variety */
  temperature?: number;
  /** Optional · request timeout */
  timeoutMs?: number;
}

interface DraftResult {
  ok: true;
  draft: string;
  source: "nickgpt-ollama" | "fallback-claude" | "fallback-venice";
  modelName: string;
  latencyMs: number;
}

interface DraftError {
  ok: false;
  error: string;
  source: "nickgpt-ollama" | "fallback-claude" | "fallback-venice" | "disabled";
}

export type DraftResponse = DraftResult | DraftError;

// Same default prompt as scripts/export-sms-corpus.ts SYSTEM_PROMPT —
// keep in sync · the fine-tuned model expects it.
const DEFAULT_SYSTEM_PROMPT = `You are Nick, the owner-operator of Nick's Tire & Auto in Cleveland/Euclid, Ohio. You text customers personally — never sound like a chatbot. Be direct, helpful, and real. Customers don't pay until they say yes to the work. You handle tire sales, brakes, oil changes, and check-engine/repair work. The ONLY prices you ever quote are: ${BUSINESS.usedTires.explanation}, conventional oil change $49, synthetic oil change $80. For ANY other repair, never guess a price — say "free check, written quote, you don't pay until you say yes." When you don't know an answer, say so and offer to call. Walk-ins welcome 7 days a week (Mon-Sat 8-6, Sun 9-4), 17625 Euclid Ave, (216) 862-0005. Keep replies under 320 characters when possible. Match the customer's tone — formal with formal, casual with casual.`;

/**
 * True if the NickGPT path should be attempted. Both the env vars must
 * exist AND the feature flag must be ON.
 */
async function isNickGptEnabled(): Promise<boolean> {
  if (!process.env.NICKGPT_OLLAMA_URL) return false;
  if (!process.env.NICKGPT_MODEL_NAME) return false;
  try {
    const { isEnabled } = await import("./featureFlags");
    return await isEnabled("nickgpt_drafter_enabled");
  } catch (err) {
    log.warn("Feature-flag lookup failed · falling back", {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Ollama HTTP /api/chat request. Returns the assistant message text on
 * success, OR throws. Timeout-wrapped so a hung Ollama doesn't block
 * the caller.
 */
async function callOllama(opts: Required<Pick<DraftOpts, "inboundMessage" | "systemPrompt" | "maxTokens" | "temperature" | "timeoutMs">> & { conversationContext: DraftOpts["conversationContext"] }): Promise<string> {
  const url = process.env.NICKGPT_OLLAMA_URL!;
  const model = process.env.NICKGPT_MODEL_NAME!;

  const messages: Array<{ role: string; content: string }> = [
    { role: "system", content: opts.systemPrompt },
  ];
  if (opts.conversationContext) {
    for (const m of opts.conversationContext) {
      messages.push({ role: m.role, content: m.content });
    }
  }
  messages.push({ role: "user", content: opts.inboundMessage });

  const reqBody = {
    model,
    messages,
    stream: false,
    options: {
      temperature: opts.temperature,
      num_predict: opts.maxTokens,
    },
  };

  const fetchPromise = fetch(`${url.replace(/\/$/, "")}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.NICKGPT_AUTH_TOKEN ? { Authorization: `Bearer ${process.env.NICKGPT_AUTH_TOKEN}` } : {}),
    },
    body: JSON.stringify(reqBody),
  });

  const response = await withTimeout(fetchPromise, opts.timeoutMs, "ollama");
  if (!response.ok) {
    const text = await response.text().catch(() => "<no body>");
    throw new Error(`Ollama HTTP ${response.status} · ${text.slice(0, 200)}`);
  }
  const json = (await response.json()) as { message?: { content?: string } };
  const content = json.message?.content?.trim() ?? "";
  if (!content) throw new Error("Ollama returned empty content");
  return content;
}

/**
 * Fallback path · same SMS-drafting capability via Claude. Used when
 * NickGPT is disabled OR Ollama fails. The drafter prompt is the same
 * so output STYLE is roughly comparable · the difference is fine-tuned
 * voice fidelity (NickGPT wins) vs frontier reasoning (Claude wins).
 *
 * This adapter is intentionally minimal · the project's general AI
 * client (Venice/Claude) is invoked elsewhere; we only need a thin
 * wrapper for this single use case.
 */
async function callClaudeFallback(opts: Required<Pick<DraftOpts, "inboundMessage" | "systemPrompt" | "maxTokens" | "temperature">> & { conversationContext: DraftOpts["conversationContext"] }): Promise<{ text: string; source: "fallback-claude" | "fallback-venice"; modelName: string }> {
  // Prefer Anthropic if key present, else fall back to Venice (OpenAI-compat)
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const veniceKey = process.env.VENICE_API_KEY;
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  if (opts.conversationContext) {
    for (const m of opts.conversationContext) {
      messages.push({ role: m.role, content: m.content });
    }
  }
  messages.push({ role: "user", content: opts.inboundMessage });

  if (anthropicKey) {
    const modelName = process.env.ANTHROPIC_MODEL || "claude-3-5-haiku-latest";
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: modelName,
        max_tokens: opts.maxTokens,
        system: opts.systemPrompt,
        temperature: opts.temperature,
        messages,
      }),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "<no body>");
      throw new Error(`Anthropic HTTP ${resp.status} · ${text.slice(0, 200)}`);
    }
    const json = (await resp.json()) as { content?: Array<{ text?: string }> };
    const text = json.content?.[0]?.text?.trim() ?? "";
    if (!text) throw new Error("Anthropic returned empty content");
    return { text, source: "fallback-claude", modelName };
  }

  if (veniceKey) {
    const modelName = process.env.LLM_MODEL || "llama-3.3-70b";
    const baseUrl = process.env.VENICE_BASE_URL || "https://api.venice.ai/api/v1";
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${veniceKey}`,
      },
      body: JSON.stringify({
        model: modelName,
        messages: [{ role: "system", content: opts.systemPrompt }, ...messages],
        max_tokens: opts.maxTokens,
        temperature: opts.temperature,
      }),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "<no body>");
      throw new Error(`Venice HTTP ${resp.status} · ${text.slice(0, 200)}`);
    }
    const json = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = json.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) throw new Error("Venice returned empty content");
    return { text, source: "fallback-venice", modelName };
  }

  throw new Error("No fallback LLM key available · set ANTHROPIC_API_KEY or VENICE_API_KEY");
}

/**
 * Public entry point · draft a customer-facing SMS reply.
 *
 * Routes through NickGPT (Ollama-hosted fine-tuned 3B) when feature flag
 * is on + env vars set. Falls back to Claude/Venice otherwise. NEVER
 * sends the SMS — caller is responsible for showing the draft to the
 * operator OR auto-sending if the appropriate flag is on (e.g.
 * `smart_sms_auto_reply`).
 */
export async function draftSmsReply(opts: DraftOpts): Promise<DraftResponse> {
  const systemPrompt = opts.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
  const temperature = opts.temperature ?? 0.5;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (!opts.inboundMessage || opts.inboundMessage.trim().length === 0) {
    return { ok: false, error: "Empty inboundMessage", source: "disabled" };
  }

  const enabled = await isNickGptEnabled();
  if (enabled) {
    const t0 = Date.now();
    try {
      const draft = await callOllama({
        inboundMessage: opts.inboundMessage,
        conversationContext: opts.conversationContext,
        systemPrompt,
        maxTokens,
        temperature,
        timeoutMs,
      });
      return {
        ok: true,
        draft,
        source: "nickgpt-ollama",
        modelName: process.env.NICKGPT_MODEL_NAME!,
        latencyMs: Date.now() - t0,
      };
    } catch (err) {
      log.warn("NickGPT call failed · falling back", {
        error: err instanceof Error ? err.message : String(err),
      });
      // Fall through to fallback below
    }
  }

  const t0 = Date.now();
  try {
    const result = await callClaudeFallback({
      inboundMessage: opts.inboundMessage,
      conversationContext: opts.conversationContext,
      systemPrompt,
      maxTokens,
      temperature,
    });
    return {
      ok: true,
      draft: result.text,
      source: result.source,
      modelName: result.modelName,
      latencyMs: Date.now() - t0,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      source: "fallback-claude",
    };
  }
}

/**
 * Health check · used by /api/health to confirm NickGPT is reachable
 * (when enabled). Returns { reachable, latencyMs } when Ollama responds
 * to a simple `/api/version` probe; { reachable: false } otherwise.
 */
export async function checkNickGptHealth(): Promise<{ reachable: boolean; latencyMs?: number; error?: string }> {
  if (!process.env.NICKGPT_OLLAMA_URL) return { reachable: false, error: "no_url" };
  const t0 = Date.now();
  try {
    const resp = await withTimeout(
      fetch(`${process.env.NICKGPT_OLLAMA_URL.replace(/\/$/, "")}/api/version`),
      3000,
      "ollama-health",
    );
    if (!resp.ok) return { reachable: false, error: `HTTP ${resp.status}` };
    return { reachable: true, latencyMs: Date.now() - t0 };
  } catch (err) {
    return { reachable: false, error: err instanceof Error ? err.message : String(err) };
  }
}
