/**
 * lib/observability/otel-genai-map.ts — WP-20 (2026-07-29).
 *
 * Maps this repo's native `AgentTrace` rows onto the PORTABLE field
 * names two published vocabularies define, so traces can be read by
 * (or exported to) standard tooling without adopting a second trace
 * backend. Pure — no exporter, no SDK, no network. Nothing here
 * changes what is stored; it renames on the way out.
 *
 * Field names were verified against source on 2026-07-29, not written
 * from memory:
 *   · OpenTelemetry GenAI — semantic-conventions-genai repo.
 *     NOTE `gen_ai.provider.name` is current; the older `gen_ai.system`
 *     is superseded. Getting this wrong would silently produce traces
 *     no standard tool groups correctly.
 *   · OpenInference — arize-ai.github.io/openinference/spec.
 *
 * PRIVACY (the load-bearing rule): prompts, completions, tool
 * arguments, and results are NEVER emitted. This app's traces touch
 * health values, finances, location and contacts; a generic
 * observability backend is exactly where that must not land. The
 * mapper emits IDs, names, counts and durations only — and
 * `redactionVersion` records which policy produced the output.
 */

/** Bump when the redaction policy changes so old exports stay legible. */
export const REDACTION_VERSION = "statenour-otel-v1-ids-and-counts-only";

/** OpenInference span kinds (spec-enumerated). */
export type OpenInferenceSpanKind =
  | "LLM"
  | "EMBEDDING"
  | "CHAIN"
  | "RETRIEVER"
  | "RERANKER"
  | "TOOL"
  | "AGENT"
  | "GUARDRAIL"
  | "EVALUATOR"
  | "PROMPT";

/** The subset of AgentTrace this mapper reads. */
export interface AgentTraceLike {
  traceId: string;
  parentId?: string | null;
  source: string;
  provider?: string | null;
  model?: string | null;
  label: string;
  durationMs?: number | null;
  inputChars?: number | null;
  outputChars?: number | null;
  costCents?: number | null;
  toolCalls?: number | null;
  errorClass?: string | null;
}

/**
 * `source` → the two vocabularies' kind/operation. Unknown sources map
 * to CHAIN + "chain" rather than guessing "LLM": mislabeling a
 * non-inference span as inference would corrupt any latency or cost
 * aggregation built on it downstream.
 */
const SOURCE_MAP: Record<string, { kind: OpenInferenceSpanKind; operation: string }> = {
  chat: { kind: "LLM", operation: "chat" },
  generate: { kind: "LLM", operation: "chat" },
  stream: { kind: "LLM", operation: "chat" },
  tool: { kind: "TOOL", operation: "execute_tool" },
  recall: { kind: "RETRIEVER", operation: "retrieve" },
  retrieve: { kind: "RETRIEVER", operation: "retrieve" },
  rerank: { kind: "RERANKER", operation: "rerank" },
  embed: { kind: "EMBEDDING", operation: "embeddings" },
  guardian: { kind: "GUARDRAIL", operation: "guardrail" },
  gate: { kind: "GUARDRAIL", operation: "guardrail" },
  critic: { kind: "EVALUATOR", operation: "evaluate" },
  judge: { kind: "EVALUATOR", operation: "evaluate" },
  agent: { kind: "AGENT", operation: "invoke_agent" },
};

export function classifySpan(source: string): {
  kind: OpenInferenceSpanKind;
  operation: string;
} {
  const key = source.toLowerCase();
  if (SOURCE_MAP[key]) return SOURCE_MAP[key];
  for (const [prefix, v] of Object.entries(SOURCE_MAP)) {
    if (key.startsWith(prefix)) return v;
  }
  return { kind: "CHAIN", operation: "chain" };
}

/**
 * Span name per the GenAI convention:
 *   inference      → "{operation} {request.model}"
 *   tool execution → "execute_tool {tool.name}"
 *   otherwise      → "{operation}"
 */
export function spanName(t: AgentTraceLike): string {
  const { kind, operation } = classifySpan(t.source);
  if (kind === "TOOL") return `execute_tool ${t.label}`;
  if (kind === "LLM" && t.model) return `${operation} ${t.model}`;
  return operation;
}

export interface PortableSpan {
  name: string;
  traceId: string;
  parentId?: string;
  attributes: Record<string, string | number>;
  /** Always false — proof the privacy rule was applied, not assumed. */
  recordedInputs: false;
  recordedOutputs: false;
  redactionVersion: string;
}

/**
 * Map one trace row to portable attributes. Both vocabularies are
 * emitted side by side: they coexist on a span by design, and tools
 * read one or the other.
 */
export function toPortableSpan(t: AgentTraceLike): PortableSpan {
  const { kind, operation } = classifySpan(t.source);
  const attributes: Record<string, string | number> = {
    // ── OpenTelemetry GenAI ──
    "gen_ai.operation.name": operation,
    // ── OpenInference ──
    "openinference.span.kind": kind,
    // ── statenour provenance (namespaced, never collides) ──
    "statenour.source": t.source,
    "statenour.label": t.label,
  };

  if (t.provider) attributes["gen_ai.provider.name"] = t.provider;
  if (t.model) {
    attributes["gen_ai.request.model"] = t.model;
    attributes["gen_ai.response.model"] = t.model;
    attributes["llm.model_name"] = t.model;
  }
  if (kind === "TOOL") {
    attributes["gen_ai.tool.name"] = t.label;
    attributes["tool.name"] = t.label;
  }
  // Character counts are NOT token counts — emitting them under a token
  // key would be a quiet lie that corrupts cost math downstream. They
  // ride a statenour-namespaced key instead.
  if (typeof t.inputChars === "number") attributes["statenour.input_chars"] = t.inputChars;
  if (typeof t.outputChars === "number") attributes["statenour.output_chars"] = t.outputChars;
  if (typeof t.durationMs === "number") attributes["statenour.duration_ms"] = t.durationMs;
  if (typeof t.costCents === "number") attributes["statenour.cost_cents"] = t.costCents;
  if (typeof t.toolCalls === "number") attributes["statenour.tool_calls"] = t.toolCalls;
  if (t.errorClass) attributes["error.type"] = t.errorClass;

  return {
    name: spanName(t),
    traceId: t.traceId,
    parentId: t.parentId ?? undefined,
    attributes,
    recordedInputs: false,
    recordedOutputs: false,
    redactionVersion: REDACTION_VERSION,
  };
}

/**
 * Keys this mapper may ever emit — asserted by test, so a future edit
 * cannot quietly introduce a content-bearing field.
 *
 * The token-count keys (`gen_ai.usage.*_tokens`, `llm.token_count.*`)
 * are deliberately ABSENT: AgentTrace stores CHARACTER counts, and this
 * mapper refuses to publish characters under a token key. When real
 * token counts land on the trace, whoever adds them must add the key
 * here on purpose — which is the point of an allowlist.
 */
export const ALLOWED_ATTRIBUTE_KEYS: readonly string[] = [
  "gen_ai.operation.name",
  "gen_ai.provider.name",
  "gen_ai.request.model",
  "gen_ai.response.model",
  "gen_ai.tool.name",
  "openinference.span.kind",
  "llm.model_name",
  "tool.name",
  "error.type",
  "statenour.source",
  "statenour.label",
  "statenour.input_chars",
  "statenour.output_chars",
  "statenour.duration_ms",
  "statenour.cost_cents",
  "statenour.tool_calls",
];
