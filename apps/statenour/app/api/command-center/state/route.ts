/**
 * GET /api/command-center/state · v9.0-alpha · Apr 30.
 *
 * Single typed read of the operator's full operating context. Composes
 * existing primitives (Task / Commitment / ScheduledAction / DriftAlert /
 * BrainMemory alerts / MasteryDecision / CronJobLog / AiGeneration /
 * AutonomousAction / AutomationRule / VectorEmbedding) into the shape
 * defined in `lib/ai/context/command-center-state.ts`.
 *
 * No new tables. No writes. Cacheable per-request.
 *
 * Consumers (planned across v9.0):
 *   · operator dashboard (`/system/command-center`)
 *   · NickPrimeContext builder (server-side direct call, not HTTP)
 *   · briefings + cron-fired digests
 *
 * Auth: owner-only (operator session).
 */

import { apiHandler } from "@/lib/utils/http";
import { buildCommandCenterState } from "@/lib/ai/context/command-center-state";

// v10.0.121 audit-pattern follow-up · the doc above declared "Auth:
// owner-only (operator session)" but the implementation lacked it —
// same documented-but-not-implemented foot-gun audit 10 caught on
// /api/system/crons. Worst leak: composes Tasks + Commitments +
// ScheduledActions + DriftAlerts + BrainMemory + MasteryDecisions +
// CronJobLog + AiGeneration + AutonomousAction + AutomationRule +
// VectorEmbedding — the operator's full context. Now actually gated.
export const GET = apiHandler(async () => {
  const state = await buildCommandCenterState();
  return state;
}, { auth: "owner" });
