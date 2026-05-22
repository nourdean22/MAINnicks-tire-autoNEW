/**
 * GET /api/system/agent-traces · v10 Track E.5 · Apr 30.
 *
 * Operator-facing endpoint for /system/agent-traces. Returns:
 *   - top-N most-recent trace chains
 *   - each chain has root info + child calls + roll-ups
 *   - a prior-24h baseline for TrendCounter deltas
 *
 * Owner-gated. Read-only. Composes with v10.0.8 AgentTrace contract.
 *
 * Query params:
 *   ?limit  default 25, clamped [1, 100]
 *   ?source filter by TraceSource (chat | cron | autonomous | tool | journal | brain | other)
 *
 * Phase B.7a (2026-05-22) · the feed + baseline assembly moved to the
 * shared `system-pages.buildAgentTracesFeed` service so the legacy REST
 * consumer AND the new `system.agentTraces` tRPC procedure can't drift.
 * This route stays mounted as the coexistence / rollback path.
 */

import { apiHandler } from "@/lib/utils/http";
import { type TraceSource } from "@/lib/ai/agent-trace";
import { buildAgentTracesFeed } from "@/lib/services/system-pages";

const VALID_SOURCES: ReadonlyArray<TraceSource> = [
  "chat",
  "cron",
  "autonomous",
  "tool",
  "journal",
  "brain",
  "other",
];

function isTraceSource(s: string | null): s is TraceSource {
  return s != null && (VALID_SOURCES as ReadonlyArray<string>).includes(s);
}

export const GET = apiHandler(
  async (req) => {
    const url = new URL(req.url);
    const limitParam = parseInt(url.searchParams.get("limit") ?? "25", 10);
    const limit = Number.isFinite(limitParam)
      ? Math.max(1, Math.min(limitParam, 100))
      : 25;
    const sourceParam = url.searchParams.get("source");
    const source = isTraceSource(sourceParam) ? sourceParam : undefined;

    return buildAgentTracesFeed({ limit, source });
  },
  { auth: "owner" }, // v9.1.14 sensitive-GET gate compliance
);
