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
 *     unconverted, opt-outs excluded, hard daily/run cap.
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
}

/**
 * Pure eligibility predicate — the single source of truth for "should this
 * missed call get a recovery text now". Extracted so the rule is
 * unit-tested rather than buried in the query.
 */
export function isMissedCallEligible(row: MissedCallRow, nowMs: number): boolean {
  if (!row.phoneNumber) return false;
  if (row.convertedToLead === 1) return false; // already became a lead
  if (row.leadId != null || row.callbackId != null) return false; // already captured
  if (row.recoveryAlreadyStamped) return false; // one-shot
  if (row.durationSeconds < MIN_DURATION_SECONDS) return false; // not a real conversation
  const age = nowMs - row.createdAtMs;
  return age >= WINDOW_MIN_AGE_MS && age <= WINDOW_MAX_AGE_MS;
}

function maskPhone(p: string | null): string {
  if (!p) return "??";
  const d = p.replace(/\D/g, "");
  return d.length >= 4 ? `***${d.slice(-4)}` : "***";
}

export async function processMissedCallRecovery(): Promise<{ recordsProcessed: number; shadow: boolean; candidates: number }> {
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
        eq(vapiCallLogs.convertedToLead, 0),
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
      if (!isMissedCallEligible(row, now)) continue;
      const np = normalizePhone(row.phoneNumber);
      if (np && optOuts.has(np)) continue;
      eligible.push(row);
    }

    const candidates = eligible.length;

    // ─── SHADOW: report the audience, send nothing, claim nothing ───
    if (!live) {
      if (candidates > 0) {
        const { sendTelegram } = await import("../../services/telegram");
        const sample = eligible.slice(0, 10).map(e => `• ${maskPhone(e.phoneNumber)} (${e.durationSeconds}s call)`).join("\n");
        await sendTelegram(
          `🔇 Missed-Call Recovery — SHADOW (no texts sent)\n` +
          `${candidates} caller(s) would get a follow-up this run:\n${sample}` +
          (candidates > 10 ? `\n…+${candidates - 10} more` : "") +
          `\n\nMessage they'd receive: "Sorry we missed your call. Text us what's going on with the car…" (+STOP footer)\n` +
          `Flip live: set MISSED_CALL_RECOVERY_SEND=1 on MAINnicks-tire-auto.`,
        );
      }
      log.info("Missed-call recovery SHADOW run", { candidates });
      return { recordsProcessed: 0, shadow: true, candidates };
    }

    // ─── LIVE: claim (durable at-most-once) then send via orchestrator ───
    const { orchestrateSms } = await import("../../services/smsOrchestrator");
    let processed = 0;
    for (const row of eligible.slice(0, RUN_CAP)) {
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
      });
      if (result.status === "sent" || result.status === "queued") processed++;
    }

    if (processed > 0) {
      log.info("Missed-call recovery sent", { processed, candidates });
      const { sendTelegram } = await import("../../services/telegram");
      await sendTelegram(`📞 Missed-Call Recovery — sent ${processed} follow-up text(s) (of ${candidates} eligible).`);
    }
    return { recordsProcessed: processed, shadow: false, candidates };
  } catch (err) {
    log.error("Missed-call recovery failed", { error: err instanceof Error ? err.message : String(err) });
    return { recordsProcessed: 0, shadow: true, candidates: 0 };
  }
}
