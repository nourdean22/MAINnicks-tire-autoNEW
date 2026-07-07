/**
 * Industry-intel feeder · REVIVED 2026-05-31
 *
 * Pulls the active automotive/AI RSS sources (lib/automotive/industry-sources.ts
 * — ~10 live after the 2026-05-02 probe) into BrainMemory(industry_intel) via
 * pullIndustryFeeds().
 *
 * WHY THIS EXISTS AGAIN: the original `/api/cron/industry-pull` route was
 * deleted in the Wave-AE prune (107→35 crons), which silently starved
 * recallIndustryIntel() — consumed by the system prompt (lib/ai/system-prompt.ts),
 * /api/ai/plan-day, and the /intel surface. The AI was reading an ever-staler
 * table with nothing feeding it. This is the correctness fix.
 *
 * WHY INNGEST-NATIVE: a standalone daily trigger that is NOT in the mega
 * fan-out must be `inngest: true` (the only mechanism the cron verifier
 * treats as reachable without a route file — see scripts/verify-crons.ts).
 * Mirrors cron-heartbeat / goal-pruner.
 *
 * SCHEDULE: 08:00 UTC (~4am ET) — fresh before the 10:00-UTC operator morning
 * brief + plan-day read the intel, and earlier than the 09:00-UTC mega
 * fan-out so the two don't contend.
 */
import { getInngest } from "../client";
import { onInngestFailure } from "../on-failure";
import { pullIndustryFeeds } from "@/lib/automotive/industry-monitor";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("inngest/industry-pull");
const inngest = getInngest();

export const industryPull = inngest.createFunction(
  {
    id: "industry-pull",
    name: "Industry intel feeder",
    retries: 2,
    triggers: [{ cron: "0 8 * * *" }],
    onFailure: onInngestFailure,
  },
  async ({ step }) => {
    // pullIndustryFeeds is already timeout-guarded (10s/source) + per-source
    // try/catch, so one dead source can't starve the run. Persisting is
    // idempotent by guid, so a function retry re-pulls cleanly.
    const result = await step.run("pull-industry-feeds", () => pullIndustryFeeds());
    log.info("industry_pull_done", {
      sourcesAttempted: result.sourcesAttempted,
      sourcesOk: result.sourcesOk,
      itemsAdded: result.itemsAdded,
      errors: result.errors.length,
    });
    return {
      sourcesOk: result.sourcesOk,
      itemsAdded: result.itemsAdded,
      errors: result.errors.length,
    };
  },
);
