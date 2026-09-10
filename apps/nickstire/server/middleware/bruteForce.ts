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
 * rather than locking real customers out. A locked-down DB is already an
 * emergency; locking real customers out on top of it helps nobody.
 *
 * 2026-09-10 — THAT POLICY IS KEPT, BUT IT WAS UNBOUNDED AND SILENT.
 *
 * The rationale above turns on the word "transient": a 5-in-15min window is
 * indeed no brute-force opportunity across a blip. It stops being true the
 * moment an outage is sustained, and nothing here distinguished the two —
 * `if (!d) return { allowed: true }` had NO log at all (unlike the catch
 * branch), and recordFailedAttempt's dead-handle path returned just as
 * quietly. So during an outage this endpoint accepted unlimited OTP guesses
 * and said nothing, which is the shape this repo calls a fabricated read:
 * "the check passed" and "the check could not run" were the same answer.
 *
 * Found by widening scripts/lib/fabricatedAdminReadScan.mjs past server/db.ts
 * (#2300) — this pair is the highest-severity thing that widening surfaced.
 *
 * Now: the same decision, made honestly. A dead handle falls back to an
 * in-process counter enforcing the identical 5-in-15min → 1-hour rule, and
 * every fall-back is logged. Degraded on purpose — per-pod, and cleared by a
 * restart, which is exactly the two holes the durable table was built to close
 * (see above) — but degraded is not the same as absent. An attacker gets N×5
 * attempts across N pods instead of infinity, and an operator gets a log line
 * instead of silence. The DB stays authoritative whenever it answers.
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

// ─── Degraded-mode counter ────────────────────────────────────────────────
// Used ONLY when the durable table cannot be reached. Same thresholds, so an
// outage changes the counter's DURABILITY, never the policy the caller sees.
type FallbackEntry = { count: number; windowStartedAt: number; blockedUntil: number };
const fallback = new Map<string, FallbackEntry>();

// Bound the map so a flood of distinct numbers during an outage cannot grow it
// without limit — the reason the original in-memory implementation was
// replaced was durability, not memory, but an unbounded Map on a public
// endpoint is its own defect and this file should not reintroduce one.
const FALLBACK_MAX_KEYS = 5000;

function pruneFallback(now: number): void {
  if (fallback.size < FALLBACK_MAX_KEYS) return;
  const windowMs = WINDOW_MINUTES * 60_000;
  for (const [k, e] of fallback) {
    if (e.blockedUntil <= now && now - e.windowStartedAt > windowMs) fallback.delete(k);
  }
  // Still full of live entries? Drop the oldest insertions (Map preserves
  // insertion order) rather than refusing to track anything new.
  while (fallback.size >= FALLBACK_MAX_KEYS) {
    const oldest = fallback.keys().next();
    if (oldest.done) break;
    fallback.delete(oldest.value);
  }
}

function fallbackCheck(key: string): { allowed: boolean; retryAfter?: number } {
  const entry = fallback.get(key);
  if (!entry) return { allowed: true };
  const now = Date.now();
  if (entry.blockedUntil > now) {
    return { allowed: false, retryAfter: Math.ceil((entry.blockedUntil - now) / 1000) };
  }
  return { allowed: true };
}

function fallbackRecord(key: string): void {
  const now = Date.now();
  pruneFallback(now);
  const entry = fallback.get(key);
  if (!entry || now - entry.windowStartedAt > WINDOW_MINUTES * 60_000) {
    fallback.set(key, { count: 1, windowStartedAt: now, blockedUntil: 0 });
    return;
  }
  entry.count += 1;
  if (entry.count >= MAX_ATTEMPTS) entry.blockedUntil = now + BLOCK_HOURS * 3_600_000;
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
    if (!d) {
      log.warn("checkBruteForce: no database handle — using the in-process counter", {
        errorId: "BRUTE_FORCE_CHECK_DEGRADED",
      });
      return fallbackCheck(key);
    }

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
    log.warn("checkBruteForce query failed — using the in-process counter", {
      errorId: "BRUTE_FORCE_CHECK_QUERY_ERROR",
      error: err instanceof Error ? err.message : String(err),
    });
    return fallbackCheck(key);
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
    if (!d) {
      log.warn("recordFailedAttempt: no database handle — counting in process", {
        errorId: "BRUTE_FORCE_RECORD_DEGRADED",
      });
      fallbackRecord(key);
      return;
    }

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
    log.warn("recordFailedAttempt query failed — counting in process", {
      errorId: "BRUTE_FORCE_RECORD_QUERY_ERROR",
      error: err instanceof Error ? err.message : String(err),
    });
    fallbackRecord(key);
  }
}

/**
 * Clear the counter after a successful verify. Safe no-op if absent.
 */
export async function clearAttempts(phone: string): Promise<void> {
  const key = normalize(phone);
  // ALWAYS clear the degraded counter, before and regardless of the DB call.
  // A successful verify has to clear both stores or the fallback introduces a
  // lockout the durable path would never have produced: verify succeeds during
  // an outage, the in-process count survives it, and the customer is refused
  // later for attempts they already passed. The fallback exists to bound an
  // attacker, never to outlive a legitimate success.
  fallback.delete(key);
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
