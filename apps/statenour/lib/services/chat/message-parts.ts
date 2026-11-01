/**
 * lib/services/chat/message-parts.ts — persist-turn decomposition slice
 * (2026-07-25). buildMessageParts moved VERBATIM from
 * persist-assistant-turn.ts (it was an in-file helper shared by the
 * initial persist, the fabrication-rewrite patch, and the deferred
 * action-verifier patch — now importable by all three modules).
 */

import type { MessagePart } from "@/lib/ai/chat/message-fields";
import { normalizeAiSdkToolObservations } from "@/lib/ai/chat/ai-sdk-tool-observation";
import { logger } from "@/lib/logger";

/**
 * The part types this producer can emit — the ONE place that fact is stated.
 *
 * `extractParts` accepts six variants; this producer constructs three, plus the
 * UI-shape `tool-<name>` parts (B1, 2026-11-01) that bypass it. The
 * difference is not documentation, it is the actual persistence boundary, and
 * `prisma/schema.prisma`'s `parts` comment must agree with this list.
 * `tests/lib/chat/message-parts-contract.test.ts` asserts that agreement, so a
 * writer added here without updating the schema comment fails the suite.
 *
 * `file` is included because `extractParts` converts an `image` part into one
 * and passes `file` parts through; this producer does not build them directly
 * but they reach `parts` through the same call.
 */
export const PRODUCIBLE_PART_TYPES = ["text", "file", "reasoning", "tool-<name>"] as const;

/**
 * Build the `parts` tree + flattened `searchableContent` for a persisted
 * assistant ChatMessage. Shared by the initial persist (text part guarded
 * on non-empty) and the two row patches, the L2 fabrication rewrite and the
 * deferred action-receipt rewrite (text part always present). The optional
 * `reasoningText` adds a `reasoning` part only when it has non-whitespace
 * content.
 *
 * `toolParts` (B1, 2026-11-01) are the turn's tool calls in the AI SDK v6 UI
 * shape (`tool-<name>` with `state`, `input`, `output` / `errorText`): the shape
 * the live stream renders, so a reloaded reply shows the same cards through the
 * same registry, and the next turn's history carries the receipts the live
 * session already sent. They go first, as they streamed before the reply's text.
 * Until this parameter existed no caller could store one: 0 of 123 saved replies
 * in the 7 days to 2026-11-01 kept a tool part (docs/research/
 * chat-upgrades-2026-11-01.md section 2.4). Build them with `toolPartsFromSteps`;
 * a patch carries them forward with `keepStoredToolParts`.
 *
 * `alwaysIncludeText` flips the only behavioral difference between the sites:
 * the initial persist pushes the text part only when cleanedText is non-empty;
 * the patches push it unconditionally. Default is the guarded behavior.
 */
export async function buildMessageParts(
  cleanedText: string,
  reasoningText?: string,
  alwaysIncludeText = false,
  toolParts: StoredToolPart[] = [],
): Promise<{ partsArray: Array<MessagePart | StoredToolPart> | null; searchableContent: string | null }> {
  const { extractParts, buildSearchableContent } = await import("@/lib/ai/chat/message-fields");
  const assistantParts: Array<Record<string, unknown>> = [];
  if (alwaysIncludeText || (cleanedText && cleanedText.length > 0)) {
    assistantParts.push({ type: "text", text: cleanedText });
  }
  if (reasoningText && reasoningText.trim().length > 0) {
    assistantParts.push({ type: "reasoning", text: reasoningText });
  }
  const extracted = extractParts(assistantParts, cleanedText);
  const searchableContent = buildSearchableContent(extracted, cleanedText);
  const partsArray = toolParts.length > 0 ? [...toolParts, ...(extracted ?? [])] : extracted;
  return { partsArray, searchableContent };
}

/** A tool call as the live stream renders it (AI SDK v6 `ToolUIPart`), in a terminal state. */
export type StoredToolPart = {
  type: `tool-${string}`;
  toolCallId: string;
  input: unknown;
} & ({ state: "output-available"; output: unknown } | { state: "output-error"; errorText: string });

/** Above this a stored tool output is shrunk: the card needs the shape, not every row. */
export const TOOL_OUTPUT_CAP_BYTES = 8 * 1024;

const bytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value) ?? "null").length;

/** Cut by code point, so no lone surrogate is left behind (Postgres jsonb rejects one). */
const cut = (text: string, max: number): string => {
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max).join("")}…` : text;
};

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * Postgres jsonb rejects a lone surrogate and \u0000, and one would fail the whole row insert
 * (the reply is lost, not just the card). Repair the first, drop the second. A lone surrogate is
 * one slice away: lib/ai/tools/brain.ts cuts memory excerpts with .slice(0, 600).
 */
const clean = (text: string): string => text.replace(LONE_SURROGATE, "�").replace(/\u0000/g, "");

function jsonbSafe(_key: string, v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "string") return clean(v);
  if (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).some((k) => clean(k) !== k)) {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [clean(k), x]));
  }
  return v;
}

/**
 * A tool result as JSON values, which is what the provider sent on the wire anyway, and values
 * jsonb accepts. A Prisma Date becomes an ISO string (the defect PR 3492 fixed for the length
 * retry), a BigInt a string, and a value JSON cannot hold becomes null.
 */
function jsonValue(value: unknown): unknown {
  try {
    const text = JSON.stringify(value, jsonbSafe);
    return text === undefined ? null : JSON.parse(text);
  } catch {
    return null;
  }
}

function shrink(value: unknown, maxItems: number, maxChars: number): unknown {
  if (typeof value === "string") return cut(value, maxChars);
  if (Array.isArray(value)) return value.slice(0, maxItems).map((v) => shrink(v, maxItems, maxChars));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shrink(v, maxItems, maxChars)]));
  }
  return value;
}

/**
 * JSON-safe, and at most TOOL_OUTPUT_CAP_BYTES. An oversize value keeps its shape with fewer
 * rows and shorter strings, and an object says `truncated: true`; one that will not fit by
 * shape becomes `{ truncated, summary }`.
 */
export function capToolOutput(value: unknown): unknown {
  const safe = jsonValue(value);
  if (bytes(safe) <= TOOL_OUTPUT_CAP_BYTES) return safe;
  for (const [items, chars] of [[20, 400], [5, 120], [2, 40]] as const) {
    const shrunk = shrink(safe, items, chars);
    const marked = shrunk && typeof shrunk === "object" && !Array.isArray(shrunk) ? { ...shrunk, truncated: true } : shrunk;
    if (bytes(marked) <= TOOL_OUTPUT_CAP_BYTES) return marked;
  }
  return { truncated: true, summary: cut(JSON.stringify(safe) ?? "", 1000) };
}

function errorText(error: unknown): string {
  const json = JSON.stringify(jsonValue(error));
  const text = error instanceof Error ? error.message : typeof error === "string" ? error : json === "null" || json === "{}" ? "" : json;
  return cut(clean(text) || "Tool failed.", 500);
}

/**
 * The turn's tool calls, from the stream's onFinish `steps`, as parts to store. Read through
 * the seam the telemetry walk uses (normalizeAiSdkToolObservations), so the cards and the
 * receipts count the same calls. A call the SDK refused because the step offered no tools never
 * ran and gets no card. A call with no recorded result is stored as failed, never as running,
 * because nothing will ever finish it.
 */
export function toolPartsFromSteps(event: { steps?: unknown }): StoredToolPart[] {
  return normalizeAiSdkToolObservations(event)
    .filter((call) => !call.notRun)
    .map((call, i): StoredToolPart => {
      const base = {
        type: `tool-${call.toolName}` as const,
        toolCallId: call.toolCallId ?? `call-${i}`,
        input: capToolOutput(call.input ?? {}),
      };
      if (call.error != null) return { ...base, state: "output-error", errorText: errorText(call.error) };
      if (!call.outputObserved) return { ...base, state: "output-error", errorText: "No result was recorded for this call." };
      return { ...base, state: "output-available", output: capToolOutput(call.output) };
    });
}

/** `tool-<name>` UI parts, not the model-message `tool-call` / `tool-result` shapes. */
const isUiToolType = (type: unknown): boolean =>
  typeof type === "string" && type.startsWith("tool-") && type !== "tool-call" && type !== "tool-result";

/** The tool parts already on a stored row, for a patch that rebuilds its parts. */
export function keepStoredToolParts(parts: unknown): StoredToolPart[] {
  if (!Array.isArray(parts)) return [];
  return parts.filter(
    (p): p is StoredToolPart =>
      Boolean(p) && isUiToolType(p.type) && typeof p.toolCallId === "string" && typeof p.state === "string",
  );
}

/**
 * Load-side check (readConversation). Every stored tool part is validated against the AI SDK's
 * own UIMessage schema; one that fails is dropped, never the message, so a corrupt part loads as
 * the reply's text. Without the tool registry (it needs a live turn to build) this checks the
 * part's shape, not each tool's input schema: those inputs were validated when the call ran.
 */
export async function sanitizeStoredParts(parts: unknown): Promise<unknown> {
  const isToolPart = (p: { type?: unknown } | null) => isUiToolType(p?.type) || p?.type === "dynamic-tool";
  if (!Array.isArray(parts) || !parts.some(isToolPart)) return parts;
  const { safeValidateUIMessages } = await import("ai");
  const kept: unknown[] = [];
  for (const part of parts) {
    if (isToolPart(part)) {
      const check = await safeValidateUIMessages({ messages: [{ id: "stored", role: "assistant", parts: [part] }] });
      if (!check.success) {
        // A schema drift would otherwise wipe cards with no trace.
        logger.withSurface("chat.read").warn("stored_tool_part_dropped", {
          type: String(part?.type),
          toolCallId: typeof part?.toolCallId === "string" ? part.toolCallId : undefined,
          error: check.error.message.slice(0, 200),
        });
        continue;
      }
    }
    kept.push(part);
  }
  return kept;
}
