/**
 * Agent trace · v10 Track E.5 · Apr 30.
 *
 * Standardized AI/agent call tracing. Every AI call across the
 * system flows through these helpers so the operator can answer:
 *
 *   "Why did NICK do X?"
 *   "Which provider served what?"
 *   "How much did this turn cost across all calls?"
 *   "What was the chain of calls behind this autonomous action?"
 *
 * Two contracts:
 *   1. mintTraceId() at the top of every operator-initiated chain
 *      (chat route, cron handler, autonomous trigger). Returns a
 *      ULID-ish string.
 *   2. wrapTrace({ traceId, parentId?, source, label, ... }, fn) —
 *      runs fn, persists a row with timing + outcome.
 *
 * All writes are fire-and-forget to never block the user-facing
 * path. A trace failing to persist never breaks the call.
 *
 * Composes with v9.1.27 markProviderFailed and v9.1.22 onError —
 * the same provider/error info already flowing through those is
 * captured here for the operator.
 */

import { prisma } from "@/lib/prisma";
import { logError } from "@/lib/utils/error-log";

export type TraceSource =
  | "chat"
  | "cron"
  | "autonomous"
  | "tool"
  | "journal"
  | "brain"
  | "other";

export interface TraceStartInput {
  traceId: string;
  parentId?: string | null;
  source: TraceSource;
  /** Free-form label, e.g. "auto-rename", "task-completion-detector" */
  label: string;
  provider?: string | null;
  model?: string | null;
  inputChars?: number;
  metadata?: Record<string, unknown>;
}

export interface TraceFinishInput {
  durationMs: number;
  outputChars?: number;
  costCents?: number;
  toolCalls?: number;
  errorClass?: string | null;
  errorMessage?: string | null;
  metadataDelta?: Record<string, unknown>;
}

/**
 * Mint a trace id. Format: `t_<timestamp36>_<seq4>_<rand4>`.
 *
 * Strictly monotonic within a process — even multiple calls in the
 * same millisecond return ids that sort lexicographically by call
 * order, because the per-ms sequence counter is embedded between
 * the timestamp and the random suffix.
 *
 * Across processes, the timestamp prefix still gives near-monotonic
 * ordering; the random suffix prevents collisions on the rare cross-
 * process same-ms case.
 */
let _lastMintMs = 0;
let _lastMintSeq = 0;
export function mintTraceId(): string {
  const now = Date.now();
  if (now === _lastMintMs) {
    _lastMintSeq += 1;
  } else {
    _lastMintMs = now;
    _lastMintSeq = 0;
  }
  const ts = now.toString(36);
  const seq = _lastMintSeq.toString(36).padStart(4, "0");
  const rnd = Math.random().toString(36).slice(2, 6);
  return `t_${ts}_${seq}_${rnd}`;
}

/**
 * Persist a completed trace row. Fire-and-forget — never throws.
 *
 * The most common usage pattern:
 *
 *   const traceId = mintTraceId();
 *   const start = Date.now();
 *   try {
 *     const result = await someAiCall();
 *     void recordTrace({ traceId, source, label }, {
 *       durationMs: Date.now() - start,
 *       outputChars: result.length,
 *     });
 *   } catch (err) {
 *     void recordTrace({ traceId, source, label }, {
 *       durationMs: Date.now() - start,
 *       errorClass: "ai_call_failed",
 *       errorMessage: err instanceof Error ? err.message : String(err),
 *     });
 *     throw err;
 *   }
 *
 * For automatic timing + error capture, use wrapTrace() below.
 */
export async function recordTrace(
  start: TraceStartInput,
  finish: TraceFinishInput,
): Promise<void> {
  try {
    await prisma.agentTrace.create({
      data: {
        traceId: start.traceId,
        parentId: start.parentId ?? null,
        source: start.source,
        provider: start.provider ?? null,
        model: start.model ?? null,
        label: start.label,
        finishedAt: new Date(),
        durationMs: finish.durationMs,
        inputChars: start.inputChars ?? null,
        outputChars: finish.outputChars ?? null,
        costCents: finish.costCents ?? null,
        toolCalls: finish.toolCalls ?? 0,
        errorClass: finish.errorClass ?? null,
        errorMessage: finish.errorMessage?.slice(0, 1000) ?? null,
        metadata: {
          ...(start.metadata ?? {}),
          ...(finish.metadataDelta ?? {}),
        } as never,
      },
    });
  } catch (err) {
    // Trace persistence must NEVER block the calling path.
    logError("ai.agent-trace", err, { fn: "recordTrace" });
  }
}

/**
 * Wrap an AI/agent call so timing + outcome are captured automatically.
 *
 * Usage (basic):
 *
 *   const result = await wrapTrace(
 *     { traceId, source: "chat", label: "auto-rename", provider: "venice" },
 *     async () => aiChat(...)
 *   );
 *
 * Usage (with outcome attribution — preserves outputChars/cost/toolCalls):
 *
 *   const result = await wrapTrace(
 *     { traceId, source: "chat", label: "auto-rename", provider: "venice" },
 *     async () => aiChat(...),
 *     {
 *       finishFromResult: (r) => ({
 *         outputChars: r.content?.length ?? 0,
 *         costCents: estimateCost(r.usage),
 *         toolCalls: r.toolCallCount ?? 0,
 *       }),
 *     },
 *   );
 *
 * Without `finishFromResult` the wrapped trace records timing only —
 * outputChars/costCents/toolCalls remain null. This was the v10.0.8
 * shipped contract; v10.0.15 closes the attribution gap so the
 * /system/agent-traces dashboard shows real cost + output sizes for
 * wrapper-style call sites without forcing them to fall back to the
 * manual recordTrace pattern.
 *
 * The trace row is recorded fire-and-forget after fn resolves OR
 * rejects. The original error is re-thrown to preserve caller
 * semantics. If `finishFromResult` itself throws, the trace records
 * with timing-only data and a synthetic error class — never blocks
 * the caller.
 */
export async function wrapTrace<T>(
  start: TraceStartInput,
  fn: () => Promise<T>,
  opts: {
    finishFromResult?: (result: T) => Partial<TraceFinishInput>;
  } = {},
): Promise<T> {
  const begin = Date.now();
  try {
    const result = await fn();
    let extras: Partial<TraceFinishInput> = {};
    if (opts.finishFromResult) {
      try {
        extras = opts.finishFromResult(result) ?? {};
      } catch (err) {
        // Attribution failure must never block the caller — fall
        // back to timing-only recording.
        logError("ai.agent-trace", err, { fn: "finishFromResult" });
        extras = {};
      }
    }
    void recordTrace(start, {
      durationMs: Date.now() - begin,
      ...extras,
    });
    return result;
  } catch (err) {
    void recordTrace(start, {
      durationMs: Date.now() - begin,
      errorClass: "wrap_trace_threw",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Operator dashboard query: recent traces grouped by traceId so a
 * single chat turn shows up as one collapsed row with its child
 * calls underneath.
 */
export async function listRecentTraceChains(opts: {
  limit?: number;
  source?: TraceSource;
} = {}): Promise<
  Array<{
    traceId: string;
    rootLabel: string;
    rootSource: string;
    callCount: number;
    totalDurationMs: number;
    totalCostCents: number;
    hasError: boolean;
    startedAt: Date;
    children: Array<{
      id: string;
      label: string;
      source: string;
      provider: string | null;
      durationMs: number | null;
      costCents: number | null;
      errorClass: string | null;
      startedAt: Date;
    }>;
  }>
> {
  const limit = Math.max(1, Math.min(opts.limit ?? 25, 100));

  // 1. Get the top N most-recent distinct traceIds.
  const recent = await prisma.agentTrace.findMany({
    where: opts.source ? { source: opts.source } : undefined,
    orderBy: { startedAt: "desc" },
    select: { traceId: true },
    distinct: ["traceId"],
    take: limit,
  });
  const traceIds = recent.map((r) => r.traceId);
  if (traceIds.length === 0) return [];

  // 2. Pull every row for those traceIds in one query.
  const rows = await prisma.agentTrace.findMany({
    where: { traceId: { in: traceIds } },
    orderBy: { startedAt: "asc" },
  });

  // 3. Group by traceId.
  const byTrace = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!byTrace.has(row.traceId)) byTrace.set(row.traceId, []);
    byTrace.get(row.traceId)!.push(row);
  }

  return traceIds.map((traceId) => {
    const children = byTrace.get(traceId) ?? [];
    const root = children.find((c) => c.parentId == null) ?? children[0];
    const totalCost = children.reduce(
      (acc, c) => acc + (c.costCents ?? 0),
      0,
    );
    const totalDuration = children.reduce(
      (acc, c) => acc + (c.durationMs ?? 0),
      0,
    );
    return {
      traceId,
      rootLabel: root.label,
      rootSource: root.source,
      callCount: children.length,
      totalDurationMs: totalDuration,
      totalCostCents: totalCost,
      hasError: children.some((c) => c.errorClass != null),
      startedAt: root.startedAt,
      children: children.map((c) => ({
        id: c.id,
        label: c.label,
        source: c.source,
        provider: c.provider,
        durationMs: c.durationMs,
        costCents: c.costCents,
        errorClass: c.errorClass,
        startedAt: c.startedAt,
      })),
    };
  });
}

/**
 * v10.0.149 · Get every row for a single traceId — used by the
 * envelope detail surface (`/system/agent-traces/[traceId]`) so the
 * operator can drill into one chat turn / autonomous action and see
 * the explainability envelope (memories used, facts assumed, tools
 * called, policy id) extracted from each row's metadata.
 *
 * Returns null when no rows exist for the id (e.g. a stale link).
 */
export async function getTraceChain(traceId: string): Promise<{
  traceId: string;
  startedAt: Date;
  rootLabel: string;
  rootSource: string;
  totalDurationMs: number;
  totalCostCents: number;
  hasError: boolean;
  children: Array<{
    id: string;
    label: string;
    source: string;
    provider: string | null;
    model: string | null;
    durationMs: number | null;
    costCents: number | null;
    toolCalls: number;
    errorClass: string | null;
    errorMessage: string | null;
    startedAt: Date;
    metadata: unknown;
  }>;
} | null> {
  const rows = await prisma.agentTrace.findMany({
    where: { traceId },
    orderBy: { startedAt: "asc" },
  });
  if (rows.length === 0) return null;
  const root = rows.find((r) => r.parentId == null) ?? rows[0];
  return {
    traceId,
    startedAt: root.startedAt,
    rootLabel: root.label,
    rootSource: root.source,
    totalDurationMs: rows.reduce((acc, r) => acc + (r.durationMs ?? 0), 0),
    totalCostCents: rows.reduce((acc, r) => acc + (r.costCents ?? 0), 0),
    hasError: rows.some((r) => r.errorClass != null),
    children: rows.map((r) => ({
      id: r.id,
      label: r.label,
      source: r.source,
      provider: r.provider,
      model: r.model,
      durationMs: r.durationMs,
      costCents: r.costCents,
      toolCalls: r.toolCalls,
      errorClass: r.errorClass,
      errorMessage: r.errorMessage,
      startedAt: r.startedAt,
      metadata: r.metadata,
    })),
  };
}
