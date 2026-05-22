/**
 * GET /api/nick/suggest · Wave 29 (v10.0.529.85)
 *
 * The brain of Nick's proactive layer. Aggregates cross-system signals
 * into ranked, actionable suggestions for the chat homepage. Each
 * suggestion ships with a `seedPrompt` · tapping the chip seeds the
 * chat input · the operator hits send · Nick already has the right
 * intent + context to execute.
 *
 * Sources (all server-side cheap reads):
 *   · MasteryScore latest per domain · weakest axis surface
 *   · Task list · stuck DOING + overdue + orphan
 *   · GoalEvent recency · stalled goals
 *   · BrainMemory(orphan_tasks_nudge) from W24 cron
 *   · BrainMemory(task_pattern) from W23 pattern clusterer
 *   · DriftAlert + Contradictions unresolved counts
 *
 * Capped at 5 suggestions · ranked by severity desc + recency.
 * VAD-style gate drops suggestions the operator dismissed in the
 * last 7d (see getDismissedSuggestionIds). Auto-hides when nothing
 * is actionable.
 *
 * Cross-domain residuals slice (2026-05-22) · the full aggregator moved
 * to `lib/services/nick-suggestions.buildNickSuggestions` so this route
 * AND the `nick.suggestions` tRPC procedure call the SAME function ·
 * drift structurally impossible.
 */

import { apiHandler } from "@/lib/utils/http";
import { buildNickSuggestions } from "@/lib/services/nick-suggestions";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async () => buildNickSuggestions(), {
  auth: "owner",
});
