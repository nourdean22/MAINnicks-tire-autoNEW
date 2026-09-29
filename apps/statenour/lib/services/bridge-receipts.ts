/**
 * Bridge receipts — the receiver half of ADR-0019 (docs/adr/0019-idempotent-bridge-writes.md).
 *
 * A nickstire -> statenour write that carries an `Idempotency-Key` header is
 * recorded here once. A replay of the same key increments `seen_count` and
 * returns the first delivery's `result_ref` instead of writing a second row.
 * A write WITHOUT the header is untouched (the legacy path), so this receiver
 * can deploy ahead of every sender (ADR §9 phase 0b).
 *
 * Two shapes, chosen by whether the business write can share a transaction:
 *
 *   · Transactional (the ADR §6.2 shape): `claimReceipt(tx, …)` inside the
 *     route's `$transaction`, then `settleReceipt(tx, …)`. A crash between the
 *     receipt and the business write rolls both back, so the next delivery is
 *     correctly "first". Used by /api/sync/evidence.
 *
 *   · Claim -> act -> settle, for a write that runs its own transaction and
 *     post-commit side effects (createTask). The receipt commits first with
 *     `result_ref` NULL (= "not settled"). On failure the caller releases it,
 *     so a retry is "first" again. If the process dies between the business
 *     write and the settle, a replay after `staleMs` takes the row over with a
 *     compare-and-swap on `last_seen_at` and writes again: at-least-once, which
 *     for an obligation beats losing it. A replay inside the lease gets
 *     `pending`, which the route answers with a retryable 503. Used by
 *     /api/sync/nour-os `open_loop`.
 *
 * The table is hand-migrated (prisma/migrations-pending/20260929090000_bridge_receipts).
 * Until it exists every receipt call throws Prisma P2021; callers catch that
 * with `isReceiptTableMissing` and fall back to the legacy write, so a keyed
 * sender can never be failed closed by an unapplied migration.
 */
import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { logger as rootLogger } from "@/lib/logger";
import { ServiceError } from "@/lib/utils/service-error";

const log = rootLogger.withSurface("services/bridge-receipts");

export const IDEMPOTENCY_KEY_HEADER = "idempotency-key";

/** ADR-0019 §4: keys longer than 190 are hashed by the sender (`v1:h:<sha256>`), so 190 is a hard cap. */
const KEY_MAX = 190;
/** Visible ASCII only: no whitespace, no control characters, no smuggled newlines. */
const KEY_SHAPE = /^[\x21-\x7e]+$/;

/**
 * The request's idempotency key, or null when the sender sent none.
 * A header that is present but malformed is a sender bug: refuse it loudly
 * (400) rather than silently writing un-deduplicated.
 */
export function readIdempotencyKey(headers: Headers): string | null {
  const raw = headers.get(IDEMPOTENCY_KEY_HEADER);
  if (raw === null) return null;
  const key = raw.trim();
  if (!key || key.length > KEY_MAX || !KEY_SHAPE.test(key)) {
    throw new ServiceError(`Idempotency-Key must be 1-${KEY_MAX} visible ASCII characters`, 400);
  }
  return key;
}

/**
 * What the logs carry instead of the key. Keys are PII-free by contract
 * (ADR-0019 §4), but the receiver cannot prove a sender honoured it, so the raw
 * key never reaches a log line.
 */
function keyTag(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 12);
}

/** Prisma's "table (P2021) or column (P2022) does not exist" — the migration has not been applied. */
export function isReceiptTableMissing(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === "P2021" || code === "P2022";
}

type Db = Prisma.TransactionClient | PrismaClient;

export type ReceiptClaim =
  /**
   * This caller owns the key: do the business write, then settle. `takeover` =
   * a stale unsettled row was reclaimed. `leaseAt` is the `last_seen_at` this
   * claim wrote; `releaseReceipt` needs it so it can only give back its OWN lease.
   */
  | { first: true; takeover: boolean; leaseAt: Date }
  /** A replay. `resultRef` null means the first delivery has not settled yet. */
  | { first: false; resultRef: string | null; seenCount: number };

/**
 * Claim `key` for `route`.
 *
 * `staleMs` is only for the claim -> act -> settle shape: an unsettled row
 * whose `last_seen_at` is older than it is taken over. The takeover and the
 * replay count are conditional `updateMany`s on the exact row state read by
 * the WHERE clause, so two concurrent replays cannot both take a row over.
 * Replays of an unsettled row do NOT bump `last_seen_at`, or retries would
 * keep a dead owner's lease alive forever.
 */
export async function claimReceipt(
  db: Db,
  key: string,
  route: string,
  opts: { staleMs?: number; now?: Date } = {},
): Promise<ReceiptClaim> {
  const now = opts.now ?? new Date();
  // Postgres ON CONFLICT DO NOTHING. A concurrent first delivery that has not
  // committed makes this wait on the primary key, then insert nothing.
  const inserted = await db.bridgeReceipt.createMany({
    data: [{ idempotencyKey: key, route, firstSeenAt: now, lastSeenAt: now }],
    skipDuplicates: true,
  });
  if (inserted.count === 1) return { first: true, takeover: false, leaseAt: now };

  if (opts.staleMs !== undefined) {
    const takeover = await db.bridgeReceipt.updateMany({
      where: { idempotencyKey: key, resultRef: null, lastSeenAt: { lt: new Date(now.getTime() - opts.staleMs) } },
      data: { lastSeenAt: now, seenCount: { increment: 1 } },
    });
    if (takeover.count === 1) {
      log.warn("bridge_receipt_takeover", { route, keyTag: keyTag(key) });
      return { first: true, takeover: true, leaseAt: now };
    }
  }

  await db.bridgeReceipt.updateMany({
    where: { idempotencyKey: key, resultRef: { not: null } },
    data: { lastSeenAt: now, seenCount: { increment: 1 } },
  });
  const row = await db.bridgeReceipt.findUnique({
    where: { idempotencyKey: key },
    select: { resultRef: true, seenCount: true },
  });
  // Released between our insert attempt and this read (the first delivery
  // failed and gave the key back). Report it as unsettled; the retry wins it.
  if (!row) return { first: false, resultRef: null, seenCount: 0 };
  return { first: false, resultRef: row.resultRef, seenCount: row.seenCount };
}

/** Record what the first delivery wrote. Only an unsettled row is written, so a settle can never overwrite another. */
export async function settleReceipt(db: Db, key: string, resultRef: string): Promise<boolean> {
  const r = await db.bridgeReceipt.updateMany({
    where: { idempotencyKey: key, resultRef: null },
    data: { resultRef: resultRef.slice(0, 120) },
  });
  return r.count === 1;
}

/**
 * Give an unsettled key back after the business write failed, so the sender's
 * retry is "first". Conditioned on this claim's own lease, so a slow first
 * delivery that fails AFTER a takeover cannot delete the new owner's row.
 */
export async function releaseReceipt(db: Db, key: string, leaseAt: Date): Promise<void> {
  await db.bridgeReceipt.deleteMany({ where: { idempotencyKey: key, resultRef: null, lastSeenAt: leaseAt } });
}

export type RunOnceResult<T> =
  | { duplicate: false; value: T; dedupe?: "unavailable" }
  | { duplicate: true; resultRef: string };

/**
 * The claim -> act -> settle shape in one call, for a business write that owns
 * its own transaction. With no key, `act` runs exactly as it did before this
 * file existed. `refOf` names the row `act` wrote, for `result_ref`.
 *
 * A replay of an unsettled key inside the lease throws a 503: the sender's
 * outbox treats 5xx as transient and retries (ADR-0019 §5.5), and by then the
 * first delivery has settled — or gone stale, and the retry takes over.
 */
export async function runOnceByKey<T>(
  db: Db,
  key: string | null,
  route: string,
  act: () => Promise<T>,
  refOf: (value: T) => string,
  opts: { staleMs: number },
): Promise<RunOnceResult<T>> {
  if (!key) return { duplicate: false, value: await act() };

  let claim: ReceiptClaim;
  try {
    claim = await claimReceipt(db, key, route, { staleMs: opts.staleMs });
  } catch (err) {
    if (!isReceiptTableMissing(err)) throw err;
    log.warn("bridge_receipts_not_migrated", { route });
    return { duplicate: false, value: await act(), dedupe: "unavailable" };
  }

  if (!claim.first) {
    if (claim.resultRef === null) {
      throw new ServiceError("An earlier delivery of this Idempotency-Key is still settling; retry later.", 503);
    }
    return { duplicate: true, resultRef: claim.resultRef };
  }

  let value: T;
  try {
    value = await act();
  } catch (err) {
    await releaseReceipt(db, key, claim.leaseAt).catch((releaseErr) =>
      log.error("bridge_receipt_release_failed", { route, keyTag: keyTag(key), error: String(releaseErr) }),
    );
    throw err;
  }
  // The write landed. A failed settle leaves the row unsettled, so a replay
  // after the lease writes again (at-least-once) — say so loudly.
  await settleReceipt(db, key, refOf(value)).catch((settleErr) =>
    log.error("bridge_receipt_settle_failed", { route, keyTag: keyTag(key), error: String(settleErr) }),
  );
  return { duplicate: false, value };
}
