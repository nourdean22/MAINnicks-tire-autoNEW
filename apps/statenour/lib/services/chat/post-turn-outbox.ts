/**
 * lib/services/chat/post-turn-outbox.ts — durable outbox for the
 * post-turn chat pipeline (2026-07-25 · audit P1 "replace
 * fire-and-forget with a durable outbox").
 *
 * Semantics: INLINE-FIRST, DURABILITY ADDED. Every turn enqueues its
 * frozen DeferredBackgroundCtx here BEFORE running the deferred work
 * inline exactly as before; on inline success the row is marked done.
 * A crash mid-work strands the row at status=pending — the nightly
 * drain (/api/cron/outbox-drain) claims orphans past the grace window
 * with an ATOMIC updateMany (first claimant wins; the closed-loop
 * Experiment arc's claim pattern) and re-runs them.
 *
 * runDeferredBackgroundWork's phases are individually withErrorCapture-
 * bounded and idempotent-or-harmless on replay (upserts, dedup guards,
 * fire-and-forget audits), so a rare double-run after a crash is safe;
 * a LOST run (the pre-outbox failure mode) was not.
 */

import { prisma } from "@/lib/prisma";
import type { DeferredBackgroundCtx } from "./deferred-background-work";
import { logError } from "@/lib/utils/error-log";

/** Cap messages so a long conversation can't write a megabyte row. */
const MAX_PAYLOAD_MESSAGES = 20;
/** Orphan grace: inline work normally finishes in seconds; only rows
 *  still pending after this window are considered crashed. */
export const OUTBOX_ORPHAN_GRACE_MS = 10 * 60 * 1000;
export const OUTBOX_MAX_ATTEMPTS = 3;

export type SerializableDeferredCtx = Omit<DeferredBackgroundCtx, "log">;

export function toOutboxPayload(ctx: SerializableDeferredCtx): SerializableDeferredCtx {
  return {
    ...ctx,
    messages: (ctx.messages ?? []).slice(-MAX_PAYLOAD_MESSAGES),
  };
}

/** Best-effort enqueue — never blocks or fails the turn. Returns the
 *  row id, or null when the write failed (turn proceeds as before). */
export async function enqueuePostTurnWork(
  ctx: SerializableDeferredCtx,
): Promise<string | null> {
  try {
    const row = await prisma.postTurnOutbox.create({
      data: { payload: toOutboxPayload(ctx) as object },
      select: { id: true },
    });
    return row.id;
  } catch (e) {
    // Spine-1: a failed enqueue means THIS TURN has no crash net — the
    // turn still proceeds (contract unchanged), but the missing net must
    // be visible, not a silent null.
    logError("chat.post-turn-outbox", e, { stage: "enqueue" }, "warn");
    return null;
  }
}

/** Mark the inline run complete. Best-effort. */
export async function completePostTurnWork(id: string | null): Promise<void> {
  if (!id) return;
  await prisma.postTurnOutbox
    .update({ where: { id }, data: { status: "done" } })
    .catch((e: unknown) => {
      // A lost completion mark makes the sweeper re-run this post-turn work.
      if ((e as { code?: string })?.code !== "P2025") {
        logError("chat.post-turn-outbox", e, { stage: "complete-mark", outboxId: id }, "warn");
      }
      return undefined;
    });
}

/**
 * Atomically claim up to `limit` orphaned rows (pending past the grace
 * window, attempts under the cap). updateMany-then-read: the status
 * flip is the lock — a concurrent drain that loses the race matches
 * zero rows.
 */
/** A `processing` row untouched this long is a crashed worker's orphan —
 *  the claim flip bumps updatedAt (@updatedAt), so staleness here is
 *  restart-proof without new lease columns (spine-1: pre-fix these rows
 *  were stranded FOREVER — claims only ever looked at `pending`). */
const OUTBOX_PROCESSING_STALE_MS = 30 * 60 * 1000;

export async function claimOrphans(limit = 25): Promise<
  Array<{ id: string; payload: SerializableDeferredCtx; attempts: number }>
> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - OUTBOX_ORPHAN_GRACE_MS);
  const staleProcessing = new Date(now.getTime() - OUTBOX_PROCESSING_STALE_MS);
  const candidates = await prisma.postTurnOutbox.findMany({
    where: {
      attempts: { lt: OUTBOX_MAX_ATTEMPTS },
      OR: [
        // Crashed BEFORE the drain claimed it (original case) — honor the
        // retry backoff finishClaim writes into nextAttemptAt (spine-1:
        // pre-fix claims ignored it, so a failed row could retry early).
        { status: "pending", createdAt: { lt: cutoff }, nextAttemptAt: { lte: now } },
        // Crashed AFTER a claim — stranded at `processing` (spine-1).
        { status: "processing", updatedAt: { lt: staleProcessing } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true, status: true },
  });
  const claimed: Array<{ id: string; payload: SerializableDeferredCtx; attempts: number }> = [];
  for (const c of candidates) {
    // The status-guarded flip is the lock; for stale-processing rows the
    // updatedAt guard keeps a LIVE worker's row (it just touched it) safe
    // from being stolen.
    const res = await prisma.postTurnOutbox.updateMany({
      where:
        c.status === "pending"
          ? { id: c.id, status: "pending" }
          : { id: c.id, status: "processing", updatedAt: { lt: staleProcessing } },
      data: { status: "processing", attempts: { increment: 1 } },
    });
    if (res.count !== 1) continue; // lost the race — another drain owns it
    const row = await prisma.postTurnOutbox.findUnique({
      where: { id: c.id },
      select: { id: true, payload: true, attempts: true },
    });
    if (row) {
      claimed.push({
        id: row.id,
        payload: row.payload as unknown as SerializableDeferredCtx,
        attempts: row.attempts,
      });
    }
  }
  return claimed;
}

export async function finishClaim(
  id: string,
  ok: boolean,
  attempts: number,
  error?: unknown,
): Promise<void> {
  const failedForGood = !ok && attempts >= OUTBOX_MAX_ATTEMPTS;
  await prisma.postTurnOutbox
    .update({
      where: { id },
      data: ok
        ? { status: "done", lastError: null }
        : {
            status: failedForGood ? "failed" : "pending",
            lastError: String(error instanceof Error ? error.message : error).slice(0, 500),
            nextAttemptAt: new Date(Date.now() + 60 * 60 * 1000),
          },
    })
    .catch((e: unknown) => {
      // Spine-1: an unrecorded finish is how a done row gets re-run or a
      // failed row silently loses its error — the one write that proves
      // the drain's work must be LOUD when it fails.
      logError("chat.post-turn-outbox", e, { stage: "finish-claim", outboxId: id, ok }, "error");
      return undefined;
    });
}
