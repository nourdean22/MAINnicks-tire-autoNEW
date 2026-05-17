/**
 * /api/cron/brain-bus-consume · v8.23 · Apr 29.
 *
 * Activates the dormant brain-bus consumer pattern (v8.10 BATCH 57)
 * inside Vercel's request lifecycle. Runs the entity-audit subscriber
 * for ~50s, lets it accumulate counts from any LISTEN/NOTIFY events
 * that fire during the window, then flushes rolling totals into
 * BrainMemory category="bus_consumer_counter".
 *
 * Composes:
 *   · v8.4 brain-bus subscribe() helper
 *   · v8.7 entity-audit publisher (every soft-delete / create / update
 *     audit row publishes on the "entity_audit" channel)
 *   · v8.10 startEntityAuditCounter / runForDuration
 *
 * Constraint: Vercel functions have a max duration. We cap the run at
 * 50s so the route returns within the 60s envelope. The pgvector
 * `pg` peer-dep must be present (v8.4 dynamic import) — if absent,
 * runForDuration throws and we report it cleanly so the cron logs
 * surface the misconfig.
 *
 * Folded into mega-evening — daily activation is enough to:
 *   1. Keep derived counters fresh
 *   2. Validate LISTEN/NOTIFY end-to-end on each run (composes with
 *      v8.11 brain-bus health-probe but exercises the SUBSCRIBE side
 *      with real audit traffic instead of a synthetic probe envelope)
 */

import { cronHandler } from "@/lib/utils/http";
import { runForDuration } from "@/lib/db/brain-bus-consumer-example";

export const maxDuration = 60;

// v9.1.16 · was 50_000 (50s). With Neon cold-start at 2-5s + the
// final flushCountsToBrainMemory pass and pg client.end() also taking
// real time, the total elapsed could exceed the 60s function envelope
// — leaving a leaked LISTEN connection on Neon's side and dropping
// the flushed counts. 40s gives the cleanup phase ~20s of headroom.
const RUN_DURATION_MS = 40_000;

export const GET = cronHandler(async () => {
  const started = Date.now();
  try {
    await runForDuration(RUN_DURATION_MS, {
      flushIntervalMs: 15_000,
      maxPerType: 200,
    });
    return {
      ok: true,
      durationMs: Date.now() - started,
      ranForMs: RUN_DURATION_MS,
      note: "Consumer ran the full window. Flushed counts to BrainMemory category='bus_consumer_counter'.",
    };
  } catch (err) {
    return {
      ok: false,
      durationMs: Date.now() - started,
      error: err instanceof Error ? err.message : "brain-bus-consume failed",
    };
  }
});
