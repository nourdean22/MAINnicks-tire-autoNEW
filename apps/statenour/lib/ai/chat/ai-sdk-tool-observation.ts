/**
 * AI SDK tool-observation compatibility seam.
 *
 * StateNour is currently on AI SDK 6, whose persisted/runtime events in this
 * app have historically exposed tool results as `{ result, args }`. AI SDK 7
 * documents ToolResult as `{ output, input }`. The control plane must not
 * silently lose tool evidence during an SDK migration, so downstream truth
 * logic consumes this normalized shape instead of SDK-private field names.
 */

export type ToolObservationShape =
  | "sdk6-result"
  | "sdk7-output"
  | "call-only"
  | "unknown";

export interface NormalizedToolObservation {
  toolName: string;
  toolCallId?: string;
  durationMs: number;
  input?: Record<string, unknown>;
  output: unknown;
  outputObserved: boolean;
  error: unknown;
  source: "tool-result" | "tool-call";
  shape: ToolObservationShape;
}

interface LooseToolObservation {
  toolName?: unknown;
  name?: unknown;
  toolCallId?: unknown;
  executionDurationMs?: unknown;
  durationMs?: unknown;
  error?: unknown;
  result?: unknown;
  output?: unknown;
  args?: unknown;
  input?: unknown;
}

interface LooseStep {
  toolCalls?: unknown;
  toolResults?: unknown;
}

function own(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function normalizeOne(
  rawValue: unknown,
  source: "tool-result" | "tool-call",
): NormalizedToolObservation | null {
  if (!rawValue || typeof rawValue !== "object") return null;
  const raw = rawValue as LooseToolObservation;
  const toolName = asString(raw.toolName) ?? asString(raw.name);
  if (!toolName) return null;

  const hasOutput = own(raw as object, "output");
  const hasResult = own(raw as object, "result");
  const outputObserved = hasOutput || hasResult;
  const output = hasOutput ? raw.output : hasResult ? raw.result : undefined;

  const input = asRecord(raw.input) ?? asRecord(raw.args);
  const durationMs =
    typeof raw.executionDurationMs === "number"
      ? raw.executionDurationMs
      : typeof raw.durationMs === "number"
        ? raw.durationMs
        : 0;

  const shape: ToolObservationShape = hasOutput
    ? "sdk7-output"
    : hasResult
      ? "sdk6-result"
      : source === "tool-call"
        ? "call-only"
        : "unknown";

  return {
    toolName,
    toolCallId: asString(raw.toolCallId),
    durationMs,
    input,
    output,
    outputObserved,
    error: raw.error,
    source,
    shape,
  };
}

/**
 * Normalize all observable tool activity from an AI SDK onFinish-like event.
 *
 * If a step has result rows, those are authoritative for completed calls. When
 * both call/result rows expose toolCallId, unmatched calls are retained as
 * call-only observations so ambiguous completion cannot disappear merely
 * because another tool in the same step returned successfully.
 *
 * When IDs are absent we preserve the historical behavior (prefer results over
 * calls) rather than duplicate every successful tool by name.
 */
export function normalizeAiSdkToolObservations(event: { steps?: unknown }): NormalizedToolObservation[] {
  if (!Array.isArray(event.steps)) return [];

  const out: NormalizedToolObservation[] = [];
  for (const stepValue of event.steps) {
    if (!stepValue || typeof stepValue !== "object") continue;
    const step = stepValue as LooseStep;
    const rawResults = Array.isArray(step.toolResults) ? step.toolResults : [];
    const rawCalls = Array.isArray(step.toolCalls) ? step.toolCalls : [];

    const results = rawResults
      .map((v) => normalizeOne(v, "tool-result"))
      .filter((v): v is NormalizedToolObservation => v !== null);

    if (results.length === 0) {
      for (const rawCall of rawCalls) {
        const normalized = normalizeOne(rawCall, "tool-call");
        if (normalized) out.push(normalized);
      }
      continue;
    }

    out.push(...results);

    const resultIds = new Set(
      results.map((r) => r.toolCallId).filter((id): id is string => Boolean(id)),
    );
    if (resultIds.size === 0) continue;

    for (const rawCall of rawCalls) {
      const normalized = normalizeOne(rawCall, "tool-call");
      if (!normalized?.toolCallId || resultIds.has(normalized.toolCallId)) continue;
      out.push(normalized);
    }
  }

  return out;
}
