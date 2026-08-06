/**
 * Weekly suggestion-loop noise analysis · 2026-08-05
 *
 * lib/brain/suggestion-improve.ts shipped complete and tested — analyze the
 * operator's acted/dismissed/modified/deferred taps, flag noisy suggestion
 * kinds, persist propose-only `suggestion_hypothesis` brain memories — and
 * then had ZERO importers. The taps were collected daily and consumed by
 * nothing. This is its scheduled caller.
 *
 * Propose-only by construction: the agent writes hypotheses into BrainMemory
 * (where recall surfaces them) and this function raises a low-priority Coach
 * event when kinds are flagged. Nothing mutates suggestion triggers — retuning
 * a threshold stays an operator decision.
 */
import { getInngest } from "../client";
import { onInngestFailure } from "../on-failure";
import { prisma } from "@/lib/prisma";
import { recordCoachEvent } from "@/lib/services/coach-events";
import { logger as rootLogger } from "@/lib/logger";
import { logError } from "@/lib/utils/error-log";

const log = rootLogger.withSurface("inngest/suggestion-improve");

const inngest = getInngest();

export const suggestionImproveWeekly = inngest.createFunction(
  {
    id: "suggestion-improve-weekly",
    name: "Weekly suggestion-loop noise analysis",
    retries: 2,
    // Monday 13:30 UTC — beside the quality bench, off the fan-out windows.
    triggers: [{ cron: "30 13 * * 1" }],
    onFailure: onInngestFailure,
  },
  async ({ step }) => {
    await step.run("self-row", async () => {
      await prisma.cronJobLog
        .create({ data: { jobName: "suggestion-improve-weekly", status: "success" } })
        .catch((e) => logError("inngest.suggestion-improve", e, { stage: "self-row" }, "warn"));
      return true;
    });

    const result = await step.run("analyze-and-persist", async () => {
      const { runSuggestionImproveAgent } = await import("@/lib/brain/suggestion-improve");
      const { hypotheses, persisted } = await runSuggestionImproveAgent(30);
      return {
        persisted,
        kinds: hypotheses.map((h) => ({ kind: h.kind, dismissRate: h.dismissRate, signalCount: h.signalCount })),
      };
    });

    if (result.persisted > 0) {
      await step.run("surface", async () => {
        const kindList = result.kinds.map((k) => `${k.kind} (${Math.round(k.dismissRate * 100)}% dismissed of ${k.signalCount})`).join(", ");
        await recordCoachEvent({
          kind: "system-alert",
          subjectId: "suggestion-improve-weekly",
          priority: "P2",
          title: `${result.persisted} suggestion kind${result.persisted > 1 ? "s" : ""} flagged noisy`,
          body: `You are mostly dismissing: ${kindList}. Hypotheses persisted to brain memory — review the trigger thresholds in /api/nick/suggest.`,
          deepLink: "/system/health",
          surfaces: ["scoreboard", "brain"],
          expiresAt: new Date(Date.now() + 8 * 24 * 3_600_000).toISOString(),
        });
        return true;
      });
      log.warn("noisy_kinds_flagged", { persisted: result.persisted });
    } else {
      log.info("suggestion_loop_clean", {});
    }

    return result;
  },
);
