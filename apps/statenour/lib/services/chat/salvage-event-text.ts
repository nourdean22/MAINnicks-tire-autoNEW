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
import type { ProviderName } from "@/lib/ai/provider";

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

  // Strip Venice GLM <think>...</think> reasoning blocks that leak into responses
  const stripThink = (s: string) =>
    s
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .replace(/<\/?think>/gi, "")
      .replace(/^[\s\n]+/, "")
      .trim();

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
