/**
 * journal-fanout · durable-fanout wave (audit 2026-07-15).
 *
 * Durable worker for the journal capture fan-out (enrich · embed ·
 * thread-join). Pre-wave these ran as `void` promises inside the
 * capture request — on serverless, post-response work is not
 * guaranteed to run, so grounding/embedding losses were routine and
 * only partially repaired by the nightly resweep.
 *
 * Event: "journal/entry.captured" { silo, entryId, notifyTelegram }
 * sent by lib/brain/journal-fanout.dispatchJournalFanout (which
 * degrades to the old inline path when the send fails).
 *
 * One step per stage so a flaky embedding provider retries WITHOUT
 * re-running the 2-LLM-call enrichment (every stage is idempotent
 * anyway — enrichedAt stamp, sourceKey-deduped credit, byte-identical
 * embedding skip, unique membership constraint).
 */

import { getInngest } from "../client";
import { onInngestFailure } from "../on-failure";
import { logger as rootLogger } from "@/lib/logger";
import type { JournalSilo } from "@/lib/brain/journal-brain";

const log = rootLogger.withSurface("inngest/journal-fanout");
const inngest = getInngest();

export const journalFanout = inngest.createFunction(
  {
    id: "journal-fanout",
    name: "Journal capture fan-out · enrich + embed + thread-join",
    retries: 2,
    triggers: [{ event: "journal/entry.captured" }],
    onFailure: onInngestFailure,
  },
  async ({ event, step }) => {
    const silo = event.data.silo as JournalSilo;
    const entryId = String(event.data.entryId ?? "");
    const notifyTelegram = event.data.notifyTelegram === true;
    if (!entryId) return { ran: false, reason: "no entryId" };

    const text = await step.run("load-text", async () => {
      const { loadEntryText } = await import("@/lib/brain/journal-fanout");
      return loadEntryText(silo, entryId);
    });
    if (!text || text.trim().length === 0) {
      return { ran: false, reason: "entry gone or empty" };
    }

    await step.run("enrich", async () => {
      const { enrichJournalEntry } = await import("@/lib/brain/journal-brain");
      await enrichJournalEntry(silo, entryId, text, { notifyTelegram });
    });

    if (text.trim().length >= 40) {
      await step.run("embed", async () => {
        const { storeGenericEmbedding } = await import("@/lib/brain/embedding-utils");
        await storeGenericEmbedding(silo, entryId, text.slice(0, 2000));
      });
    }

    await step.run("thread-join", async () => {
      const { tryJoinActiveThreads } = await import("@/lib/services/journal-threads");
      await tryJoinActiveThreads(silo, entryId, text);
    });

    log.info("journal_fanout_done", { silo, entryId });
    return { ran: true, silo, entryId };
  },
);
