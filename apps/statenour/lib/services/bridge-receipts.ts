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
 *     correctly "first". Used by /api/sync/evidence and, per event, by
 *     /api/sync/events.
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
 * The table is hand-migrated (prisma/migrations/20260929090000_bridge_receipts; applied on prod 2026-10-23).
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
  return parseIdempotencyKey(headers.get(IDEMPOTENCY_KEY_HEADER));
}

/**
 * The same rules for a key carried in a request BODY (ADR-0019 §4: a batch
 * carries `idempotencyKey` on each event). Absent (null/undefined) is no key;
 * anything else that is not a well-formed key is a 400.
 */
export function parseIdempotencyKey(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") {
    throw new ServiceError(`Idempotency-Key must be 1-${KEY_MAX} visible ASCII characters`, 400);
  }
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

/** A standing obligation's trigger: snake_case, as nickstire's `escalateToOwner` names it. */
const STANDING_TRIGGER = /^[a-z][a-z0-9_]{0,60}$/;

/** The trigger a payload marks as standing, or null (absent or malformed = an ordinary escalation). */
export function parseStandingTrigger(raw: unknown): string | null {
  return typeof raw === "string" && STANDING_TRIGGER.test(raw) ? raw : null;
}

/**
 * One OPEN result per standing obligation (job 2026-10-29). Some obligations are
 * keyed by a snapshot that keeps changing — the attribution escalation's key is
 * its SET of unruled calls — so each new snapshot is a new key, and each new
 * key used to open a task beside the one still open. The slot is one receipt
 * row per trigger whose `result_ref` is the open task:
 *
 *   · no slot -> `open()`, settle the slot to it;
 *   · slot points at an open task -> reuse it, write nothing;
 *   · slot points at a closed task -> a new episode: take the slot with a
 *     compare-and-swap on that exact `result_ref` (claim-before-act), then
 *     `open()`. A racer that swapped first wins; the loser gets a retryable 503.
 *
 * Without the receipts table the slot cannot exist, so it degrades to `open()`.
 */
export async function holdStandingSlot(
  db: Db,
  slotKey: string,
  route: string,
  open: () => Promise<string>,
  isOpen: (ref: string) => Promise<boolean>,
  opts: { staleMs: number },
): Promise<{ ref: string; reused: boolean }> {
  let claim: ReceiptClaim;
  try {
    claim = await claimReceipt(db, slotKey, route, { staleMs: opts.staleMs });
  } catch (err) {
    if (!isReceiptTableMissing(err)) throw err;
    return { ref: await open(), reused: false };
  }

  let leaseAt: Date;
  if (claim.first) {
    leaseAt = claim.leaseAt;
  } else {
    if (claim.resultRef === null) {
      throw new ServiceError("This standing obligation is being opened by another delivery; retry later.", 503);
    }
    if (await isOpen(claim.resultRef)) return { ref: claim.resultRef, reused: true };
    leaseAt = new Date();
    const swapped = await db.bridgeReceipt.updateMany({
      where: { idempotencyKey: slotKey, resultRef: claim.resultRef },
      data: { resultRef: null, lastSeenAt: leaseAt },
    });
    if (swapped.count !== 1) {
      throw new ServiceError("This standing obligation was reopened by another delivery; retry later.", 503);
    }
  }

  let ref: string;
  try {
    ref = await open();
  } catch (err) {
    await releaseReceipt(db, slotKey, leaseAt).catch((releaseErr) =>
      log.error("bridge_receipt_release_failed", { route, keyTag: keyTag(slotKey), error: String(releaseErr) }),
    );
    throw err;
  }
  // Settle only our OWN lease: if open() outlived staleMs, another delivery took
  // the slot over and is opening its own task; a plain settle would point the
  // slot at ours and drop theirs. Losing it is said loudly, never as success.
  const settled = await db.bridgeReceipt
    .updateMany({
      where: { idempotencyKey: slotKey, resultRef: null, lastSeenAt: leaseAt },
      data: { resultRef: ref.slice(0, 120) },
    })
    .then((r) => r.count === 1)
    .catch((settleErr) => {
      log.error("bridge_receipt_settle_failed", { route, keyTag: keyTag(slotKey), error: String(settleErr) });
      return false;
    });
  if (!settled) log.error("bridge_standing_slot_lost", { route, keyTag: keyTag(slotKey), ref });
  return { ref, reused: false };
}

/** The missing-table warning fires once per process, not once per delivery. */
let warnedMissingTable = false;

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
  opts: {
    staleMs: number;
    /**
     * Fallback dedupe for when the receipts table is missing: the result_ref of
     * an existing row that already answers this delivery, or null. Runs under a
     * per-key advisory lock together with `act`, so two concurrent deliveries
     * cannot both read "none" and both write (claim-before-act).
     */
    findExisting?: () => Promise<string | null>;
  },
): Promise<RunOnceResult<T>> {
  if (!key) return { duplicate: false, value: await act() };

  let claim: ReceiptClaim;
  try {
    claim = await claimReceipt(db, key, route, { staleMs: opts.staleMs });
  } catch (err) {
    if (!isReceiptTableMissing(err)) throw err;
    if (!warnedMissingTable) {
      warnedMissingTable = true;
      log.warn("bridge_receipts_not_migrated", { route });
    }
    const findExisting = opts.findExisting;
    if (!findExisting) return { duplicate: false, value: await act(), dedupe: "unavailable" };
    // The lock is held by this transaction's connection until it ends; `act`
    // commits on its own connection inside that window, so the next delivery of
    // the same key waits here, then finds the committed row. Prod 2026-10-23:
    // without a table every escalation landed twice (map F5).
    return (db as PrismaClient).$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${route}|${key}`}))`;
        const existing = await findExisting();
        if (existing) return { duplicate: true as const, resultRef: existing };
        return { duplicate: false as const, value: await act(), dedupe: "unavailable" as const };
      },
      { timeout: 20_000 },
    );
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
