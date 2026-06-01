/**
 * GET /api/cron/mastery-xp · 2026-05-30 · the leveling engine's heartbeat.
 *
 * Each run reads the operator's recent unstructured signals (chat
 * messages, brain captures, logged decisions), runs the AI rep-detector
 * (lib/mastery/attribution), and credits XP to the right stat
 * (lib/mastery/credit). Idempotent per sourceKey, so:
 *   · the FIRST run backfills history (lights the board up from zero), and
 *   · every run after only credits NEW signals (cheap steady state).
 *
 * This is why the leveling system feels alive: "whenever you do anything —
 * a task, an insight in the journal, a chat, an email — it adds to your
 * stats." Tasks already feed it live via auto-learn; this cron covers the
 * unstructured signals a rule can't classify.
 *
 * Runs in the Next app runtime (folded into mega-evening) because the AI
 * call path (tracedAiChat) needs the server provider context — a bare
 * script can't run it.
 *
 * Cost: bounded by perSource (gpt-4o-mini, <$0.0008/call). Steady state is
 * a handful of new signals/day; the first run is the only big batch.
 */
import { cronHandler } from "@/lib/utils/http";
import { backfillStatXp } from "@/lib/mastery/backfill";
import { resweepUnenriched } from "@/lib/brain/journal-brain";

export const maxDuration = 120;

export const GET = cronHandler(async () => {
  const res = await backfillStatXp(25);
  // Journal Brain durability net · re-enrich any brain_dump the live void-pass
  // missed (process death / AI hiccup / pre-Phase-1 rows). Idempotent per
  // sourceKey, so re-running never double-credits.
  const journalEnriched = await resweepUnenriched(25).catch(() => 0);
  return { status: "ok", ...res, journalEnriched };
});
