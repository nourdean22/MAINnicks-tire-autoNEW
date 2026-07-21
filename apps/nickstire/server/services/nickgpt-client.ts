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
import { NICK_SMS_SYSTEM_PROMPT } from "./nickSmsPersona";

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
  /** Optional · active booking context for status integration */
  activeBooking?: {
    vehicle: string | null;
    stage: string;
    service: string;
  };
  /** Optional · known customer identity so the reply is personal, not cold. */
  customer?: {
    firstName?: string | null;
    /** e.g. "2018 Honda Accord" — assembled from the customer record. */
    vehicle?: string | null;
  };
  /** Optional · an open written estimate the customer may be following up on. */
  activeEstimate?: {
    serviceDescription: string | null;
  };
  /** Optional · the gist of the customer's most recent VAPI call, for continuity. */
  lastVapiSummary?: string | null;
}

/**
 * Build the customer-memory preamble appended to the system prompt so the drafter
 * can answer personally and continuously ("got 225/50R17 for the Accord") instead
 * of restarting cold. Only facts that are present are included; the model is told
 * to use them only when relevant and never to invent beyond them. Prices are
 * deliberately omitted — an open-estimate amount must not be quoted by the model.
 * Pure and exported so the wiring is unit-testable.
 */
export function buildCustomerMemoryPreamble(opts: Pick<DraftOpts, "customer" | "activeEstimate" | "lastVapiSummary">): string {
  const bits: string[] = [];
  if (opts.customer?.firstName) bits.push(`the customer's name is ${opts.customer.firstName}`);
  if (opts.customer?.vehicle) bits.push(`their vehicle on file is a ${opts.customer.vehicle}`);
  if (opts.activeEstimate?.serviceDescription) bits.push(`they have an open written estimate for "${opts.activeEstimate.serviceDescription}"`);
  if (opts.lastVapiSummary) bits.push(`their most recent call was about: ${opts.lastVapiSummary}`);
  if (bits.length === 0) return "";
  return `\n\n[Customer memory: ${bits.join("; ")}. Use these only when they help answer the text — do NOT recite them or restart the conversation, and never invent details beyond them.]`;
}

interface DraftResult {
  ok: true;
  draft: string;
  source: "nickgpt-ollama" | "fallback-claude" | "fallback-openai";
  modelName: string;
  latencyMs: number;
  intent?: string;
  confidence?: number;
}

interface DraftError {
  ok: false;
  error: string;
  source: "nickgpt-ollama" | "fallback-claude" | "fallback-openai" | "disabled";
}

export type DraftResponse = DraftResult | DraftError;

// The SMS persona is one shared constant now (nickSmsPersona) so serving and the
// fine-tune corpus can never drift. The fine-tuned model expects this exact
// prompt — change the wording only via a coordinated retrain.
const DEFAULT_SYSTEM_PROMPT = NICK_SMS_SYSTEM_PROMPT;

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
async function callClaudeFallback(opts: Required<Pick<DraftOpts, "inboundMessage" | "systemPrompt" | "maxTokens" | "temperature">> & { conversationContext: DraftOpts["conversationContext"] }): Promise<{ text: string; source: "fallback-claude" | "fallback-openai"; modelName: string }> {
  // Prefer Anthropic if key present, else fall back to Gemini or OpenAI
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  if (opts.conversationContext) {
    for (const m of opts.conversationContext) {
      messages.push({ role: m.role, content: m.content });
    }
  }
  messages.push({ role: "user", content: opts.inboundMessage });

  if (anthropicKey) {
    try {
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
    } catch (err) {
      log.warn("Anthropic fallback draft generation failed, trying next provider", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (geminiKey) {
    try {
      const modelName = process.env.GEMINI_MODEL || "gemini-3.5-flash";
      const baseUrl = "https://generativelanguage.googleapis.com/v1beta/openai";
      const resp = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${geminiKey}`,
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
        throw new Error(`Gemini HTTP ${resp.status} · ${text.slice(0, 200)}`);
      }
      const json = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const text = json.choices?.[0]?.message?.content?.trim() ?? "";
      if (!text) throw new Error("Gemini returned empty content");
      return { text, source: "fallback-openai", modelName };
    } catch (err) {
      log.warn("Gemini fallback draft generation failed, trying next provider", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (openaiKey) {
    try {
      const modelName = process.env.LLM_MODEL || "gpt-4o";
      const base = process.env.OPENAI_BASE_URL?.replace(/\/$/, "") || "https://api.openai.com";
      const completionsUrl = `${base}/v1/chat/completions`;
      const resp = await fetch(completionsUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openaiKey}`,
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
        throw new Error(`OpenAI HTTP ${resp.status} · ${text.slice(0, 200)}`);
      }
      const json = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const text = json.choices?.[0]?.message?.content?.trim() ?? "";
      if (!text) throw new Error("OpenAI returned empty content");
      return { text, source: "fallback-openai", modelName };
    } catch (err) {
      log.warn("OpenAI fallback draft generation failed", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  throw new Error("All fallback LLM providers failed or no keys configured.");
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
  let systemPrompt = opts.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
  const temperature = opts.temperature ?? 0.5;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (!opts.inboundMessage || opts.inboundMessage.trim().length === 0) {
    return { ok: false, error: "Empty inboundMessage", source: "disabled" };
  }

  // Inject active booking context if available
  if (opts.activeBooking) {
    const bookingInfo = `\n\n[Active Booking Context: The customer currently has an active booking for a ${
      opts.activeBooking.vehicle || "vehicle"
    } receiving "${opts.activeBooking.service}". Current status of the job in the shop is: "${
      opts.activeBooking.stage
    }". You can use this to answer status/progress queries, but only bring it up if relevant to their text.]`;
    systemPrompt = `${systemPrompt}${bookingInfo}`;
  }

  // Inject known customer identity, open estimate, and last-call gist so the AI
  // answers as an employee who remembers the customer — the NCSOS memory gap
  // where loadCustomerContext built this state but the drafter never saw it.
  systemPrompt = `${systemPrompt}${buildCustomerMemoryPreamble(opts)}`;

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
