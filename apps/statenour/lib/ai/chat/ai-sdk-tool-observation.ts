/**
 * AI SDK tool-observation compatibility seam.
 *
 * StateNour is currently on AI SDK 6, whose persisted/runtime events in this
 * app have historically exposed tool results as `{ result, args }`. Modern AI
 * SDK shapes use `{ output, input }` and can represent execution failures as
 * `tool-error` content parts. The control plane must not silently lose tool
 * evidence during an SDK migration, so downstream truth logic consumes this
 * normalized shape instead of SDK-private field names.
 */

export type ToolObservationShape =
  | "sdk6-result"
  | "sdk7-output"
  | "tool-error-part"
  | "call-only"
  | "unknown";

export interface NormalizedToolObservation {
  toolName: string;
  toolCallId?: string;
  durationMs: number;
  input?: Record<string, unknown>;
  output: unknown;
  outputObserved: boolean;
  /** Non-null means a deterministic terminal failure was observed. */
  error: unknown;
  source: "tool-result" | "tool-call" | "tool-error";
  shape: ToolObservationShape;
}

interface LooseToolObservation {
  type?: unknown;
  toolName?: unknown;
  name?: unknown;
  toolCallId?: unknown;
  executionDurationMs?: unknown;
  durationMs?: unknown;
  error?: unknown;
  isError?: unknown;
  result?: unknown;
  output?: unknown;
  args?: unknown;
  input?: unknown;
}

interface LooseStep {
  toolCalls?: unknown;
  toolResults?: unknown;
  content?: unknown;
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

function outputFrom(raw: LooseToolObservation): {
  output: unknown;
  outputObserved: boolean;
  hasOutput: boolean;
  hasResult: boolean;
} {
  const hasOutput = own(raw as object, "output");
  const hasResult = own(raw as object, "result");
  return {
    output: hasOutput ? raw.output : hasResult ? raw.result : undefined,
    outputObserved: hasOutput || hasResult,
    hasOutput,
    hasResult,
  };
}

function durationFrom(raw: LooseToolObservation): number {
  return typeof raw.executionDurationMs === "number"
    ? raw.executionDurationMs
    : typeof raw.durationMs === "number"
      ? raw.durationMs
      : 0;
}

function normalizeOne(
  rawValue: unknown,
  source: "tool-result" | "tool-call",
): NormalizedToolObservation | null {
  if (!rawValue || typeof rawValue !== "object") return null;
  const raw = rawValue as LooseToolObservation;
  const toolName = asString(raw.toolName) ?? asString(raw.name);
  if (!toolName) return null;

  const { output, outputObserved, hasOutput, hasResult } = outputFrom(raw);
  const input = asRecord(raw.input) ?? asRecord(raw.args);

  // Modern ToolResult-like parts can carry `isError: true` rather than an
  // `error` property. Preserve that as FAILED_KNOWN evidence downstream. The
  // output itself is useful error detail when it is present; otherwise use a
  // deterministic sentinel rather than silently treating the call as success.
  const explicitError =
    raw.error !== undefined && raw.error !== null
      ? raw.error
      : raw.isError === true
        ? output ?? "tool-result-marked-error"
        : undefined;

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
    durationMs: durationFrom(raw),
    input,
    output,
    outputObserved,
    error: explicitError,
    source,
    shape,
  };
}

/**
 * Normalize an AI SDK `tool-error` content part.
 *
 * Some SDK versions put terminal execution failures in StepResult.content
 * rather than `toolResults`. A part may omit repeated tool metadata that is
 * already present on the matching toolCall, so hydrate name/input/duration by
 * toolCallId when possible. The `tool-error` type itself is proof of a known
 * terminal failure even if its error payload is unexpectedly absent.
 */
function normalizeToolErrorPart(
  rawValue: unknown,
  callsById: ReadonlyMap<string, NormalizedToolObservation>,
): NormalizedToolObservation | null {
  if (!rawValue || typeof rawValue !== "object") return null;
  const raw = rawValue as LooseToolObservation;
  if (raw.type !== "tool-error") return null;

  const toolCallId = asString(raw.toolCallId);
  const matchingCall = toolCallId ? callsById.get(toolCallId) : undefined;
  const toolName =
    asString(raw.toolName) ?? asString(raw.name) ?? matchingCall?.toolName;
  if (!toolName) return null;

  const { output, outputObserved } = outputFrom(raw);
  const directInput = asRecord(raw.input) ?? asRecord(raw.args);
  const duration = durationFrom(raw);

  return {
    toolName,
    toolCallId,
    durationMs: duration > 0 ? duration : matchingCall?.durationMs ?? 0,
    input: directInput ?? matchingCall?.input,
    output,
    outputObserved,
    error:
      raw.error !== undefined && raw.error !== null
        ? raw.error
        : output ?? "tool execution failed",
    source: "tool-error",
    shape: "tool-error-part",
  };
}

/**
 * Normalize all observable tool activity from an AI SDK onFinish-like event.
 *
 * Terminal evidence is the union of result rows and explicit `tool-error`
 * content parts. Error parts win over a result with the same toolCallId. When
 * terminal observations expose toolCallId, unmatched calls are retained as
 * call-only observations so ambiguous completion cannot disappear merely
 * because another tool in the same step returned successfully.
 *
 * When terminal rows have no IDs we preserve the historical behavior (prefer
 * terminal rows over calls) rather than duplicate every successful tool by
 * name. We deliberately do not fuzzy-dedupe by tool name: two calls to the same
 * tool in one step are distinct operations unless the SDK gives us IDs.
 */
export function normalizeAiSdkToolObservations(event: { steps?: unknown }): NormalizedToolObservation[] {
  if (!Array.isArray(event.steps)) return [];

  const out: NormalizedToolObservation[] = [];
  for (const stepValue of event.steps) {
    if (!stepValue || typeof stepValue !== "object") continue;
    const step = stepValue as LooseStep;
    const rawResults = Array.isArray(step.toolResults) ? step.toolResults : [];
    const rawCalls = Array.isArray(step.toolCalls) ? step.toolCalls : [];
    const rawContent = Array.isArray(step.content) ? step.content : [];

    const calls = rawCalls
      .map((v) => normalizeOne(v, "tool-call"))
      .filter((v): v is NormalizedToolObservation => v !== null);
    const callsById = new Map(
      calls
        .filter((call): call is NormalizedToolObservation & { toolCallId: string } => Boolean(call.toolCallId))
        .map((call) => [call.toolCallId, call] as const),
    );

    const errorParts = rawContent
      .map((v) => normalizeToolErrorPart(v, callsById))
      .filter((v): v is NormalizedToolObservation => v !== null);
    const errorIds = new Set(
      errorParts
        .map((error) => error.toolCallId)
        .filter((id): id is string => Boolean(id)),
    );

    const results = rawResults
      .map((v) => normalizeOne(v, "tool-result"))
      .filter((v): v is NormalizedToolObservation => v !== null)
      // A typed tool-error is stronger terminal evidence than a result row for
      // the same operation. Never emit both and let downstream counts drift.
      .filter((result) => !result.toolCallId || !errorIds.has(result.toolCallId));

    const terminal = [...results, ...errorParts];
    if (terminal.length === 0) {
      out.push(...calls);
      continue;
    }

    out.push(...terminal);

    const terminalIds = new Set(
      terminal
        .map((observation) => observation.toolCallId)
        .filter((id): id is string => Boolean(id)),
    );
    if (terminalIds.size === 0) continue;

    for (const call of calls) {
      if (!call.toolCallId || terminalIds.has(call.toolCallId)) continue;
      out.push(call);
    }
  }

  return out;
}
