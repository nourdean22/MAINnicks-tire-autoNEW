/**
 * lib/observability/otel-export.ts — WP-20 export lane (2026-08-03).
 *
 * `otel-genai-map.ts` shipped as a pure mapper with, by its own header,
 * "no exporter, no SDK, no network" — and nothing imported it. Correct
 * field names that never leave the process are standards alignment on
 * paper only. This is the lane that makes them portable.
 *
 * Deliberately NOT an OTLP/gRPC exporter: the register rejected running
 * a second trace backend (Langfuse row), and WP-20 is scoped "zero new
 * infra". NDJSON is the format every OTel collector, Phoenix instance
 * and Braintrust import path can already read, and it costs no
 * dependency, no port, and no daemon.
 *
 * TWO privacy layers, because one is a single point of failure:
 *
 *   1. `AGENT_TRACE_EXPORT_SELECT` — an explicit Prisma select, so the
 *      content-bearing columns (`errorMessage` is @db.Text, `metadata`
 *      is Json) are never even READ out of the database. A bare
 *      findMany() would pull both into process memory and leave one
 *      careless serialization between them and an export file.
 *   2. `enforceAllowlist()` — a RUNTIME check that every emitted key is
 *      on the mapper's allowlist. The unit test proves the mapper's
 *      shape for the inputs it samples; this proves it for the rows
 *      that actually exist. It THROWS rather than dropping the key:
 *      a key nobody predicted is a policy question, not a bad row, and
 *      silently skipping it would export a quietly-incomplete file that
 *      still looks successful.
 */

import {
  ALLOWED_ATTRIBUTE_KEYS,
  toPortableSpan,
  type AgentTraceLike,
  type PortableSpan,
} from "./otel-genai-map";

/**
 * The ONLY columns the export may read. Mirrors `AgentTraceLike`.
 *
 * Pinned by test against the content-bearing columns on the model. If
 * you are adding a field here, it must also be on the mapper's
 * ALLOWED_ATTRIBUTE_KEYS — and if it can carry prompt, completion, tool
 * arguments, error text or free-form metadata, it does not belong in an
 * export at all.
 */
export const AGENT_TRACE_EXPORT_SELECT = {
  traceId: true,
  parentId: true,
  source: true,
  provider: true,
  model: true,
  label: true,
  durationMs: true,
  inputChars: true,
  outputChars: true,
  costCents: true,
  toolCalls: true,
} as const;

/** Columns that exist on AgentTrace and must never be exported. */
export const FORBIDDEN_EXPORT_COLUMNS: readonly string[] = [
  "errorMessage",
  "metadata",
];

export class ExportPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportPolicyError";
  }
}

/**
 * Throw if the span carries a key the redaction policy never approved.
 *
 * Fails the whole export, loudly. The alternative — drop the key and
 * carry on — produces a file that is silently missing data while
 * reporting success, which is the failure mode the repo's loud-failure
 * work exists to kill.
 */
export function enforceAllowlist(span: PortableSpan): void {
  for (const key of Object.keys(span.attributes)) {
    if (!ALLOWED_ATTRIBUTE_KEYS.includes(key)) {
      throw new ExportPolicyError(
        `Refusing to export: attribute "${key}" (span "${span.name}", trace ${span.traceId}) ` +
          `is not on ALLOWED_ATTRIBUTE_KEYS in otel-genai-map.ts. If this key is intentional, ` +
          `add it there on purpose — that allowlist is the privacy contract.`,
      );
    }
  }
}

/** Map one trace row to a policy-checked NDJSON line (no trailing newline). */
export function toExportLine(trace: AgentTraceLike): string {
  const span = toPortableSpan(trace);
  enforceAllowlist(span);
  return JSON.stringify(span);
}

/**
 * Parse a lookback window: "30m" | "24h" | "7d" | an ISO-8601 instant.
 *
 * Returns the absolute cutoff. Throws on anything it cannot parse
 * rather than defaulting — a mistyped window that silently became
 * "everything" would dump the full trace history to a file.
 */
export function parseSince(spec: string, now: Date): Date {
  const rel = /^(\d+)([mhd])$/.exec(spec.trim());
  if (rel) {
    const n = Number(rel[1]);
    if (n <= 0) throw new ExportPolicyError(`--since must be positive, got "${spec}"`);
    const ms = { m: 60_000, h: 3_600_000, d: 86_400_000 }[rel[2] as "m" | "h" | "d"];
    return new Date(now.getTime() - n * ms);
  }

  // Require the ISO shape BEFORE handing anything to `new Date()`.
  // `new Date("7")` does not return NaN — V8 happily reads it as a
  // year — so a NaN check alone lets "--since 7" (the obvious typo for
  // "7d") through as a cutoff decades in the past, i.e. "export
  // everything". Every ISO-8601 instant starts YYYY-MM-DD.
  const abs = /^\d{4}-\d{2}-\d{2}/.test(spec.trim()) ? new Date(spec.trim()) : new Date(NaN);
  if (Number.isNaN(abs.getTime())) {
    throw new ExportPolicyError(
      `Cannot parse --since "${spec}". Use a relative window (30m, 24h, 7d) or an ISO-8601 instant.`,
    );
  }
  return abs;
}
