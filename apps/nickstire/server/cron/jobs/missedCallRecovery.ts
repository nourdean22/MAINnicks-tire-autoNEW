/**
 * Cron: Missed-Call Recovery (Wave F, 2026-07-13)
 *
 * Proactively follows up with people who CALLED the shop's VAPI line but
 * didn't convert (no lead, no callback) — a "sorry we missed your call,
 * what's going on with the car?" text. Missed-call follow-up is standard
 * practice for service shops; the audience is people who just contacted
 * the business (a relationship message, not a cold marketing blast).
 *
 * SAFETY / COMPLIANCE (a new automated outbound-SMS channel):
 *   - Reuses the EXISTING `vapi_forwarded_call_followup` orchestrator type,
 *     so every send inherits opt-out enforcement, quiet-hours, per-run
 *     caps, the STOP footer, and complianceLog. Zero changes to the shared
 *     payment-SMS code.
 *   - orchestrateSms is idempotent per vapiCallId → a call already
 *     followed-up (by the webhook path or a prior run) is never re-texted.
 *   - Durable at-most-once ALSO stamped on the call log's metadata BEFORE
 *     the send (survives restarts, independent of the orchestrator).
 *   - SHADOW BY DEFAULT: master flag `missed_call_recovery` gates the whole
 *     job; even when ON it only IDENTIFIES + logs + Telegrams the audience
 *     and sends NOTHING, until env MISSED_CALL_RECOVERY_SEND=1 flips it live.
 *   - Conservative eligibility: real conversations only (>=15s), recent
 *     (last 24h, older than 45min so the shop's own callback goes first),
 *     nothing captured, opt-outs excluded, hard daily/run cap.
 *   - A caller it will NOT text (SMS opt-out in either mode, or a shadow-run
 *     candidate up to RUN_CAP) gets one callback_requests row instead, so the
 *     shop owns the call-back (C3.3, 2026-10-18). Cap-skips get no row.
 *   - "Reached a tool" (convertedToLead=1) callers are included ONLY when a
 *     successful read proves the call captured nothing (operator decision
 *     2026-10-02, reversing the 2026-09-23 skip: ~101 calls/week reached a
 *     tool — e.g. a tire-price lookup — and saved no lead, callback or
 *     arrival, so nobody followed up). A failed evidence read skips the call:
 *     unknown is never "nothing captured" on a customer-contact lane.
 */
import { createLogger } from "../../lib/logger";
import { BUSINESS } from "@shared/business";

const log = createLogger("cron:missed-call-recovery");

const RUN_CAP = 15; // max sends per run — keep volume human-scale
const MIN_DURATION_SECONDS = 15; // exclude hangups / robocalls / wrong numbers
const WINDOW_MAX_AGE_MS = 24 * 60 * 60 * 1000; // only recent calls stay relevant
const WINDOW_MIN_AGE_MS = 45 * 60 * 1000; // let the shop's own callback happen first

export interface MissedCallRow {
  id: number;
  vapiCallId: string;
  phoneNumber: string | null;
  durationSeconds: number;
  convertedToLead: number;
  leadId: number | null;
  callbackId: number | null;
  recoveryAlreadyStamped: boolean;
  createdAtMs: number;
  /**
   * Only meaningful when convertedToLead === 1: true iff a SUCCESSFUL read of
   * the call's capture evidence found no lead, callback, callback request or
   * expected arrival. Undefined (not read, or the read failed) never qualifies.
   */
  capturedNothing?: boolean;
}

/**
 * Pure eligibility predicate — the single source of truth for "should this
 * missed call get a recovery text now". Extracted so the rule is
 * unit-tested rather than buried in the query.
 */
export function isMissedCallEligible(row: MissedCallRow, nowMs: number): boolean {
  if (!row.phoneNumber) return false;
  // convertedToLead means a capture/confirm tool fired on the call ("reached a
  // tool"), not that a lead row exists: a tireInquiry-only caller has it set
  // with nothing saved. Eligible only when the call is PROVEN to have captured
  // nothing (operator decision 2026-10-02); unproven stays a skip.
  if (row.convertedToLead === 1 && row.capturedNothing !== true) return false;
  if (row.leadId != null || row.callbackId != null) return false; // already captured
  if (row.recoveryAlreadyStamped) return false; // one-shot
  if (row.durationSeconds < MIN_DURATION_SECONDS) return false; // not a real conversation
  const age = nowMs - row.createdAtMs;
  return age >= WINDOW_MIN_AGE_MS && age <= WINDOW_MAX_AGE_MS;
}

/**
 * Proof that a tool-reaching call (convertedToLead = 1) captured NOTHING: no
 * lead, no callback, no callback request citing the call, no expected arrival.
 * A failed evidence read is unknown and returns false (skip, never a false
 * positive). Shared by this cron and the revenue-opportunity collector so the
 * rule cannot drift between the two again.
 */
export async function proveCapturedNothing(vapiCallId: string): Promise<boolean> {
  const { loadCallCaptureEvidence } = await import("../../services/vapiActionExtraction");
  const ev = await loadCallCaptureEvidence(vapiCallId);
  return (
    ev.reachedTool !== undefined && // undefined = the read failed → unknown → skip
    ev.leadId == null && ev.callbackId == null &&
    !ev.existingCallbackForCall && !ev.hasExpectedArrival
  );
}

function maskPhone(p: string | null): string {
  if (!p) return "??";
  const d = p.replace(/\D/g, "");
  return d.length >= 4 ? `***${d.slice(-4)}` : "***";
}

/** callback_requests.sourcePage for rows this cron writes; escalateStaleCallbacks skips its customer text for them. */
export const MISSED_CALL_CALLBACK_SOURCE = "missed-call-recovery";

type ClaimDb = { execute(q: unknown): Promise<unknown> };

/**
 * C3.3: a caller this cron will NOT text (opted out of SMS, or the lane is in
 * shadow) gets one callback_requests row so the shop owns the phone follow-up.
 * At most once per call: a CAS on metadata.recoveryCallbackAt (a separate key
 * from recoverySmsAt, so a shadow row never blocks a later live text). The
 * context carries `callId=<id>`, the rule loadCallCaptureEvidence matches, so a
 * tool-reaching caller with this row reads as captured and is not texted later.
 * Never throws: a callback write must not kill the text lane.
 */
async function requestCallbackForMissedCall(
  db: ClaimDb,
  row: MissedCallRow,
  reason: "opt_out" | "shadow",
): Promise<"written" | "duplicate" | "failed"> {
  const { sql } = await import("drizzle-orm");
  const stamp = new Date().toISOString();
  let claimed = false;
  try {
    const claim = await db.execute(sql`
      UPDATE vapi_call_logs
      SET metadata = JSON_SET(COALESCE(metadata, JSON_OBJECT()), '$.recoveryCallbackAt', ${stamp})
      WHERE id = ${row.id}
        AND (metadata IS NULL OR JSON_EXTRACT(metadata, '$.recoveryCallbackAt') IS NULL)
    `);
    const affected = (claim as Array<{ affectedRows?: number }>)[0]?.affectedRows ?? 0;
    if (affected !== 1) return "duplicate";
    claimed = true;
    const why = reason === "opt_out" ? "customer opted out of SMS" : "recovery texts are in shadow mode";
    const { createCallbackRequest } = await import("../../db");
    await createCallbackRequest({
      name: "Missed call (name unknown)",
      phone: row.phoneNumber!,
      context: `Missed VAPI call callId=${row.vapiCallId}, ${row.durationSeconds}s. No recovery text sent (${why}). Please call back.`,
      sourcePage: MISSED_CALL_CALLBACK_SOURCE,
      status: "new",
    });
    return "written";
  } catch (err) {
    log.warn("Missed-call callback row failed", {
      callId: row.vapiCallId,
      phone: maskPhone(row.phoneNumber),
      error: err instanceof Error ? err.message : String(err),
    });
    // Release only OUR stamp so the next run can retry; a lost callback is worse than a duplicate one.
    if (claimed) {
      await db.execute(sql`
        UPDATE vapi_call_logs
        SET metadata = JSON_REMOVE(metadata, '$.recoveryCallbackAt')
        WHERE id = ${row.id}
          AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.recoveryCallbackAt')) = ${stamp}
      `).catch((e: unknown) => log.warn("Missed-call callback claim release failed", {
        callId: row.vapiCallId,
        error: e instanceof Error ? e.message : String(e),
      }));
    }
    return "failed";
  }
}

export async function processMissedCallRecovery(): Promise<{ recordsProcessed: number; shadow: boolean; candidates: number; callbackRows?: number; details?: string }> {
  try {
    // Business hours (ET) — never text outside them, and the orchestrator's
    // quiet-hours would skip anyway, but don't even build the run off-hours.
    const etHour = parseInt(new Date().toLocaleString("en-US", { timeZone: BUSINESS.timezone, hour: "numeric", hour12: false }), 10);
    if (etHour < 9 || etHour > 17) return { recordsProcessed: 0, shadow: true, candidates: 0 };

    const { isEnabled } = await import("../../services/featureFlags");
    if (!(await isEnabled("missed_call_recovery"))) return { recordsProcessed: 0, shadow: true, candidates: 0 };

    // SHADOW unless explicitly flipped live. Shadow identifies + logs the
    // audience and sends NOTHING (and does NOT claim, so a later live run
    // can still reach them).
    const live = process.env.MISSED_CALL_RECOVERY_SEND === "1";
    if (live) {
      // C5.5 runtime pause (send_pause_missed_call_recovery), fail closed, before any read or claim.
      const { sendPauseHoldReason } = await import("../../services/sendPause");
      const held = await sendPauseHoldReason("missed_call_recovery");
      if (held) {
        log.info("Missed-call recovery held", { reason: held });
        return { recordsProcessed: 0, shadow: true, candidates: 0, details: `Skipped · ${held}` };
      }
    }

    const { getDbTyped } = await import("../../db");
    const db = await getDbTyped();
    if (!db) return { recordsProcessed: 0, shadow: !live, candidates: 0 };

    const { vapiCallLogs, customers } = await import("../../../drizzle/schema");
    const { and, eq, gte, lte, isNull, isNotNull, sql, desc } = await import("drizzle-orm");
    const { normalizePhone } = await import("../../lib/phone");

    const now = Date.now();
    const windowStart = new Date(now - WINDOW_MAX_AGE_MS);
    const windowEnd = new Date(now - WINDOW_MIN_AGE_MS);

    const rows = await db.select({
      id: vapiCallLogs.id,
      vapiCallId: vapiCallLogs.vapiCallId,
      phoneNumber: vapiCallLogs.phoneNumber,
      durationSeconds: vapiCallLogs.durationSeconds,
      convertedToLead: vapiCallLogs.convertedToLead,
      leadId: vapiCallLogs.leadId,
      callbackId: vapiCallLogs.callbackId,
      metadata: vapiCallLogs.metadata,
      createdAt: vapiCallLogs.createdAt,
    })
      .from(vapiCallLogs)
      .where(and(
        isNotNull(vapiCallLogs.phoneNumber),
        isNull(vapiCallLogs.leadId),
        isNull(vapiCallLogs.callbackId),
        gte(vapiCallLogs.createdAt, windowStart),
        lte(vapiCallLogs.createdAt, windowEnd),
      ))
      .orderBy(desc(vapiCallLogs.createdAt))
      .limit(100);

    // Opt-out set (transport-level sendSms enforces this too — belt + suspenders).
    const optedOutRows = await db.select({ phone: customers.phone })
      .from(customers)
      .where(eq(customers.smsOptOut, 1));
    const optOuts = new Set(
      optedOutRows
        .map((r: { phone: string | null }) => normalizePhone(r.phone))
        .filter((p: string | null): p is string => p !== null),
    );

    const eligible: MissedCallRow[] = [];
    let callbackRows = 0; // callers handed to the shop's callback queue this run
    let optOutCallbacks = 0;
    for (const r of rows) {
      const meta = (r.metadata ?? null) as Record<string, unknown> | null;
      const row: MissedCallRow = {
        id: r.id,
        vapiCallId: r.vapiCallId,
        phoneNumber: r.phoneNumber,
        durationSeconds: r.durationSeconds,
        convertedToLead: r.convertedToLead,
        leadId: r.leadId,
        callbackId: r.callbackId,
        recoveryAlreadyStamped: !!(meta && meta.recoverySmsAt),
        createdAtMs: new Date(r.createdAt as unknown as string | number | Date).getTime(),
      };
      // A tool-reaching call needs proof it captured nothing (one bounded read
      // per such call; ~15/day). Every other rule runs first, so the read only
      // happens for calls that would otherwise qualify.
      if (row.convertedToLead === 1 && isMissedCallEligible({ ...row, capturedNothing: true }, now)) {
        row.capturedNothing = await proveCapturedNothing(row.vapiCallId);
      }
      if (!isMissedCallEligible(row, now)) continue;
      const np = normalizePhone(row.phoneNumber);
      if (np && optOuts.has(np)) {
        // Never texted, in either mode: the shop owns the follow-up by phone.
        if ((await requestCallbackForMissedCall(db, row, "opt_out")) === "written") {
          callbackRows++;
          optOutCallbacks++;
        }
        continue;
      }
      eligible.push(row);
    }

    const candidates = eligible.length;

    // ─── SHADOW: report the audience, send nothing, claim no text ───
    if (!live) {
      // The callers a live run would text (same RUN_CAP) go to the shop's callback queue
      // instead; past the cap nobody gets a row, the next run reaches them.
      for (const row of eligible.slice(0, RUN_CAP)) {
        if ((await requestCallbackForMissedCall(db, row, "shadow")) === "written") callbackRows++;
      }
      if (candidates > 0 || callbackRows > 0) {
        const { sendTelegram } = await import("../../services/telegram");
        const sample = eligible.slice(0, 10).map(e => `• ${maskPhone(e.phoneNumber)} (${e.durationSeconds}s call)`).join("\n");
        await sendTelegram(
          `🔇 Missed-Call Recovery — SHADOW (no texts sent)\n` +
          `${candidates} caller(s) would get a follow-up this run:\n${sample}` +
          (candidates > 10 ? `\n…+${candidates - 10} more` : "") +
          // Do NOT hardcode the copy here. The catalog rotates three variants
          // for this type, so any quoted line drifts the moment the copy
          // changes — and a shadow preview that misquotes live behaviour is
          // worse than no preview. Describe the shape, name the source.
          `\n\nThey'd receive the neutral follow-up for vapi_forwarded_call_followup ` +
          `(rotating variant, see smsMessageCatalog.ts) + STOP footer.\n` +
          `${callbackRows} callback rows written for the shop (Admin > Calls > Missed / Pending)\n` +
          `Flip live: set MISSED_CALL_RECOVERY_SEND=1 on MAINnicks-tire-auto.`, "digest",
        );
      }
      log.info("Missed-call recovery SHADOW run", { candidates, callbackRows });
      return { recordsProcessed: 0, shadow: true, candidates, callbackRows };
    }

    // ─── LIVE: claim (durable at-most-once) then send via orchestrator ───
    const { orchestrateSms } = await import("../../services/smsOrchestrator");
    const { sendPauseHoldReason } = await import("../../services/sendPause");
    let processed = 0;
    // C5.5 round 2: a pause set mid-run stops the loop before the next claim.
    let heldMidRun: string | null = null;
    let notAttempted = 0;
    const batch = eligible.slice(0, RUN_CAP);
    for (const [i, row] of batch.entries()) {
      // Re-read the pause before every claim (a fresh read: the start gate's cached answer may be stale).
      const midRunHold = await sendPauseHoldReason("missed_call_recovery", "automated", { fresh: true });
      if (midRunHold) {
        heldMidRun = midRunHold;
        notAttempted = batch.length - i;
        log.info("Missed-call recovery held mid-run", { reason: midRunHold, notAttempted });
        break;
      }
      // Claim BEFORE send: stamp metadata.recoverySmsAt only if still null.
      // A crash after the send leaves it stamped → no re-text next run.
      const claim = await db.execute(sql`
        UPDATE vapi_call_logs
        SET metadata = JSON_SET(COALESCE(metadata, JSON_OBJECT()), '$.recoverySmsAt', ${new Date().toISOString()})
        WHERE id = ${row.id}
          AND (metadata IS NULL OR JSON_EXTRACT(metadata, '$.recoverySmsAt') IS NULL)
      `);
      const affected = (claim as unknown as Array<{ affectedRows?: number }>)[0]?.affectedRows ?? 0;
      if (affected === 0) continue; // claimed by an overlapping run

      const result = await orchestrateSms({
        type: "vapi_forwarded_call_followup",
        phone: row.phoneNumber!,
        vapiCallId: row.vapiCallId,
        source: "missed_call_recovery", // durable variantKey: a queued text is held by this lane's pause
      });
      if (result.status === "sent" || result.status === "queued") processed++;
    }

    if (processed > 0 || optOutCallbacks > 0) {
      log.info("Missed-call recovery sent", { processed, candidates, optOutCallbacks });
      const { sendTelegram } = await import("../../services/telegram");
      await sendTelegram(
        `📞 Missed-Call Recovery — sent ${processed} follow-up text(s) (of ${candidates} eligible).` +
        (optOutCallbacks > 0 ? `\n${optOutCallbacks} opt-out callers routed to callbacks` : ""),
        "receipt",
      );
    }
    if (heldMidRun) {
      return { recordsProcessed: processed, shadow: false, candidates, callbackRows, details: `Skipped · ${heldMidRun} · not_attempted=${notAttempted} · sent=${processed}` };
    }
    return { recordsProcessed: processed, shadow: false, candidates, callbackRows };
  } catch (err) {
    // Re-throw (2026-10-02): this used to return { recordsProcessed: 0, shadow: true }, so a
    // broken run on a LIVE customer-texting lane was filed in cron_log as a completed shadow
    // run — the observer's failure-streak alert never saw it (cronNoSwallowedFailure.test.ts
    // explains why a return is a swallow). The scheduler records a throw as `failed`.
    log.error("Missed-call recovery failed", { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}
