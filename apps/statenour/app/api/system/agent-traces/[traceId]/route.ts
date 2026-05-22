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
 *
 * Phase B.7a (2026-05-22) · the chain + envelope assembly moved to the
 * shared `system-pages.buildAgentTraceDetail` service so the legacy
 * REST consumer AND the new `system.agentTraceDetail` tRPC procedure
 * can't drift. This route stays mounted as the coexistence / rollback
 * path.
 */

import { apiHandler } from "@/lib/utils/http";
import { buildAgentTraceDetail } from "@/lib/services/system-pages";

export const dynamic = "force-dynamic";

export const GET = apiHandler(
  async (_req, { params }) => {
    const { traceId } = await params!;
    return buildAgentTraceDetail(traceId);
  },
  { auth: "owner" },
);
