/**
 * reelRecoveryLedger — what a reel job cost, what survived, and what is unknown.
 *
 * READ-ONLY. This module opens no provider connection, spends nothing, and
 * writes nothing. It answers one question per job, from rows that already
 * exist: "what did we pay for, what came out of it, and might any of it still
 * be live remotely?"
 *
 * WHY IT IS NEEDED. Before repeating a paid request or a publish, an ambiguous
 * remote outcome must be reconciled rather than retried — and that was not
 * possible to do systematically, because the facts were scattered across four
 * shapes and one of them was being deleted:
 *
 *   · provider operation id  — lived ONLY inside `reel_jobs.payload` JSON, and
 *     was deleted on the happy path and on terminal failure. Now retained in
 *     `beat.providerOps` (append-only) as well, so a paid handle survives its
 *     own success.
 *   · paid attempts          — `reel_jobs.attempts` is a single counter RESET
 *     at stage boundaries, so it does not count paid submissions;
 *     `generation_reservations.action_id` is `reel_job_<id>` and UNIQUE, so it
 *     holds exactly ONE cost row per job no matter how many attempts occurred,
 *     and its cost is an ESTIMATE (`isEstimate` defaults true — there is no USD
 *     feed from the CLI). Both limits are reported rather than papered over.
 *   · publication attempts   — two append-only rows in `autonomy_audit_events`
 *     with no FK to reel_jobs; deliberately no dedicated table.
 *   · quality verdict, scheduling intent — inside `payload` JSON.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not probe clip URLs for
 * reachability, call a provider to ask whether an operation is still running,
 * or infer that an unrecorded op did not happen. Every field is either read
 * from a row or reported as UNKNOWN. An honest gap is the product here: the
 * whole point is to stop a session concluding "nothing was paid for" from an
 * absence of evidence.
 */
import { createLogger } from "../lib/logger";

const log = createLogger("reel-recovery-ledger");

export interface ProviderOpRecord {
  provider: string;
  opId: string;
  at: string;
  outcome: string;
  beatNumber: number | null;
  /** True while the ACTIVE handle is still set — the op may still be live. */
  stillOutstanding: boolean;
}

export interface ReelLedgerEntry {
  jobId: number;
  briefId: string | null;
  status: string;
  /** Provider operations we can PROVE were submitted for this job. */
  providerOps: ProviderOpRecord[];
  /**
   * Ops whose active handle is still set: a request that may be running, or may
   * have billed, RIGHT NOW. Reconcile these before spending again.
   */
  outstandingOps: ProviderOpRecord[];
  clips: { count: number; urls: string[] };
  master: { url: string | null; present: boolean };
  /** Rendered-QA verdict from payload, when the flag was on at assembly time. */
  qualityVerdict: string | null;
  /** Approved publishing intent, when one was recorded. Null is not "none". */
  scheduledFor: string | null;
  publishedMediaId: string | null;
  /** Cost is a RESERVATION ESTIMATE, never an actual. Stated, not implied. */
  cost: { estimateUsd: number | null; isEstimate: true; note: string };
  /** Everything this row could not establish, named. */
  unknowns: string[];
}

export type LedgerResult =
  | { available: false; reason: string }
  | { available: true; entries: ReelLedgerEntry[]; scanned: number };

/**
 * Build the ledger for a bounded set of recent jobs.
 *
 * Bounded because this is an operator diagnostic, not a report: 200 covers
 * every job the pipeline has produced by a wide margin, and an unbounded scan
 * over a MEDIUMTEXT payload column is a way to hurt the database.
 */
export async function buildReelRecoveryLedger(opts?: { limit?: number; jobId?: number }): Promise<LedgerResult> {
  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200);
  try {
    const { getDb } = await import("../db");
    const d = await getDb();
    if (!d) return { available: false, reason: "Database not available" };

    const { reelJobs, generationReservations } = await import("../../drizzle/schema");
    const { desc, eq } = await import("drizzle-orm");

    const rows = opts?.jobId
      ? await d.select().from(reelJobs).where(eq(reelJobs.id, opts.jobId)).limit(1)
      : await d.select().from(reelJobs).orderBy(desc(reelJobs.createdAt), desc(reelJobs.id)).limit(limit);

    const entries: ReelLedgerEntry[] = [];
    for (const job of rows) {
      const unknowns: string[] = [];

      // ── payload: provider ops, QA verdict, scheduling intent ──
      let beats: Array<Record<string, unknown>> = [];
      let qualityVerdict: string | null = null;

      // SCHEDULING INTENT COMES FROM THE COLUMN, not the payload.
      //
      // This read `payload.publicationIntendedAt` - a key nothing has ever
      // written. The writer puts the value in the `publication_intended_at`
      // COLUMN on the same insert (reelPipeline enqueue), and the payload it
      // serialises alongside is the brief, which has no such field. So the
      // operator's recovery ledger reported "no scheduled time" for every reel
      // ever queued, including the 28 currently sitting with a real one.
      //
      // Verified against production 2026-09-09: every assembled autopost job
      // from 2026-09-09 to 2026-10-07 carries a populated intent at 18:00 local,
      // one per day with no gap. The data was there the whole time; the ledger
      // was reading the wrong place for it.
      const intended = (job as { publicationIntendedAt?: Date | string | null }).publicationIntendedAt;
      let scheduledFor: string | null =
        intended instanceof Date
          ? intended.toISOString()
          : typeof intended === "string" && intended
            ? intended
            : null;
      try {
        const payload = JSON.parse(job.payload ?? "{}") as Record<string, unknown>;
        const sb = payload.storyboardBeats;
        if (Array.isArray(sb)) beats = sb as Array<Record<string, unknown>>;
        const qa = payload.renderedQa as Record<string, unknown> | undefined;
        // FIELD NAME, corrected. This read `qa.verdict`, and RenderedQaVerdict
        // has no such field - it carries `decision` ("approve" | "repair").
        // So the operator's "why is every reel held" diagnostic printed a null
        // quality verdict for every job ever written, on both branches, and
        // looked exactly like a QA stage that had not run.
        if (qa && typeof qa.decision === "string") qualityVerdict = qa.decision;
      } catch {
        unknowns.push("payload_unparseable — provider ops, QA verdict and scheduling intent are UNKNOWN for this job");
      }

      const providerOps: ProviderOpRecord[] = [];
      const outstandingOps: ProviderOpRecord[] = [];
      for (const beat of beats) {
        const beatNumber = typeof beat.beatNumber === "number" ? beat.beatNumber : null;

        const history = Array.isArray(beat.providerOps) ? (beat.providerOps as Array<Record<string, unknown>>) : [];
        for (const op of history) {
          if (typeof op?.opId !== "string") continue;
          providerOps.push({
            provider: String(op.provider ?? "unknown"),
            opId: op.opId,
            at: String(op.at ?? ""),
            outcome: String(op.outcome ?? "unknown"),
            beatNumber,
            stillOutstanding: false,
          });
        }

        // ACTIVE handles: a request that may still be running or billing.
        for (const [field, provider] of [["higgsfieldRequestId", "higgsfield"], ["veoOperationName", "veo"]] as const) {
          const active = beat[field];
          if (typeof active === "string" && active.trim()) {
            const rec: ProviderOpRecord = {
              provider, opId: active, at: "", outcome: "outstanding", beatNumber, stillOutstanding: true,
            };
            providerOps.push(rec);
            outstandingOps.push(rec);
          }
        }

        // A beat with neither history nor an active handle predates providerOps
        // (added 2026-09-07) or never submitted. Those are not the same thing
        // and this cannot tell them apart — so it says so instead of guessing.
        if (!history.length && !beat.higgsfieldRequestId && !beat.veoOperationName) {
          unknowns.push(`beat ${beatNumber ?? "?"}: no provider op recorded — either it predates op history, or none was submitted. NOT evidence that nothing was paid for.`);
        }
      }

      // ── clips ──
      let clipUrls: string[] = [];
      try {
        const parsed = JSON.parse(job.clipUrlsJson ?? "[]");
        if (Array.isArray(parsed)) clipUrls = parsed.filter((u): u is string => typeof u === "string");
      } catch {
        unknowns.push("clipUrlsJson_unparseable — surviving clips are UNKNOWN");
      }
      // Reachability is deliberately NOT probed here: a 200 today is not a
      // guarantee, and a network call would make a read-only diagnostic
      // conditional on the internet. Provider-hosted clip URLs (Higgsfield
      // returns its own CDN url and it is stored as-is, not re-hosted) can
      // expire with nothing in this repo watching.
      unknowns.push("clip reachability NOT probed — provider-hosted URLs may have expired");

      // ── cost: one estimate row per job, by construction ──
      let estimateUsd: number | null = null;
      try {
        const [res] = await d
          .select()
          .from(generationReservations)
          .where(eq(generationReservations.actionId, `reel_job_${job.id}`))
          .limit(1);
        const raw = res ? (res as Record<string, unknown>).actualCostUsd ?? (res as Record<string, unknown>).estimatedCostUsd : null;
        estimateUsd = raw === null || raw === undefined ? null : Number(raw);
      } catch {
        unknowns.push("generation_reservations unreadable — cost is UNKNOWN");
      }

      entries.push({
        jobId: job.id,
        briefId: job.briefId ?? null,
        status: String(job.status ?? "unknown"),
        providerOps,
        outstandingOps,
        clips: { count: clipUrls.length, urls: clipUrls },
        master: { url: job.mp4Url ?? null, present: Boolean(job.mp4Url && String(job.mp4Url).trim()) },
        qualityVerdict,
        scheduledFor,
        publishedMediaId: job.igPostId ?? null,
        cost: {
          estimateUsd,
          isEstimate: true,
          note: "generation_reservations.action_id is UNIQUE per job, so this is ONE row however many paid attempts occurred, and the value is a reservation estimate — there is no USD feed from the provider CLI.",
        },
        unknowns,
      });
    }

    return { available: true, entries, scanned: rows.length };
  } catch (err) {
    log.error("[reelRecoveryLedger] build failed", { error: err instanceof Error ? err.message : String(err) });
    return { available: false, reason: err instanceof Error ? err.message : "Query failed" };
  }
}
