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
 * logs the call to the arsenal-activity feed. Returns the explicit flat
 * `ResearchResult` shape — no Prisma row reaches the AppRouter (TS2589
 * firewall satisfied trivially).
 */

import { routeQuery } from "@/lib/ai/router";
import { logArsenalActivity } from "@/lib/integrations/arsenal-log";

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
 * Perplexity-first citation chain). Re-throws on total provider failure
 * so the caller can surface the error.
 */
export async function runResearch(input: {
  query: string;
  taskType?: ResearchTaskType;
  systemPrompt?: string;
}): Promise<ResearchResult> {
  const start = Date.now();
  try {
    const result = await routeQuery(
      input.query,
      input.taskType ?? "research",
      input.systemPrompt,
    );
    logArsenalActivity({
      toolId: result?.provider || "multi-model",
      action: "research",
      status: "success",
      durationMs: Date.now() - start,
      inputPreview: input.query?.slice(0, 200),
      resultPreview: (result?.content ?? JSON.stringify(result))?.slice(
        0,
        1000,
      ),
    });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logArsenalActivity({
      toolId: "multi-model",
      action: "research",
      status: "error",
      durationMs: Date.now() - start,
      errorMessage: message,
    });
    throw err;
  }
}
