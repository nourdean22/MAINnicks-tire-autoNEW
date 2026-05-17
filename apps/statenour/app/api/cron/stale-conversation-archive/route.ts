/**
 * /api/cron/stale-conversation-archive · v8.11 BATCH 64 · Apr 29.
 *
 * Folded into mega-evening. Sets archivedAt on ChatConversation rows
 * that have been idle >60d, aren't starred, and have at least one
 * message. Batch-capped at 200/run.
 */

import { cronHandler } from "@/lib/utils/http";
import { runStaleConversationArchive } from "@/lib/db/stale-conversation-archive";

export const maxDuration = 60;

export const GET = cronHandler(async () => {
  const started = Date.now();
  try {
    const report = await runStaleConversationArchive();
    return { ok: true, durationMs: Date.now() - started, ...report };
  } catch (err) {
    return {
      ok: false,
      durationMs: Date.now() - started,
      error:
        err instanceof Error ? err.message : "stale-conversation-archive failed",
    };
  }
});
