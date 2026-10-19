/**
 * Inngest function `intelligence-ingest` (2026-10-18).
 *
 * The slim survivor of `intelligence-daily-brief`. The BRIEF (page, push, weekly
 * and daily brief crons) was stopped on the operator's decision; the pipeline
 * that fed it was not. This is the only scheduler of source ingestion with claim
 * verification and promotion, the persona-drift scan, and the fatal-ingestion
 * gate that routes a dead pipeline to onInngestFailure. No brief is composed,
 * saved or pushed here. Opportunity scoring and content drafting were dropped
 * with it: the page and route that decided opportunities are gone, so the only
 * reader of opportunity_logs left is the manual triggerBrief tool.
 */
import { getInngest } from "../client";
import { onInngestFailure } from "../on-failure";
import { runIngestion } from "@/lib/intelligence/ingest";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("inngest/intelligence-ingest");
const inngest = getInngest();

/**
 * 2026-08-23 - zero-ingest is a FAILURE, not a quiet day.
 *
 * THE DEFECT. The ingestion loop caught every per-source error, logged it, and
 * returned normally. A source returning `{ success: false }` was not logged at
 * all. So if all seven feeds failed - one expired credential is enough - the run
 * reported `sourcesIngested: 0` and Inngest marked it SUCCEEDED.
 *
 * WHAT THE BRIEF ACTUALLY DOES ON SUCH A DAY, corrected under review: it is NOT
 * "built on nothing". `composeDailyExecutiveBrief` has no date filter on any of
 * its queries - it selects pending opportunities scoring >= 75 and the five most
 * recent claims at confidence >= 0.8, whenever they were created. So a total feed
 * outage produces a brief built on the standing BACKLOG, wearing today's date,
 * with no staleness marker. That is worse than an empty brief, because stale
 * content dated today reads as fresh.
 *
 * WHY A THROW AND NOT A NEW ALERT. `onFailure: onInngestFailure` is already wired
 * on this function and already routes to Telegram once retries are exhausted.
 * Throwing reuses that path; a second alerting route would be a parallel system.
 *
 * WHERE THE THROW LIVES, and why it moved. It is at the END of the function body,
 * after every step has run - not inside the ingestion step. Inngest's contract
 * ("How functions are executed - Memoization of steps") is that a retry
 * re-executes the function body but retrieves each completed step's result from
 * persisted state "without re-executing the step's code". Throwing inside step 1
 * meant every retry RE-RAN all seven connector fetches and re-spent the scrape
 * budget, on precisely the day things were already broken, and skipped the six
 * downstream steps - so no briefing_logs row, no push, no drift scan. Throwing at
 * the end means the brief still composes and ships once, the steps replay from
 * memoized state on each retry, and onFailure still fires after the third attempt.
 *
 * A CORRECTION WORTH KEEPING. An earlier version of this comment argued the
 * `=== 0` condition made retries idempotent, reasoning that zero ingested implied
 * nothing was written. That is FALSE. `runIngestion` commits its `sourceDocument`
 * at ingest.ts:230, then writes claims in a loop at :248, and a throw anywhere
 * after the document insert is converted to `{ success: false }` by the outer
 * catch at :300. A source can write a document and still not be counted. The
 * idempotency now comes from step memoization, which is a real guarantee, rather
 * than from an invariant nothing enforces.
 *
 * MEASURED BEFORE ARMING, because a gate that fires daily is worse than no gate.
 * Prod 2026-08-23: 7 registered sources, all with `last_fetched` today and 12-16
 * documents each over 14 days. Zero ingestion is not the steady state. The
 * counter-example is `ollama-model-liveness`, which cron-heartbeat.ts records as
 * 23 non-failed runs out of 2,333 - arming an identical assert there would page
 * on essentially every run and be muted inside a week.
 */
export interface IngestionRollup {
  sourcesAttempted: number;
  sourcesIngested: number;
  totalClaims: number;
  failures: string[];
}

/**
 * The ingestion loop, with `runIngestion` injected.
 *
 * Extracted so the gate can be tested by DRIVING it rather than by grepping the
 * source. The previous version asserted that `ingestionFailure(` and `throw` both
 * appeared in the file - assertions that stay green if the arguments are swapped
 * (`sourcesAttempted: ingestedCount`), which inverts the gate completely: it
 * would fire when all seven sources SUCCEED and stay silent when all seven fail.
 * A review mutation proved that passed 10 of 10 tests. Same shape as
 * `classifySilence` in cron-heartbeat.ts, which takes its inputs as parameters
 * for exactly this reason.
 */
export async function ingestAllSources(
  sources: ReadonlyArray<{ id: string; name: string }>,
  ingest: (id: string) => Promise<{ success: boolean; claimsCount: number; message: string }>,
  onLog?: {
    soft?: (e: { sourceId: string; name: string; message: string }) => void;
    hard?: (e: { sourceId: string; message: string }) => void;
  },
): Promise<IngestionRollup> {
  let sourcesIngested = 0;
  let totalClaims = 0;
  // Reasons are COLLECTED, not just logged. IngestionResult carries a `message`
  // on failure and it was discarded entirely, so an alert could say "0 sources"
  // but never "the credential expired" - the only part that is actionable.
  const failures: string[] = [];

  for (const source of sources) {
    try {
      const res = await ingest(source.id);
      if (res.success) {
        sourcesIngested++;
        totalClaims += res.claimsCount;
      } else {
        // Previously a completely silent path: neither counted nor logged.
        failures.push(`${source.name}: ${res.message}`.slice(0, 160));
        onLog?.soft?.({ sourceId: source.id, name: source.name, message: res.message });
      }
    } catch (err) {
      // Defensive only. runIngestion wraps its whole body and returns a result on
      // every path (ingest.ts:29-310), so in practice failures arrive through the
      // branch above. Kept because "it cannot throw" is a property of today's
      // implementation, not of the signature.
      const msg = err instanceof Error ? err.message : String(err);
      failures.push(`${source.name}: ${msg}`.slice(0, 160));
      onLog?.hard?.({ sourceId: source.id, message: msg });
    }
  }

  return { sourcesAttempted: sources.length, sourcesIngested, totalClaims, failures };
}

/**
 * Is this rollup a failure? Returns an operator-facing message, or null.
 *
 * REASONS COME FIRST. `on-failure.ts:52` truncates the error to 240 characters
 * before sending, and an earlier version put a 124-character preamble ahead of
 * them - so the two least useful reasons arrived and `401 unauthorized` was cut
 * off mid-word. The alert already carries its own header ("Inngest failure -
 * intelligence-ingest"), so the preamble was redundant as well as harmful.
 *
 * TWO FAILURE MODES, not one:
 *   - nothing ingested: every feed is down.
 *   - everything ingested and ZERO claims: the shared extractor is broken.
 *     `extractClaimsFromText` returns [] on a JSON parse failure AND on any
 *     thrown error, so one provider change silently empties every source at once.
 *     That is a likelier single point of failure than seven independent
 *     credential expiries, and the first version of this gate missed it entirely
 *     because it counted sources rather than intelligence.
 */
export function ingestionFailure(report: {
  sourcesAttempted: number;
  sourcesIngested: number;
  totalClaims?: number;
  failures?: string[];
}): string | null {
  // No sources registered: ingesting nothing is CORRECT. Without this branch an
  // empty configuration becomes a permanent daily alarm.
  if (report.sourcesAttempted === 0) return null;

  const why = report.failures?.length
    ? report.failures.join(" | ")
    : "no per-source reason captured";

  if (report.sourcesIngested === 0) {
    return `0/${report.sourcesAttempted} sources ingested - ${why}`;
  }

  if (report.totalClaims === 0) {
    return (
      `${report.sourcesIngested}/${report.sourcesAttempted} sources ingested but ZERO claims extracted ` +
      `- the shared extractor is the suspect, not the feeds. ${why}`
    );
  }

  return null;
}

export const intelligenceIngest = inngest.createFunction(
  {
    id: "intelligence-ingest",
    name: "Intelligence OS · Ingestion + persona drift",
    retries: 2,
    triggers: [{ cron: "15 10 * * *" }],
    onFailure: onInngestFailure,
  },
  async ({ step }) => {
    // 1. Run Ingestion for all active sources
    const ingestionReport = await step.run("ingest-active-sources", async () => {
      const { prisma } = await import("@/lib/prisma");
      const activeSources = await prisma.registeredSource.findMany();

      // The loop lives in ingestAllSources so a test can drive it with a fake
      // ingester. It returns the rollup; the FAILURE VERDICT is computed at the
      // end of this function, not here - see the header for why throwing inside
      // this step re-ran every connector fetch on each retry.
      return ingestAllSources(activeSources, runIngestion, {
        soft: (e) => log.warn("ingestion_source_soft_failure", e),
        hard: (e) => log.error(`Inngest step runIngestion failed for source ${e.sourceId}`, { error: e.message }),
      });
    });

    // 2. AG-15 · persona-drift scan. The read surfaces (tRPC system.personaDrift,
    // /api/system/persona-drift, the ultron situation card) are live and this is
    // the only scheduled caller of scanRecentReplies. Best-effort: drift
    // observability never fails the run.
    const driftReport = await step.run("scan-persona-drift", async () => {
      try {
        const { scanRecentReplies } = await import("@/lib/brain/persona-drift-detector");
        const r = await scanRecentReplies({ windowHours: 24 });
        return { scanned: r.scanned, drifted: r.drifted };
      } catch (err) {
        log.warn("persona_drift_scan_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        return { scanned: 0, drifted: 0 };
      }
    });

    // THE GATE, deliberately last. Every step above has completed and is
    // memoized, so each retry replays them instead of re-running ingestion and
    // re-spending the scrape budget. Throwing here marks the run failed, which is
    // what routes it through the already-wired onInngestFailure -> Telegram path
    // after retries exhaust.
    const fatal = ingestionFailure(ingestionReport);
    if (fatal) {
      log.error("intelligence_ingestion_fatal", {
        sourcesAttempted: ingestionReport.sourcesAttempted,
        sourcesIngested: ingestionReport.sourcesIngested,
        totalClaims: ingestionReport.totalClaims,
      });
      throw new Error(fatal);
    }

    if (ingestionReport.failures.length > 0) {
      // Partial degradation is real but is NOT paged: a gate that fires on one
      // flaky feed gets muted, taking the total-outage signal with it.
      log.warn("ingestion_partially_degraded", {
        sourcesAttempted: ingestionReport.sourcesAttempted,
        sourcesIngested: ingestionReport.sourcesIngested,
        failed: ingestionReport.failures.length,
      });
    }

    return {
      status: "completed" as const,
      ingested: ingestionReport,
      personaDrift: driftReport,
    };
  },
);