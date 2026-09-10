/**
 * GET /api/cron/revenue-decision — the missing producer.
 *
 * `lib/services/revenue-decision-channel.ts` is a complete daily engine
 * (business signals -> wisdom recall -> one drafting call -> 1-3 moves
 * persisted as BrainMemory `revenue_move` rows -> one Telegram with
 * /approve_N buttons). It had THREE live consumers and no producer:
 *
 *   · lib/ai/tools/business.ts `getPendingRevenueMoves` — registered in
 *     the tool families, the reasoning whitelist and the bridge scopes,
 *     returning empty forever;
 *   · app/api/system/revenue-decisions — the GET surface;
 *   · app/api/telegram/revenue-decision-callback — a dedicated approval
 *     handler that could never fire, because no message was ever sent.
 *
 * All three read a row shape nothing wrote. This route writes it.
 *
 * COST, stated plainly because it is the whole reason this needed a
 * decision: ONE model call per day (`tracedAiChat`, task "reason") and
 * ONE Telegram to the operator's own chat. It never POSTs to nickstire
 * and never mutates a nickstire row — approving a move flips a `status`
 * field on a statenour BrainMemory; the actual business action happens
 * on the operator's side, by hand.
 *
 * Idempotent by construction: `runRevenueDecisionChannel` uses today's
 * first move key as a sentinel, so a re-run (retry, manual trigger,
 * double fan-out) skips both drafting and the push rather than paying
 * for a second call or sending a second message.
 *
 * Kill switch: `isCronEnabled("revenue-decision")` — the operator's live
 * per-cron toggle at /system/crons, no deploy needed. Checked BEFORE the
 * engine runs, so flipping it off costs nothing rather than drafting and
 * then discarding.
 */

import { cronHandler } from "@/lib/utils/http";
import { logger as rootLogger } from "@/lib/logger";
import { isCronEnabled } from "@/lib/services/cron-control";
import { runRevenueDecisionChannel } from "@/lib/services/revenue-decision-channel";

export const maxDuration = 300;

const log = rootLogger.withSurface("cron/revenue-decision");

export const GET = cronHandler(async () => {
  if (!(await isCronEnabled("revenue-decision"))) {
    return { skipped: true, reason: "operator kill switch is off for this cron" };
  }

  const result = await runRevenueDecisionChannel();

  log.info("revenue_decision_run", {
    date: result.date,
    skipped: result.skipped ?? false,
    reason: result.reason,
    movesDrafted: result.movesDrafted ?? 0,
    movesPersisted: result.movesPersisted ?? 0,
    telegramPushed: result.telegramPushed ?? false,
  });

  return result;
});
