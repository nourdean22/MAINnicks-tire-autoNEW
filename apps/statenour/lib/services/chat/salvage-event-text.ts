/**
 * lib/services/chat/salvage-event-text.ts — persist-turn decomposition
 * slice (2026-07-25). The event-text salvage stack moved VERBATIM from
 * buildOnFinish in persist-assistant-turn.ts: the cascading fallback
 * (rawText -> reasoningText -> content -> steps -> reasoning array,
 * each stripThink'd), hasToolCalls detection (top-level + steps), the
 * empty-response guard with its full recordError context capture, and
 * the graceful emptyResponseFallback. Only the boundary changed: the
 * cast locals became a typed ctx and the result is returned instead of
 * mutating closure vars.
 */

import { recordError } from "@/lib/errors/record-error";
import { emptyResponseFallback } from "@/lib/ai/chat/empty-response-fallback";
import { langfuseTelemetry } from "@/lib/observability/langfuse";
import type { ProviderName } from "@/lib/ai/provider";
import { jsonValue } from "./message-parts";

interface ChatLogger {
  info(event: string, ctx?: Record<string, unknown>): void;
  warn(event: string, ctx?: Record<string, unknown>): void;
}

export interface SalvagedEventText {
  /** Final assistant text — salvaged or the honest fallback, never empty. */
  text: string;
  /** Reasoning-array text (joined) — feeds the persisted reasoning part. */
  reasoningText: string;
  hasToolCalls: boolean;
  finishReason: string | undefined;
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined;
}

// Strip Venice GLM <think>...</think> reasoning blocks that leak into responses
const stripThink = (s: string) =>
  s
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<\/?think>/gi, "")
    .replace(/^[\s\n]+/, "")
    .trim();

const LENGTH_SALVAGE_MAX_TOKENS = 2_000;
const LENGTH_SALVAGE_TIMEOUT_MS = 30_000;

/**
 * 2026-10-26 · a reply that hit the output cap ("length") before any visible
 * text gets ONE bounded text-only retry before the fallback copy. Live: an
 * ollama/minimax-m3 turn spent all 6,000 output tokens on hidden thinking (the
 * openai chat adapter never surfaces Ollama's reasoning) and persisted the
 * fallback. No tools; reasoning_effort "none" (ignored by non-OpenAI-shaped
 * lanes; honoured by Ollama for minimax-m3, probed 2026-11-01). Returns null when it does not apply or
 * fails, and only usage when the retry came back empty, so the fallback copy
 * still covers it. The usage is the cut-off attempt's plus the retry's, so
 * cost rows count both calls.
 */
type TokenUsage = { inputTokens?: number; outputTokens?: number; totalTokens?: number };

/**
 * 2026-11-01 · the step loop puts a tool's raw return value into the tool-result
 * part, so a Prisma Date (searchMemories `updatedAt`) rides along. streamText never
 * re-validates its own history, but generateText checks the ModelMessage schema and
 * a Date is not a JSON value: the retry threw AI_InvalidPromptError and the turn
 * persisted the fallback (live 12:57Z, 9 read tools). Round-trip the value through
 * JSON, which is what the provider adapter sent on the wire anyway.
 */
function jsonSafeToolResults(m: unknown): unknown {
  const msg = m as { role?: string; content?: unknown };
  if (msg.role !== "tool" || !Array.isArray(msg.content)) return m;
  return {
    ...msg,
    content: msg.content.map((p: { output?: { type?: string; value?: unknown } }) =>
      p?.output?.type === "json" || p?.output?.type === "error-json"
        ? { ...p, output: { ...p.output, value: jsonValue(p.output.value ?? null) } }
        : p,
    ),
  };
}

export async function salvageLengthCutoff(args: {
  event: { text?: string; finishReason?: string; response?: { messages?: unknown[] }; usage?: TokenUsage };
  model: unknown;
  system: string;
  messages: unknown;
  privateMode: boolean;
  conversationId: string | undefined;
  log: ChatLogger;
}): Promise<{ text?: string; finishReason?: string; usage: TokenUsage } | null> {
  const { event, log } = args;
  if (event.finishReason !== "length" || stripThink(event.text ?? "")) return null;
  // A private turn writes no row and emits no message.persisted, so nothing could carry the retry's text to the screen.
  if (args.privateMode) {
    log.info("length_cutoff_salvage_skipped_private", { finish: event.finishReason });
    return null;
  }
  try {
    const { generateText } = await import("ai");
    // The cut-off step's own assistant message is empty; keep only messages with content (tool history).
    const prior = (event.response?.messages ?? [])
      .filter((m) => {
        const c = (m as { content?: unknown }).content;
        return Array.isArray(c) ? c.length > 0 : Boolean(c);
      })
      .map(jsonSafeToolResults);
    const r = await generateText({
      model: args.model as never,
      system: `${args.system}\n\nYour previous attempt ran out of room before writing anything. Reply to the last message now, directly, in plain prose.`,
      messages: [...(args.messages as never[]), ...(prior as never[])],
      maxOutputTokens: LENGTH_SALVAGE_MAX_TOKENS,
      providerOptions: { openai: { reasoningEffort: "none" } },
      abortSignal: AbortSignal.timeout(LENGTH_SALVAGE_TIMEOUT_MS),
      maxRetries: 0,
      experimental_telemetry: langfuseTelemetry({
        functionId: "chat-salvage-length-cutoff",
        privateMode: args.privateMode,
        sessionId: args.conversationId,
        tags: ["nick-chat", "length-salvage"],
      }),
    });
    const text = stripThink(r.text ?? "");
    log.info("length_cutoff_salvage", { chars: text.length, finish: r.finishReason });
    const sum = (k: keyof TokenUsage) => {
      const [a, b] = [event.usage?.[k], r.usage?.[k]];
      return a == null && b == null ? undefined : (a ?? 0) + (b ?? 0);
    };
    const usage = { ...event.usage, inputTokens: sum("inputTokens"), outputTokens: sum("outputTokens"), totalTokens: sum("totalTokens") };
    // An empty retry still spent tokens: hand back the usage alone and keep the cut-off text and finish.
    return text ? { text, finishReason: r.finishReason, usage } : { usage };
  } catch (err) {
    // The name alone hid which schema check failed on 2026-11-01; the message says.
    log.warn("length_cutoff_salvage_failed", {
      error: err instanceof Error ? err.name : "Error",
      message: err instanceof Error ? err.message.slice(0, 200) : undefined,
    });
    return null;
  }
}

export function salvageEventText(args: {
  event: { text?: string; usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number } } & Record<string, unknown>;
  provider: ProviderName;
  modelId: string;
  mode: string;
  promptChars: number;
  log: ChatLogger;
}): SalvagedEventText {
  const { event, provider, modelId, mode, promptChars, log } = args;
  const rawText = event.text || "";
  const usage = event.usage;
  const finishReason = (event as unknown as { finishReason?: string }).finishReason;
  // v6 exposes reasoning as an array of steps AND as reasoningText.
  // Try BOTH fields + the content + steps fields. Venice GLM can
  // emit tokens in any of these depending on how the model formats
  // its output. Whatever has content wins.
  const ev = event as unknown as {
    reasoning?: unknown;
    reasoningText?: string;
    content?: unknown;
    steps?: unknown;
  };

  const reasoningRaw = ev.reasoning;
  let reasoningText = "";
  if (typeof reasoningRaw === "string") {
    reasoningText = reasoningRaw;
  } else if (Array.isArray(reasoningRaw)) {
    reasoningText = reasoningRaw
      .map((r: unknown) => {
        if (typeof r === "string") return r;
        if (r && typeof r === "object") {
          const obj = r as { text?: string; content?: string };
          return obj.text || obj.content || "";
        }
        return "";
      })
      .join("\n");
  }

  // reasoningText field — v6 exposes this alongside the reasoning array
  const reasoningTextField = typeof ev.reasoningText === "string" ? ev.reasoningText : "";

  // content field — may contain parts array with text parts
  let contentText = "";
  if (typeof ev.content === "string") {
    contentText = ev.content;
  } else if (Array.isArray(ev.content)) {
    contentText = ev.content
      .map((p: unknown) => {
        if (typeof p === "string") return p;
        if (p && typeof p === "object") {
          const obj = p as { type?: string; text?: string; content?: string };
          if (obj.type === "text" && obj.text) return obj.text;
          if (obj.type === "reasoning" && obj.text) return obj.text;
          return obj.text || obj.content || "";
        }
        return "";
      })
      .join("");
  }

  // steps field — multi-step responses may have text in steps[*].text
  let stepsText = "";
  if (Array.isArray(ev.steps)) {
    stepsText = ev.steps
      .map((s: unknown) => {
        if (s && typeof s === "object") {
          const obj = s as { text?: string; reasoningText?: string; content?: unknown };
          if (obj.text) return obj.text;
          if (obj.reasoningText) return obj.reasoningText;
          if (Array.isArray(obj.content)) {
            return obj.content
              .map((p: unknown) =>
                p && typeof p === "object" ? (p as { text?: string }).text || "" : ""
              )
              .join("");
          }
        }
        return "";
      })
      .join("\n");
  }

  let text = stripThink(rawText);
  let salvageSource: string | null = null;

  // CASCADING FALLBACK: try every field that might have content.
  // Order matters — text is best, then reasoningText, then content
  // (may have structured parts), then steps, then reasoning array.
  // First field with real content wins.
  if (!text) {
    const candidates: Array<[string, string]> = [
      ["reasoningText", stripThink(reasoningTextField)],
      ["content", stripThink(contentText)],
      ["steps", stripThink(stepsText)],
      ["reasoning", stripThink(reasoningText)],
    ];
    for (const [source, candidate] of candidates) {
      if (candidate && candidate.length > 0) {
        text = candidate;
        salvageSource = source;
        break;
      }
    }
    if (salvageSource) {
      log.info("salvaged_response", { source: salvageSource, chars: text.length });
    }
  }

  // Check if this turn contains tool calls (either at top-level event or inside steps)
  let hasToolCalls = false;
  const topEvent = event as unknown as { toolCalls?: unknown[]; toolResults?: unknown[] };
  if ((topEvent.toolCalls && topEvent.toolCalls.length > 0) || (topEvent.toolResults && topEvent.toolResults.length > 0)) {
    hasToolCalls = true;
  } else if (Array.isArray(ev.steps)) {
    interface StepWithTools {
      toolCalls?: unknown[];
      toolResults?: unknown[];
    }
    for (const step of ev.steps) {
      if (step && typeof step === "object") {
        const s = step as StepWithTools;
        if ((s.toolCalls && s.toolCalls.length > 0) || (s.toolResults && s.toolResults.length > 0)) {
          hasToolCalls = true;
          break;
        }
      }
    }
  }

  // EMPTY RESPONSE GUARD — if the stream closes with no content
  // (after stripping think tags) AND there are no tool calls, log it
  // to ai_errors so we can see the pattern in /system/audit. Common causes:
  //   - Venice reasoning ate the entire output token budget
  //   - disable_thinking: false + model decided to only think
  //   - Prompt too close to context ceiling
  //   - maxOutputTokens too restrictive for the task
  //   - Venice is throttled / the API key is exhausted
  //
  // When detected, we log the rawText head (500 chars) so we can
  // see WHAT the model actually emitted before the strip — that
  // tells us if it was all <think> or genuinely nothing.
  // 2026-07-15 · silent-tool-turn fix. The guard was gated with
  // `&& !hasToolCalls`, which made emptyResponseFallback's dedicated
  // finishReason === "tool-calls" branch UNREACHABLE — the exact case
  // it was written for (see the fallback-comment below promising it
  // "branches on finishReason so a tool-call turn steers away from a
  // duplicate-causing retry"). Live effect: deepseek-v4-pro tool
  // turns whose post-tool continuation came back empty persisted a
  // "complete" row with empty content/parts → blank bubble, no error
  // card, operator nudged with "?" to get a reply. Empty is empty —
  // fall back regardless of tool presence.
  if (!text || text.trim().length === 0) {
    recordError("chat:stream", new Error("Empty assistant response after every salvage path"), {
      rawTextLength: rawText.length,
      rawTextHead: rawText.slice(0, 500),
      reasoningTextFieldLength: reasoningTextField.length,
      reasoningTextFieldHead: reasoningTextField.slice(0, 300),
      contentTextLength: contentText.length,
      contentTextHead: contentText.slice(0, 300),
      stepsTextLength: stepsText.length,
      stepsTextHead: stepsText.slice(0, 300),
      reasoningArrayLength: reasoningText.length,
      reasoningArrayHead: reasoningText.slice(0, 300),
      finishReason,
      provider,
      modelId,
      mode,
      promptChars,
      outputTokens: usage?.outputTokens,
      inputTokens: usage?.inputTokens,
      eventKeys: Object.keys(event as object).join(","),
    });
    log.warn("empty_after_salvage", {
      raw: rawText.length,
      rT: reasoningTextField.length,
      ctn: contentText.length,
      stp: stepsText.length,
      rArr: reasoningText.length,
      finish: finishReason,
    });

    // GRACEFUL FALLBACK — was: silently skip the save (hasContent
    // stays false) → blank bubble → the user retries → duplicate
    // records (the 06-08 "UFC USA BBQ" mission spawned 5× with ~26
    // orphan tasks). Replace the empty turn with an honest, non-
    // fabricating message so it persists + renders. Branches on
    // finishReason so a tool-call turn STEERS AWAY from a duplicate-
    // causing retry. The recordError above still fires, so the empty-
    // response pattern stays visible in /system/audit. Root fix
    // (glm-5.1/ollama thinking-budget control) is tracked separately.
    text = emptyResponseFallback(finishReason);
  }
  return { text, reasoningText, hasToolCalls, finishReason, usage };
}
