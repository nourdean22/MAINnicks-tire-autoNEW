/**
 * SMS control plane — the gates that were missing from the send chokepoint.
 *
 * WHY THIS FILE EXISTS (2026-07-29 SMS Revenue Agent OS wave)
 * The audit found that `SMS_KILL_SWITCH` gates only the dead Twilio fallback:
 * with the F25e shop gateway as the sole production sender, there was NO way to
 * stop production customer SMS without a redeploy or per-automation flag flips.
 * There was also no shop-wide daily volume cap (only the per-phone cap of 8),
 * and the human-takeover check lived only in the orchestrator's inbound branch
 * while ~20 crons/services call sendSms directly.
 *
 * This module supplies those three gates to sendSms. It deliberately does NOT
 * import ./sms (no cycle) — sms.ts dynamic-imports this file.
 *
 * SEMANTICS
 * - Pause is HOLD, not drop: sendSms queues customer sends durably while the
 *   pause flag is on; lifting the pause drains them through the normal window
 *   machinery. Nothing is lost by pausing.
 * - Unreadable pause state fails CLOSED for `customer_marketing` (an unattended
 *   campaign must not treat "could not check the switch" as "send") and OPEN
 *   for `customer_followup` (a 1:1 reply to a customer's own text must not go
 *   silent on a DB blip — same trade humanTakeover.ts documents).
 * - The global cap fails OPEN (precedent: checkDailyLimit) but logs loudly and
 *   reports `readable:false` so the ops surface shows the blind spot.
 */
import { createLogger } from "../lib/logger";

const log = createLogger("sms-control");

/** Pause-polarity flag key (inverted like vapi_forward_followup_paused):
 *  TRUE = STOP automated customer SMS. FALSE/missing = normal operation. */
export const SMS_GLOBAL_PAUSE_FLAG = "sms_global_pause" as const;

/** Shop-wide rolling-24h outbound ceiling across ALL doors. Every send path
 *  persists an outbound sms_messages row (persistOutboundShopSms /
 *  logOutboundSms / queueForLater), so the DB count is the honest
 *  count-every-door analog of the #1129 content governor. */
export function getGlobalDailyCap(): number {
  const raw = Number(process.env.SMS_GLOBAL_DAILY_CAP);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 200;
}

export interface PauseState {
  paused: boolean;
  /** false = we could not read the switch; caller decides fail-open/closed by class */
  readable: boolean;
  reason?: string;
}

// Short fresh-read cache (autonomyControl.getEmergencyControlsFresh precedent):
// an emergency stop must take effect in seconds, not the 60s flag-cache TTL.
const PAUSE_CACHE_MS = 5_000;
let _pauseCache: { state: PauseState; expiresAt: number } | null = null;

export async function getSmsPauseState(): Promise<PauseState> {
  const now = Date.now();
  if (_pauseCache && _pauseCache.expiresAt > now) return _pauseCache.state;
  let state: PauseState;
  try {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) {
      state = { paused: false, readable: false, reason: "db unavailable" };
    } else {
      // Raw execute (not the select builder): `key` is a reserved word, and
      // execute is the one surface every db mock in the serial suite provides
      // — a builder-chain read would misreport mocked DBs as "unreadable".
      const [rows] = await db.execute(sql`
        SELECT \`value\` AS v FROM feature_flags WHERE \`key\` = ${SMS_GLOBAL_PAUSE_FLAG} LIMIT 1
      `);
      const first = Array.isArray(rows) ? (rows[0] as { v?: unknown } | undefined) : undefined;
      // Missing row = never armed = not paused (readable — we got an answer).
      state = { paused: first != null && (first.v === 1 || first.v === true || first.v === "1"), readable: true };
    }
  } catch (err) {
    state = {
      paused: false,
      readable: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
  _pauseCache = { state, expiresAt: now + PAUSE_CACHE_MS };
  return state;
}

/** Test hook — the 5s cache would otherwise leak state across serial test files. */
export function _resetPauseCacheForTest(): void {
  _pauseCache = null;
}

export interface GlobalCapResult {
  allowed: boolean;
  count: number;
  cap: number;
  readable: boolean;
}

/**
 * Rolling-24h count of OUTBOUND sms_messages rows vs the shop-wide cap.
 * Counts every door by construction (see cap comment above). Includes
 * queued/sending rows so a paused backlog can't be used to smuggle a burst
 * past the cap when the pause lifts.
 */
export async function checkGlobalDailyCap(): Promise<GlobalCapResult> {
  const cap = getGlobalDailyCap();
  try {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return { allowed: true, count: 0, cap, readable: false };
    const [rows] = await db.execute(sql`
      SELECT COUNT(*) AS n FROM sms_messages
      WHERE direction = 'outbound'
        AND status IN ('queued', 'sending', 'sent', 'delivered')
        AND createdAt >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
    `);
    const first = Array.isArray(rows) ? (rows[0] as { n?: number | string }) : undefined;
    const count = Number(first?.n ?? 0);
    if (count >= cap) {
      log.error("GLOBAL SMS DAILY CAP REACHED — refusing automated send", { count, cap });
      return { allowed: false, count, cap, readable: true };
    }
    return { allowed: true, count, cap, readable: true };
  } catch (err) {
    log.warn("global daily cap unreadable — allowing send (fail-open, visible on ops surface)", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { allowed: true, count: 0, cap, readable: false };
  }
}

/**
 * Phone-level human-takeover lookup for the sendSms chokepoint. The
 * orchestrator's check keys on conversationId and only covers inbound events;
 * direct callers (crons, routers) know only the phone. Fail-open, same policy
 * and rationale as humanTakeover.ts.
 */
export async function isPhoneHumanHeld(phone: string): Promise<boolean> {
  try {
    const last10 = phone.replace(/\D/g, "").slice(-10);
    if (!last10) return false;
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return false;
    // One round-trip: conversation-by-phone joined to the takeover audit
    // signal (same signal isConversationHumanHeld reads). Raw execute for the
    // same mock-surface reason as getSmsPauseState above.
    const { TAKEOVER_WINDOW_MINUTES } = await import("./humanTakeover");
    const cutoff = new Date(Date.now() - TAKEOVER_WINDOW_MINUTES * 60_000);
    const [rows] = await db.execute(sql`
      SELECT 1 AS held
      FROM sms_conversations c
      JOIN audit_log a
        ON a.entity_type = 'sms_conversation'
       AND a.entity_id = CAST(c.id AS CHAR)
       AND a.action = 'customer.sms_manual_send'
       AND a.created_at >= ${cutoff}
      WHERE c.phone = ${last10}
      LIMIT 1
    `);
    return Array.isArray(rows) && rows.length > 0 && (rows[0] as { held?: unknown }).held != null;
  } catch (err) {
    log.warn("phone human-held check failed; treating as not-held (fail-open)", {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
