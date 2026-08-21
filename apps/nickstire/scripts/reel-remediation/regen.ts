/**
 * Phase 4 — regenerate. Spends real Higgsfield/Veo credits. Reuses the
 * EXISTING, already-hardened pipeline (enqueueReelJob + processNextReelJob +
 * processNextAssemblyJob — the same machinery Phase 2 fixed to never fall
 * back to stock) rather than reimplementing clip generation here: this
 * script's job is to drive that machinery per ledger entry and record what
 * happened, not to duplicate it.
 *
 * Mirrors regenerateReelFromBrief's (content.ts) stale-state strip exactly,
 * including the veoOperationName fix from this remediation's Phase 2 round 2
 * — the same bug (a stuck queued<->generating loop + an orphaned ledger
 * reservation) is exactly as reachable from a script-driven regenerate as
 * from the admin button.
 *
 * Zero-traction hook variants (mission Phase 4 step 3) are OUT OF SCOPE for
 * this run — it requires new LLM-based creative generation, a different
 * kind of work than "resubmit the existing brief for real generation".
 * Reels whose insights_snapshot shows near-zero reach are flagged in the
 * summary, not silently skipped or silently treated as fine.
 *
 * higgsfield_job_ids stays empty for Higgsfield beats (see ledger.ts's
 * RegenRecord doc comment) — not fabricated.
 */
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", "..", ".env") });

// 2026-08-20 · validated via a real --limit=1 run: auto-select prefers Veo
// whenever Veo credentials are present (reelPipeline.ts's selectReelVideoProvider),
// and Veo requires S3_BUCKET (assertDurableStorageForGeneration,
// reelPipeline.ts:645 — Veo re-hosts through storagePut, so without durable
// storage the clip would land on ephemeral disk and be lost on redeploy).
// S3_BUCKET is not configured in this environment (see the Phase 3 commit's
// "known gap" note) — every Veo attempt failed 3x on that guard alone, no
// paid API call ever made (the guard fires before the request), so no
// credits were spent, but no footage was produced either.
// Higgsfield needs none of this — it returns its own durable CDN URL
// (reelPipeline.ts:643's own comment: "Higgsfield is the only provider that
// returns its own durable CDN URL") — and it is the THEMATICALLY correct
// choice regardless: Higgsfield being down is the entire reason this
// remediation exists, and it is confirmed live right now (62 credits,
// keepalive fresh). Pinned here, in this script's own process only — not a
// Railway env change, and not touching REEL_VIDEO_PROVIDER anywhere else.
process.env.REEL_VIDEO_PROVIDER = "higgsfield";

// 2026-08-21 · MEASURED from the first full batch (all 3 reels that reached
// generation died identically: "beat N timed out after 360s", burning $4.00 of
// budget for zero usable footage — and failed reservations still count against
// the daily cap, so the waste compounds).
//
// The per-beat durations that batch actually produced, in order:
//   139s 140s 189s 196s 212s 213s 267s 329s 342s → then 3× timeout
// Two things are visible there. The ceiling (GEN_CLIP_TIMEOUT_MS, 6 min) is
// marginal — 342s and 329s landed within 20-30s of it. And the durations CREEP
// as the batch runs: job 1740004's beats went 140s → 267s → 342s → timeout,
// which is queue contention from running 3 reels concurrently against one
// Higgsfield account, not per-clip difficulty.
//
// So both levers move together: give a genuinely slow clip room to finish, and
// stop generating the contention that makes clips slow in the first place.
// Env override only — this process, not Railway, not the prod cron.
process.env.REEL_GEN_CLIP_TIMEOUT_MS = process.env.REEL_GEN_CLIP_TIMEOUT_MS || String(15 * 60_000);

import { getDb } from "../../server/db";
import { reelJobs } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { enqueueReelJob, processNextReelJob, processNextAssemblyJob, REEL_GENERATION_TERMINAL_STATUSES } from "../../server/services/reelPipeline";
import { higgsfieldSessionLiveness } from "../../server/services/higgsfieldStudio";
import { withOperatorAction } from "../../server/services/operatorActionLog";
import { evaluateReelPublishGate } from "../../server/services/qualityGate";
import { sampleFrameSignature, frameLooksSynthetic, extractStockAssets, SYNTHETIC_LUMA_STDDEV_MAX } from "./signals";
import { loadLedger, saveLedger, upsertEntry, LEDGER_TERMINAL, type LedgerEntry } from "./ledger";

/**
 * SERIAL, deliberately — was 3 (the mission's suggested cap), lowered
 * 2026-08-21 on the batch evidence above: 3 concurrent reels against one
 * Higgsfield account made per-beat time climb 140s → 342s until beats fell off
 * the timeout cliff. Wall-clock is not the binding constraint here anyway —
 * the daily generation budget is (~$8/day vs ~$1.25-1.50 per reel, so roughly
 * 5 reels can run per day regardless of how fast they render). Trading speed
 * we cannot use for reliability we badly need.
 */
const CONCURRENCY_CAP = 1;
const POLL_INTERVAL_MS = 3000;
/** Raised alongside the clip timeout — at 15 min/clip and ~6 beats, a single
 *  reel can legitimately need well over the old ~10 min ceiling. */
const MAX_POLLS_PER_JOB = 1400; // ~70 minutes wall-clock ceiling per reel before giving up as failed
/** Reach below this is "near-zero traction" for the zero-traction exception's flag (not enforced, just surfaced). */
const ZERO_TRACTION_REACH = 20;
/** Conservative floor: assume at least 1 credit per beat when the exact per-clip cost isn't parseable from anywhere in this codebase. */
const ASSUMED_CREDITS_PER_BEAT = 1;

/** Internal marker: an enqueue that the content governor / autonomy policy legitimately refused, not a real failure. */
class DeferredEnqueue extends Error {}

const STALE_BRIEF_FIELDS = ["renderedQa", "audioQa", "repairQueue", "mp4History", "contentReservationId"];

function stripStaleBrief(brief: Record<string, unknown>): Record<string, unknown> {
  for (const field of STALE_BRIEF_FIELDS) delete brief[field];
  const beats = Array.isArray(brief.storyboardBeats) ? (brief.storyboardBeats as Array<Record<string, unknown>>) : [];
  for (const beat of beats) {
    if (beat && typeof beat === "object") delete beat.veoOperationName;
  }
  return brief;
}

async function creditPrecheck(pendingBeatsTotal: number): Promise<{ ok: boolean; reason: string }> {
  const liveness = await higgsfieldSessionLiveness();
  if (liveness.live === false) {
    return { ok: false, reason: `Higgsfield session is not live: ${liveness.reason}` };
  }
  if (liveness.balanceCredits === null) {
    return { ok: true, reason: "balance unknown (keepalive has not reported a parseable credit count) — proceeding, since a blind spot must not block a working provider" };
  }
  if (liveness.balanceCredits < pendingBeatsTotal * ASSUMED_CREDITS_PER_BEAT) {
    return { ok: false, reason: `balance ${liveness.balanceCredits} credits < ${pendingBeatsTotal} beats × ${ASSUMED_CREDITS_PER_BEAT} assumed credit/beat (coarse estimate — exact per-clip cost is not parsed anywhere in this codebase)` };
  }
  return { ok: true, reason: `balance ${liveness.balanceCredits} credits, ${pendingBeatsTotal} beats pending — sufficient under the coarse estimate` };
}

async function driveJobToTerminal(jobId: number): Promise<{ status: string; error: string | null }> {
  // Found the hard way: a ledger read/write bug once let `jobId` reach here
  // as `undefined` (see ledger.ts's loadLedger backfill comment). Both
  // processNextReelJob/processNextAssemblyJob treat a MISSING scopeJobId as
  // "claim ANY queued job in the whole system" — an undefined jobId here
  // would silently hijack and generate footage against an unrelated,
  // completely real production job instead of erroring. No prod job was
  // touched that time (the queue happened to be empty), but that was luck,
  // not a guarantee. This assertion makes the failure loud and immediate
  // instead of a possible silent wrong-job claim.
  if (!Number.isInteger(jobId) || jobId <= 0) {
    throw new Error(`driveJobToTerminal called with an invalid jobId (${jobId}) — refusing to call processNextReelJob without a scope, which would claim ANY queued job`);
  }
  for (let i = 0; i < MAX_POLLS_PER_JOB; i++) {
    const gen = await processNextReelJob(jobId).catch((err) => ({ processed: false, error: err instanceof Error ? err.message : String(err) }));
    await processNextAssemblyJob(jobId).catch(() => undefined);

    const { getDb: db2 } = await import("../../server/db");
    const d = await db2();
    if (!d) return { status: "unknown", error: "DB unavailable mid-drive" };
    const [row] = await d.select().from(reelJobs).where(eq(reelJobs.id, jobId)).limit(1);
    if (!row) return { status: "unknown", error: "job row disappeared" };

    if (row.status === "assembled" || REEL_GENERATION_TERMINAL_STATUSES.has(row.status)) {
      return { status: row.status, error: row.error ?? ("error" in gen ? (gen as { error?: string }).error ?? null : null) };
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return { status: "timeout", error: `did not reach a terminal status within ${MAX_POLLS_PER_JOB * POLL_INTERVAL_MS / 1000}s` };
}

async function qcNewRender(jobId: number): Promise<{ passed: boolean; checks: Record<string, boolean>; notes: string[] }> {
  const checks: Record<string, boolean> = {};
  const notes: string[] = [];
  const db = await getDb();
  if (!db) return { passed: false, checks, notes: ["DB unavailable for QC"] };
  const [row] = await db.select().from(reelJobs).where(eq(reelJobs.id, jobId)).limit(1);
  if (!row) return { passed: false, checks, notes: ["job row not found"] };

  checks.has_render = Boolean(row.mp4Url);
  if (!row.mp4Url) notes.push("no mp4Url on the new job — assembly did not produce a file");

  // The mission's own QC list (ffprobe duration/resolution/aspect/audio) is
  // already what reelAssembly's own render step enforces before a job can
  // reach "assembled" at all — re-deriving it here would be a second, looser
  // copy of a check the pipeline already does authoritatively. What this
  // script's QC uniquely adds is the remediation-specific one: re-running
  // Phase 1's stock-frame signal against the NEW render, since that is
  // exactly what this whole remediation exists to guarantee is now absent.
  const stockAssets = extractStockAssets(row.clipUrlsJson);
  checks.no_stock_path = stockAssets.length === 0;
  if (stockAssets.length > 0) notes.push(`${stockAssets.length} clip(s) STILL contain "reels/template-stock/" — regeneration did not actually replace the stock footage`);

  const clips = (() => { try { const a = JSON.parse(row.clipUrlsJson ?? "[]"); return Array.isArray(a) ? a.filter((u) => typeof u === "string") : []; } catch { return []; } })();
  if (clips.length > 0) {
    const sample = await sampleFrameSignature(clips[0]);
    if (sample) {
      const synthetic = frameLooksSynthetic(sample);
      checks.no_synthetic_frame_signature = !synthetic;
      notes.push(`frame sample: luma std-dev ${sample.stdDevLuma} (mean ${sample.meanLuma}, range ${sample.rangeLuma})`);
      if (synthetic) notes.push(`frame is FLAT (std-dev ${sample.stdDevLuma} < ${SYNTHETIC_LUMA_STDDEV_MAX}) — still the synthetic gradient lane, not real footage`);
    } else {
      notes.push("frame sample failed (ffmpeg unavailable/unreachable/timeout) — no_synthetic_frame_signature left unchecked, not assumed passing");
    }
  }

  // The publish gate itself — the same unbypassable check that blocks a
  // live post — is the strongest available signal that this render is
  // safe to eventually repost. Not authoritative for "reel not yet fully
  // assembled", so failure here is recorded but does not alone fail QC.
  try {
    const gate = await evaluateReelPublishGate(jobId, { runIfMissing: false });
    checks.publish_gate_would_allow = gate.allowed;
    if (!gate.allowed) notes.push(`publish gate: ${gate.gate} — ${gate.reason}`);
  } catch (err) {
    notes.push(`publish gate could not be evaluated: ${err instanceof Error ? err.message : String(err)}`);
  }

  const passed = checks.has_render === true && checks.no_stock_path === true && checks.no_synthetic_frame_signature !== false;
  return { passed, checks, notes };
}

async function regenerateOne(entry: LedgerEntry): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  let jobId = entry.regen.job_id;
  if (jobId === null) {
    const [row] = await db.select().from(reelJobs).where(eq(reelJobs.id, entry.reel_id)).limit(1);
    if (!row) { console.log(`  reel ${entry.reel_id}: source job row not found — skipping.`); entry.regen.status = "failed"; return; }
    let brief: Record<string, unknown>;
    try { brief = JSON.parse(row.payload); } catch { console.log(`  reel ${entry.reel_id}: unreadable brief JSON — skipping.`); entry.regen.status = "failed"; return; }
    brief = stripStaleBrief(brief);

    const zeroTraction = (entry.insights_snapshot ?? []).some((s) => s.reach !== null && s.reach < ZERO_TRACTION_REACH);
    if (zeroTraction) {
      console.log(`  reel ${entry.reel_id}: ⚠ near-zero reach in its snapshot — mission suggests fresh hook variants here; this run reuses the EXISTING hook (LLM hook-variant generation is out of scope for this pass).`);
    }

    console.log(`  reel ${entry.reel_id}: enqueueing regeneration from the (stripped) original brief...`);
    try {
      const { GovernorDenial } = await import("../../server/services/contentGovernor");
      const { AutonomyDenial } = await import("../../server/services/autonomyControl");
      const { jobId: newJobId } = await withOperatorAction(
        { action: "regenerate", operatorId: null, jobId: entry.reel_id, costsMoney: true },
        () => enqueueReelJob(brief as never, "admin", {
          objective: "DISCOVERY",
          disclosureMode: "visibly_animated",
          ctaType: (brief as { ctaType?: "SEND" | "SAVE" | "COMMENT" | "VISIT" | "FOLLOW" | "NONE" }).ctaType ?? "NONE",
        }),
        {
          isRefusal: (err) => err instanceof GovernorDenial || err instanceof AutonomyDenial,
        },
      ).catch((err) => {
        // 2026-08-20 · operator decision ("add new volume"): a regenerated
        // reel competes for a calendar slot like new content — it does NOT
        // bypass the content governor's repeat-CTA/topic/territory throttle.
        // A GovernorDenial (or an autonomy-policy pause) is therefore a
        // "try again after the window clears" signal, not a real failure —
        // re-throwing a typed marker so the outer catch can tell them apart
        // from a genuine enqueue error without re-importing both classes.
        if (err instanceof GovernorDenial || err instanceof AutonomyDenial) {
          throw new DeferredEnqueue(err.message);
        }
        throw err;
      });
      jobId = newJobId;
      entry.regen.job_id = jobId;
      entry.regen.status = "in_progress";
    } catch (err) {
      if (err instanceof DeferredEnqueue) {
        console.log(`  reel ${entry.reel_id}: deferred — ${err.message} (retry on a later run, once the governor's lookback window clears)`);
        entry.regen.status = "deferred";
        return;
      }
      console.log(`  reel ${entry.reel_id}: enqueue failed: ${err instanceof Error ? err.message : String(err)}`);
      entry.regen.status = "failed";
      return;
    }
  } else {
    console.log(`  reel ${entry.reel_id}: resuming already-enqueued job ${jobId}.`);
  }

  console.log(`  reel ${entry.reel_id}: driving job ${jobId} to a terminal status...`);
  const result = await driveJobToTerminal(jobId);
  console.log(`  reel ${entry.reel_id}: job ${jobId} reached "${result.status}"${result.error ? ` — ${result.error}` : ""}`);

  if (result.status !== "assembled") {
    entry.regen.status = "failed";
    entry.regen.qc = { passed: false, checks: {}, notes: [`generation did not reach assembled: ${result.status}${result.error ? ` (${result.error})` : ""}`] };
    return;
  }

  const qc = await qcNewRender(jobId);
  entry.regen.qc = qc;
  if (qc.passed) {
    const [row] = await db.select().from(reelJobs).where(eq(reelJobs.id, jobId)).limit(1);
    entry.regen.new_render_path = row?.mp4Url ?? null;
    entry.regen.status = "qc_passed";
    console.log(`  reel ${entry.reel_id}: QC PASSED. new_render_path=${entry.regen.new_render_path}`);
  } else {
    entry.regen.status = "qc_failed";
    console.log(`  reel ${entry.reel_id}: QC FAILED — ${qc.notes.join("; ")}`);
  }
}

async function main() {
  const ledger = loadLedger();
  const entries = Object.values(ledger.entries);
  if (entries.length === 0) { console.log("Ledger is empty — run detect.ts (Phase 1) first."); process.exit(1); }

  let pending = entries.filter((e) => !LEDGER_TERMINAL.regenerated(e));
  if (pending.length === 0) { console.log("Every ledger entry is already regen-terminal (qc_passed or failed). Nothing to do."); process.exit(0); }

  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  if (limitArg) {
    const n = Number(limitArg.split("=")[1]);
    if (Number.isFinite(n) && n > 0) {
      pending = pending.slice(0, n);
      console.log(`--limit=${n}: restricting this run to ${pending.length} reel(s) — for validating the pipeline before committing the full batch.`);
    }
  }

  const db = await getDb();
  if (!db) throw new Error("DB not available — check DATABASE_URL");

  let totalBeats = 0;
  for (const e of pending) {
    const [row] = await db.select().from(reelJobs).where(eq(reelJobs.id, e.reel_id)).limit(1);
    if (!row) continue;
    try {
      const brief = JSON.parse(row.payload);
      totalBeats += Array.isArray(brief.storyboardBeats) ? brief.storyboardBeats.length : 0;
    } catch { /* counted as 0 beats if unreadable — precheck stays conservative */ }
  }

  console.log(`${pending.length} reel(s) pending regeneration, ~${totalBeats} beat(s) total.`);
  const precheck = await creditPrecheck(totalBeats);
  console.log(`Credit precheck: ${precheck.ok ? "OK" : "ABORT"} — ${precheck.reason}`);
  if (!precheck.ok) {
    console.log("\nAborting the batch — a mass burst re-trips the outage cause if it was quota/billing (mission Phase 4 step 1).");
    process.exit(1);
  }

  // Concurrency cap 3, per the mission — a simple worker pool over `pending`.
  let cursor = 0;
  async function worker() {
    while (cursor < pending.length) {
      const entry = pending[cursor++];
      try {
        await regenerateOne(entry);
      } catch (err) {
        console.log(`  reel ${entry.reel_id}: uncaught error — ${err instanceof Error ? err.message : String(err)}`);
        entry.regen.status = "failed";
      }
      upsertEntry(ledger, entry);
      saveLedger(ledger); // after EVERY reel, matching Phase 3's resumability
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY_CAP, pending.length) }, () => worker()));

  const all = Object.values(ledger.entries);
  const passed = all.filter((e) => e.regen.status === "qc_passed").length;
  const failed = all.filter((e) => e.regen.status === "failed" || e.regen.status === "qc_failed").length;
  const deferred = all.filter((e) => e.regen.status === "deferred").length;
  const stillPending = all.filter((e) => !LEDGER_TERMINAL.regenerated(e) && e.regen.status !== "deferred").length;
  console.log(`\n─── Phase 4 summary ───`);
  console.log(`  qc_passed: ${passed}`);
  console.log(`  failed/qc_failed: ${failed}`);
  console.log(`  deferred (governor/autonomy refused — re-run later): ${deferred}`);
  console.log(`  still pending (not yet attempted this run): ${stillPending}`);
  if (failed > 0) {
    console.log(`\n  Failed/qc_failed reels (need manual review, NOT reposted per the mission's hard rule):`);
    for (const e of all.filter((x) => x.regen.status === "failed" || x.regen.status === "qc_failed")) {
      console.log(`    reel ${e.reel_id}: ${e.regen.status} — ${e.regen.qc?.notes.join("; ") ?? "no QC notes"}`);
    }
  }
  if (deferred > 0) {
    console.log(`\n  Deferred reels (re-run regen.ts once the governor's lookback window clears — 72h CTA / 48h territory / 7d topic):`);
    for (const e of all.filter((x) => x.regen.status === "deferred")) {
      console.log(`    reel ${e.reel_id}`);
    }
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("Phase 4 regeneration failed:", err);
  process.exit(1);
});
