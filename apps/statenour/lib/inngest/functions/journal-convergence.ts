/**
 * journal-convergence · ADR-0013 · Phase D (2026-05-18)
 *
 * Two Inngest functions for the journal pattern-radar:
 *
 * 1. journalConvergenceScan · nightly 22:00 UTC
 *    Pull last-14d entries · ensure embeddings · greedy cluster ·
 *    prune already-threaded members · suggest names · persist
 *    candidates to BrainMemory(category="journal_convergence_candidate")
 *    so the next /journal visit surfaces them in ThreadRadar.
 *
 * 2. journalThreadDormancy · daily 23:00 UTC
 *    Mark threads with no joins in 30+ days as status="dormant".
 *    Auto-join can re-activate them later.
 *
 * Both functions stay slim · the heavy lifting lives in the service
 * layer · this file just wires the cron triggers + retries + failure
 * alerts (shared onInngestFailure handler).
 */

import { getInngest } from "../client";
import { onInngestFailure } from "../on-failure";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("inngest/journal-convergence");
const inngest = getInngest();

export const journalConvergenceScan = inngest.createFunction(
  {
    id: "journal-convergence-scan",
    name: "Journal convergence scan · nightly theme detector",
    retries: 2,
    triggers: [{ cron: "0 22 * * *" }],
    onFailure: onInngestFailure,
  },
  async ({ step }) => {
    const result = await step.run("scan-convergence", async () => {
      const { runConvergenceScan } = await import(
        "@/lib/services/journal-convergence"
      );
      return runConvergenceScan();
    });

    log.info("journal_convergence_scan_done", result);
    return result;
  },
);

export const journalThreadDormancy = inngest.createFunction(
  {
    id: "journal-thread-dormancy",
    name: "Journal thread dormancy sweep · 30d no-join retirement",
    retries: 2,
    triggers: [{ cron: "0 23 * * *" }],
    onFailure: onInngestFailure,
  },
  async ({ step }) => {
    const result = await step.run("dormancy-scan", async () => {
      const { dormancyScan } = await import(
        "@/lib/services/journal-threads"
      );
      return dormancyScan();
    });

    log.info("journal_thread_dormancy_done", result);
    return result;
  },
);
