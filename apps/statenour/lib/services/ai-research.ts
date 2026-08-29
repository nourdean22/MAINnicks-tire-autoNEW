/**
 * lib/services/ai-research.ts · actions-surface REST→tRPC slice
 * (2026-05-22 · legacy-modernizer · components/actions/* slice).
 *
 * The multi-model research engine · lifted verbatim from
 * app/api/integrations/research/route.ts so the legacy REST endpoint
 * AND the new `ai.research` tRPC procedure call the SAME function ·
 * drift between consumers structurally impossible.
 *
 * Routes a query through `routeQuery` (Perplexity → Grok → Venice) and
 * returns the explicit flat `ResearchResult` shape — no Prisma row reaches
 * the AppRouter (TS2589 firewall satisfied trivially).
 *
 * (2026-08-29) arsenal_logs writing REMOVED from this call path: the table
 * had one reachable writer (lib/integrations/arsenal-log.ts, deleted) and,
 * confirmed three independent ways, ZERO readers — no find/count/aggregate
 * in the tree, no raw SQL against `arsenal_logs`, and `ArsenalLog` appears
 * exactly once in schema.prisma, so it is not a relation target and could
 * not be read through an `include`. Prod held 2 rows, newest 2026-04-10.
 */

import { routeQuery } from "@/lib/ai/router";

/** A multi-model research answer · content + provider + citations. */
export interface ResearchResult {
  content: string;
  provider: string;
  model: string;
  fallbackUsed: boolean;
}

/** The set of task-routing modes `routeQuery` accepts. */
export type ResearchTaskType =
  | "research"
  | "realtime"
  | "fast"
  | "analysis"
  | "general";

/**
 * Run a multi-model research query. The REST route and the `ai.research`
 * procedure both call this. `taskType` defaults to "research" (the
 * Perplexity-first citation chain). Provider failure propagates to the
 * caller.
 */
export async function runResearch(input: {
  query: string;
  taskType?: ResearchTaskType;
  systemPrompt?: string;
}): Promise<ResearchResult> {
  return routeQuery(
    input.query,
    input.taskType ?? "research",
    input.systemPrompt,
  );
}
