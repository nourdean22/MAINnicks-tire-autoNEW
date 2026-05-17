/**
 * GET /api/system/agent-traces/[traceId]/timeline · v10.0.528 · Arc A #6
 *
 * Enriched read endpoint for the tracer-level timeline UI. Builds on
 * the existing `/api/system/agent-traces/[traceId]` chain reader but
 * pre-computes the layout primitives the waterfall renderer needs:
 *   · `t0` (epoch ms of the chain's earliest startedAt)
 *   · `spanMs` (chain wall-clock span from earliest start to latest end)
 *   · per-row `offsetMs` + `widthMs` + normalized `offsetPct` / `widthPct`
 *
 * Why server-side: a single Date.parse loop + reduce on the server is
 * faster + smaller payload than reshaping on the client every render,
 * and it lets the client component stay pure-presentation (no math).
 *
 * Per Kaizen: zero schema additions. Reuses `getTraceChain` + the
 * existing envelope extraction. Same shape contract as the chain
 * reader plus the timeline-specific fields.
 *
 * Owner-gated. Read-only. 404 when the traceId doesn't resolve.
 */

import { apiHandler } from "@/lib/utils/http";
import { getTraceChain } from "@/lib/ai/agent-trace";
import {
  extractEnvelope,
  type ExplanationEnvelope,
} from "@/lib/automation/envelope";
import { ServiceError } from "@/lib/utils/service-error";

export const dynamic = "force-dynamic";

export interface TimelineRow {
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
  startedAt: string;
  /** Offset from chain `t0` in milliseconds. */
  offsetMs: number;
  /** Wall-clock width in milliseconds. Clamped to ≥1ms so zero-width
   * rows still receive a visible sliver in the waterfall render. */
  widthMs: number;
  /** Normalized 0-100 offset for direct CSS `left` mapping. */
  offsetPct: number;
  /** Normalized 0-100 width for direct CSS `width` mapping. Minimum
   * 0.5 so a microsecond-fast call still gets a hairline bar. */
  widthPct: number;
}

export interface TimelineResponse {
  traceId: string;
  startedAt: string;
  rootLabel: string;
  rootSource: string;
  totalDurationMs: number;
  totalCostCents: number;
  hasError: boolean;
  /** Span = (max endedAt) − (min startedAt). Useful for the header
   * label and any density indicator the UI wants to compute. */
  wallClockSpanMs: number;
  consolidated: ExplanationEnvelope;
  rows: TimelineRow[];
}

export const GET = apiHandler(
  async (_req, { params }) => {
    const { traceId } = await params!;
    if (!traceId || typeof traceId !== "string") {
      throw new ServiceError("traceId required", 400);
    }

    const chain = await getTraceChain(traceId);
    if (!chain) {
      throw new ServiceError(`trace "${traceId}" not found`, 404);
    }

    const startedTimes = chain.children.map((c) =>
      new Date(c.startedAt).getTime(),
    );
    const endedTimes = chain.children.map((c) => {
      const start = new Date(c.startedAt).getTime();
      return start + Math.max(0, c.durationMs ?? 0);
    });
    const t0 = startedTimes.length > 0 ? Math.min(...startedTimes) : 0;
    const tN = endedTimes.length > 0 ? Math.max(...endedTimes) : t0;
    // Min span of 1ms avoids divide-by-zero for instant chains.
    const spanMs = Math.max(1, tN - t0);

    const rowsWithEnvelope = chain.children.map((c) => ({
      raw: c,
      envelope: extractEnvelope(c.metadata),
    }));

    const rows: TimelineRow[] = rowsWithEnvelope.map(({ raw }) => {
      const startedMs = new Date(raw.startedAt).getTime();
      const offsetMs = startedMs - t0;
      const widthMs = Math.max(1, raw.durationMs ?? 0);
      return {
        id: raw.id,
        label: raw.label,
        source: raw.source,
        provider: raw.provider,
        model: raw.model,
        durationMs: raw.durationMs,
        costCents: raw.costCents,
        toolCalls: raw.toolCalls,
        errorClass: raw.errorClass,
        errorMessage: raw.errorMessage,
        startedAt: new Date(raw.startedAt).toISOString(),
        offsetMs,
        widthMs,
        offsetPct: (offsetMs / spanMs) * 100,
        widthPct: Math.max(0.5, (widthMs / spanMs) * 100),
      };
    });

    // Sort by startedAt asc so the waterfall stack reads top-to-bottom
    // in call order — operators expect the root at the top.
    rows.sort((a, b) => a.offsetMs - b.offsetMs);

    const consolidated: ExplanationEnvelope = {
      version: 1,
      policyId:
        rowsWithEnvelope.find((r) => r.envelope?.policyId != null)?.envelope
          ?.policyId ?? null,
      memoriesUsed: dedupeBy(
        rowsWithEnvelope.flatMap((r) => r.envelope?.memoriesUsed ?? []),
        (m) => m.id,
      ),
      factsAssumed: [
        ...new Set(
          rowsWithEnvelope.flatMap((r) => r.envelope?.factsAssumed ?? []),
        ),
      ],
      toolsCalled: rowsWithEnvelope.flatMap(
        (r) => r.envelope?.toolsCalled ?? [],
      ),
      reason:
        rowsWithEnvelope
          .map((r) => r.envelope?.reason)
          .filter((x): x is string => !!x)
          .join(" · ") || null,
    };

    const response: TimelineResponse = {
      traceId: chain.traceId,
      startedAt: chain.startedAt.toISOString(),
      rootLabel: chain.rootLabel,
      rootSource: chain.rootSource,
      totalDurationMs: chain.totalDurationMs,
      totalCostCents: chain.totalCostCents,
      hasError: chain.hasError,
      wallClockSpanMs: spanMs,
      consolidated,
      rows,
    };
    return response;
  },
  { auth: "owner" },
);

function dedupeBy<T>(items: T[], keyFn: (t: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = keyFn(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}
