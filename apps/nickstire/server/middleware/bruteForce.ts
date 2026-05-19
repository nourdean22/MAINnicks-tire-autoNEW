/**
 * Brute Force Protection — Durable, multi-instance OTP throttling.
 *
 * Wave-181.59: counters moved from an in-memory Map to the `otp_attempts`
 * table (drizzle/0040_wave181_otp_attempts_durable.sql). The map worked
 * for a single long-running process but had two prod-realistic holes:
 *
 *   1. Process restart wiped the map — an attacker kept brute-forcing
 *      after every Railway redeploy because the counter reset.
 *   2. Railway runs N>1 instances — attempts split across pods, so the
 *      effective rate-limit was N× the intended 5.
 *
 * The implementation uses MySQL's atomic INSERT ... ON DUPLICATE KEY
 * UPDATE (same pattern as cron_locks in server/cron/index.ts) — one
 * row per phone, race-safe across concurrent verifies from any pod.
 *
 * Threshold + window unchanged from the prior in-memory version:
 *   - 5 failed attempts within a 15-min rolling window → block 1 hour.
 *
 * Fail-open policy: if the DB is unreachable, checks allow the attempt
 * and recordings are dropped silently (with a warn log). A locked-down
 * DB is already an emergency; locking real customers out on top of it
 * helps nobody. The 5-in-15min window is short enough that a transient
 * DB outage is not a meaningful brute-force window.
 */
import { sql } from "drizzle-orm";
import { db } from "../lib/db-helper";
import { createLogger } from "../lib/logger";

const log = createLogger("middleware:bruteForce");

const MAX_ATTEMPTS = 5;
const WINDOW_MINUTES = 15;
const BLOCK_HOURS = 1;

function normalize(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10);
}

/**
 * Check whether `phone` is currently allowed to attempt an OTP verify.
 * Returns `{ allowed: false, retryAfter }` (seconds until unblock) when
 * the phone is in an active lockout window.
 *
 * Fail-open on DB error — see file header.
 */
export async function checkBruteForce(
  phone: string,
): Promise<{ allowed: boolean; retryAfter?: number }> {
  const key = normalize(phone);
  try {
    const d = await db();
    if (!d) return { allowed: true };

    const [rows] = await d.execute(sql`
      SELECT blocked_until FROM otp_attempts WHERE phone = ${key} LIMIT 1
    `);
    const arr = rows as Array<{ blocked_until: Date | string | null }>;
    if (arr.length === 0) return { allowed: true };

    const blockedUntilRaw = arr[0].blocked_until;
    if (!blockedUntilRaw) return { allowed: true };

    const blockedUntilMs = new Date(blockedUntilRaw).getTime();
    const nowMs = Date.now();
    if (blockedUntilMs > nowMs) {
      return { allowed: false, retryAfter: Math.ceil((blockedUntilMs - nowMs) / 1000) };
    }
    return { allowed: true };
  } catch (err) {
    log.warn("checkBruteForce failed; allowing attempt (fail-open)", {
      errorId: "BRUTE_FORCE_CHECK_QUERY_ERROR",
      error: err instanceof Error ? err.message : String(err),
    });
    return { allowed: true };
  }
}

/**
 * Record a failed verify attempt.
 *
 * Single-statement atomic upsert. The IF() guards roll the window
 * forward when the existing window is still live (++count) and reset
 * it when stale (count=1, window=now). If the resulting count crosses
 * MAX_ATTEMPTS, blocked_until is set to (now + BLOCK_HOURS) so
 * checkBruteForce() will deny subsequent attempts.
 *
 * NOTE: the second IF() re-derives the post-update count inline because
 * MySQL does not let ON DUPLICATE KEY UPDATE expressions reference each
 * other's NEW values. Slightly verbose, but correct and atomic.
 */
export async function recordFailedAttempt(phone: string): Promise<void> {
  const key = normalize(phone);
  try {
    const d = await db();
    if (!d) return;

    await d.execute(sql`
      INSERT INTO otp_attempts (phone, attempt_count, window_started_at, updated_at)
      VALUES (${key}, 1, NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        attempt_count = IF(
          window_started_at < (NOW() - INTERVAL ${sql.raw(String(WINDOW_MINUTES))} MINUTE),
          1,
          attempt_count + 1
        ),
        window_started_at = IF(
          window_started_at < (NOW() - INTERVAL ${sql.raw(String(WINDOW_MINUTES))} MINUTE),
          NOW(),
          window_started_at
        ),
        blocked_until = IF(
          IF(
            window_started_at < (NOW() - INTERVAL ${sql.raw(String(WINDOW_MINUTES))} MINUTE),
            1,
            attempt_count + 1
          ) >= ${sql.raw(String(MAX_ATTEMPTS))},
          (NOW() + INTERVAL ${sql.raw(String(BLOCK_HOURS))} HOUR),
          blocked_until
        ),
        updated_at = NOW()
    `);
  } catch (err) {
    log.warn("recordFailedAttempt failed (counter not incremented)", {
      errorId: "BRUTE_FORCE_RECORD_QUERY_ERROR",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Clear the counter after a successful verify. Safe no-op if absent.
 */
export async function clearAttempts(phone: string): Promise<void> {
  const key = normalize(phone);
  try {
    const d = await db();
    if (!d) return;
    await d.execute(sql`DELETE FROM otp_attempts WHERE phone = ${key}`);
  } catch (err) {
    log.warn("clearAttempts failed", {
      errorId: "BRUTE_FORCE_CLEAR_QUERY_ERROR",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
