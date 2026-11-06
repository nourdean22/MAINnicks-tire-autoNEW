/**
 * Once-per-state alert claim.
 *
 * A repeating cron that re-sends the same message while nothing changed claims a
 * `cron_alerts_fired` row BEFORE it sends. The key names the STATE, `fired_for` is the
 * Cleveland shop day, so the alert fires once per day per state and again when the state
 * changes. INSERT IGNORE is the compare-and-swap: of N racing ticks exactly one inserts
 * (affectedRows 1) and may send. Same table and shape as the camera-health and VAPI
 * claims (drizzle/0044); no schema change.
 *
 * Fail OPEN: if the claim cannot be written (db down), the caller sends. A noisy alert
 * during a database outage beats silence about the thing the alert is for.
 */
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { createLogger } from "../lib/logger";
import { getBusinessDateKey } from "../lib/timezoneAssert";
import type { TelegramSendResult } from "./telegram";

const log = createLogger("alert-claim");

/**
 * The escalate marker (2026-11-06): escalate writes no callback row, so this row is what keeps
 * an escalated call out of the missed-call lanes. One builder for writer and readers, cut to
 * the column's 100 chars exactly as the INSERT stores it.
 */
export const ESCALATED_MARKER_PREFIX = "voice-escalated:";
export function escalatedMarkerKey(callId: string): string {
  return `${ESCALATED_MARKER_PREFIX}${callId}`.slice(0, 100);
}

/** SQL: this call has NO escalate marker. For a missed-call candidate query, on every row. */
export function notEscalatedSql(callIdColumn: unknown) {
  return sql`NOT EXISTS (SELECT 1 FROM cron_alerts_fired WHERE alert_key = LEFT(CONCAT(${ESCALATED_MARKER_PREFIX}, ${callIdColumn}), 100))`;
}

/**
 * Writes a marker row and reports whether it is there. FAIL CLOSED, unlike claimAlertOnce:
 * false on a missing database or a failed write, so the caller can say so instead of
 * assuming the marker exists. An existing row (INSERT IGNORE, 0 rows) counts as written.
 */
export async function writeMarkerStrict(alertKey: string, now: Date = new Date()): Promise<boolean> {
  try {
    const { getDb } = await import("../db");
    const db = await getDb();
    if (!db) {
      log.error("marker NOT written: database unavailable", { alertKey });
      return false;
    }
    await db.execute(sql`
      INSERT IGNORE INTO cron_alerts_fired (alert_key, fired_for, fired_at)
      VALUES (${alertKey.slice(0, 100)}, ${getBusinessDateKey(now)}, NOW())
    `);
    return true;
  } catch (err) {
    log.error("marker NOT written", { alertKey, error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

/** A short, stable id for a set of strings (a state fingerprint), order-independent. */
export function stateFingerprint(parts: string[]): string {
  return createHash("sha1").update([...parts].sort().join("\n")).digest("hex").slice(0, 12);
}

/**
 * True when this caller won the claim for (alertKey, today in ET) and should send.
 * `now` is injectable for the day-boundary tests.
 */
export async function claimAlertOnce(alertKey: string, now: Date = new Date(), firedFor: string = getBusinessDateKey(now)): Promise<boolean> {
  try {
    const { getDb } = await import("../db");
    const db = await getDb();
    if (!db) return true;
    const [result] = await db.execute(sql`
      INSERT IGNORE INTO cron_alerts_fired (alert_key, fired_for, fired_at)
      VALUES (${alertKey.slice(0, 100)}, ${firedFor}, NOW())
    `);
    return ((result as { affectedRows?: number })?.affectedRows ?? 0) === 1;
  } catch (err) {
    log.warn("alert claim failed; sending anyway", { alertKey, error: err instanceof Error ? err.message : String(err) });
    return true;
  }
}

/** Hands a claim back (the day's slot for this state) so a later tick may try again. */
export async function releaseAlertClaim(alertKey: string, now: Date = new Date(), firedFor: string = getBusinessDateKey(now)): Promise<void> {
  try {
    const { getDb } = await import("../db");
    const db = await getDb();
    if (!db) return;
    await db.execute(sql`
      DELETE FROM cron_alerts_fired WHERE alert_key = ${alertKey.slice(0, 100)} AND fired_for = ${firedFor}
    `);
  } catch (err) {
    log.warn("alert claim release failed; the state stays claimed for today", { alertKey, error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Claim the state, send, and give the claim back if the transport FAILED (unconfigured, rate-limited, HTTP
 * error, or a throw): a failed delivery must not use up the day's one alert. A send HELD by a class mute keeps
 * the claim (muted means do not retry today). Returns null when another tick already holds the claim.
 */
export async function sendOncePerState(
  alertKey: string,
  send: () => Promise<TelegramSendResult>,
  now: Date = new Date(),
): Promise<TelegramSendResult | null> {
  if (!(await claimAlertOnce(alertKey, now))) return null;
  let result: TelegramSendResult;
  try {
    result = await send();
  } catch (err) {
    await releaseAlertClaim(alertKey, now);
    throw err;
  }
  if (result.status === "failed") await releaseAlertClaim(alertKey, now);
  return result;
}

/** fired_for is a DATE column; this fixed value makes a claim that no later day can repeat. The 90-day cleanup skips it. */
export const EVER_FIRED_FOR = "1970-01-01";

/**
 * sendOncePerState without the day: once per STATE for good. For a daily job whose state
 * persists for days (an unanswered urgent review), where a per-day claim re-sends the same
 * state every morning. Same give-back on a failed send, so a failed delivery retries.
 */
export async function sendOncePerStateEver(
  alertKey: string,
  send: () => Promise<TelegramSendResult>,
): Promise<TelegramSendResult | null> {
  if (!(await claimAlertOnce(alertKey, new Date(), EVER_FIRED_FOR))) return null;
  let result: TelegramSendResult;
  try {
    result = await send();
  } catch (err) {
    await releaseAlertClaim(alertKey, new Date(), EVER_FIRED_FOR);
    throw err;
  }
  if (result.status === "failed") await releaseAlertClaim(alertKey, new Date(), EVER_FIRED_FOR);
  return result;
}
