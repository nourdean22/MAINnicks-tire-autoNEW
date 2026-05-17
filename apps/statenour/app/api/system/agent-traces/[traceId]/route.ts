/**
 * GET /api/system/agent-traces/[traceId] · v10.0.149 · May 03
 *
 * Returns the full chain for one trace plus the explainability
 * envelope extracted from each row's metadata. Used by the
 * /system/agent-traces detail panel and (eventually) the chat-side
 * "why?" toggle.
 *
 * Per the post-audit consolidation: every Nick response and every
 * autonomous action carries an envelope answering:
 *   · what memories were retrieved + injected
 *   · what facts the chain assumed
 *   · what tools were called
 *   · which AutomationPolicy authorized the action
 *
 * Owner-gated. 404 when the traceId doesn't resolve.
 */

import { apiHandler } from "@/lib/utils/http";
import { getTraceChain } from "@/lib/ai/agent-trace";
import {
  extractEnvelope,
  type ExplanationEnvelope,
} from "@/lib/automation/envelope";
import { ServiceError } from "@/lib/utils/service-error";

export const dynamic = "force-dynamic";

export const GET = apiHandler(
  async (_req, { params }) => {
    const { traceId } = await params!;
    const chain = await getTraceChain(traceId);
    if (!chain) {
      throw new ServiceError(`trace "${traceId}" not found`, 404);
    }

    // Per-row envelope extraction. Rows that pre-date the envelope
    // contract or stored an incompatible shape return null here —
    // surfaced as `envelope: null` so the UI can show a "no envelope
    // available" state instead of failing.
    const rowsWithEnvelope = chain.children.map((c) => ({
      ...c,
      startedAt: c.startedAt.toISOString(),
      envelope: extractEnvelope(c.metadata),
    }));

    // Roll up envelopes across the chain so the operator sees a
    // single consolidated view (union of memories used + facts
    // assumed + tools called) without having to mentally merge
    // per-step envelopes.
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
        ...new Set(rowsWithEnvelope.flatMap((r) => r.envelope?.factsAssumed ?? [])),
      ],
      toolsCalled: rowsWithEnvelope.flatMap((r) => r.envelope?.toolsCalled ?? []),
      reason:
        rowsWithEnvelope
          .map((r) => r.envelope?.reason)
          .filter((x): x is string => !!x)
          .join(" · ") || null,
    };

    return {
      traceId: chain.traceId,
      startedAt: chain.startedAt.toISOString(),
      rootLabel: chain.rootLabel,
      rootSource: chain.rootSource,
      totalDurationMs: chain.totalDurationMs,
      totalCostCents: chain.totalCostCents,
      hasError: chain.hasError,
      consolidated,
      rows: rowsWithEnvelope,
    };
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
