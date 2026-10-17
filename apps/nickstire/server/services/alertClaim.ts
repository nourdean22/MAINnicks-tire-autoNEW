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

/** A short, stable id for a set of strings (a state fingerprint), order-independent. */
export function stateFingerprint(parts: string[]): string {
  return createHash("sha1").update([...parts].sort().join("\n")).digest("hex").slice(0, 12);
}

/**
 * True when this caller won the claim for (alertKey, today in ET) and should send.
 * `now` is injectable for the day-boundary tests.
 */
async function claimAlertOnce(alertKey: string, now: Date = new Date()): Promise<boolean> {
  try {
    const { getDb } = await import("../db");
    const db = await getDb();
    if (!db) return true;
    const [result] = await db.execute(sql`
      INSERT IGNORE INTO cron_alerts_fired (alert_key, fired_for, fired_at)
      VALUES (${alertKey.slice(0, 100)}, ${getBusinessDateKey(now)}, NOW())
    `);
    return ((result as { affectedRows?: number })?.affectedRows ?? 0) === 1;
  } catch (err) {
    log.warn("alert claim failed; sending anyway", { alertKey, error: err instanceof Error ? err.message : String(err) });
    return true;
  }
}

/** Hands a claim back (the day's slot for this state) so a later tick may try again. */
async function releaseAlertClaim(alertKey: string, now: Date = new Date()): Promise<void> {
  try {
    const { getDb } = await import("../db");
    const db = await getDb();
    if (!db) return;
    await db.execute(sql`
      DELETE FROM cron_alerts_fired WHERE alert_key = ${alertKey.slice(0, 100)} AND fired_for = ${getBusinessDateKey(now)}
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
