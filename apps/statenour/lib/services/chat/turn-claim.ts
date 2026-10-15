/**
 * lib/services/chat/turn-claim.ts - at most one live run per user message
 * (2026-10-15 · chat turn idempotency).
 *
 * The gap: POST /api/ai/chat keeps running a turn after the client disconnects
 * (consumeStream), so a client that lost the response cannot tell whether the
 * server is still working, and a second POST for the same user message started a
 * second run that fired the same write tools. This is the lease that makes the
 * second POST detectable: one row per user message, created BEFORE any work, so
 * the unique key picks exactly one runner.
 *
 *   claimed      this caller runs the turn; a heartbeat keeps the lease alive
 *   in_flight    another run holds a live lease: do not start a second one
 *   unavailable  the store failed: fail OPEN (a chat outage is worse than the
 *                duplicate this guard exists to prevent; the same policy as
 *                withToolIdempotency's legacy path)
 *
 * The row is a LEASE, not a record of what happened. It is deleted when the run
 * ends; whether a message was answered is read from chat_messages, the durable
 * truth (turn-guard.ts). Crash safety is the lease: a run that dies stops
 * renewing and its row lapses within TURN_LEASE_MS, so a deploy that kills a
 * turn never locks the operator out of retrying it.
 *
 * Why this table and not action_attempts: that ledger feeds the Owner Panel
 * (waiting-summary-data.ts surfaces UNKNOWN/FAILED and EXECUTING > 30 min), so a
 * row per chat turn would raise owner exceptions for ordinary turns. The
 * BrainMemory `active_chat_stream` category is already the home of turn-liveness
 * rows and is excluded from recall and consolidation (lib/brain/categories.ts).
 *
 * Reclaiming a lapsed lease is a compare-and-swap on the row that was read
 * (claim-before-act): two racers that both see the same expired lease cannot
 * both win, and a renewal that moves only the deadline still beats the swap.
 */
import { prisma } from "@/lib/prisma";
import { logError } from "@/lib/utils/error-log";

const CATEGORY = "active_chat_stream";
const SOURCE = "chat-turn-claim";

/** A claim nobody renews is a dead run; its row stops blocking after this long. */
export const TURN_LEASE_MS = 90_000;
/** Three beats per lease: two can be lost before the lease lapses. */
export const TURN_BEAT_MS = 30_000;
/** Renewals stop here, so a hung run cannot hold its message forever: it then lapses within TURN_LEASE_MS. Deep turns measure 161s worst, maxDuration says 300s. */
export const TURN_MAX_RUN_MS = 6 * 60_000;
/** After the stream has drained, how long the persist (and the post-turn work it awaits) may still report before the run counts as over. */
export const POST_DRAIN_GRACE_MS = 60_000;

const keyFor = (clientMessageId: string) => `turn:${clientMessageId.slice(0, 120)}`;

export interface TurnClaim {
  readonly traceId: string;
  /** The turn's conversation, once known (the first message of a new thread has none at claim time). */
  setConversation(conversationId: string): void;
  /** The run outlives the HTTP handler: release when it has finished, however it ended. */
  settleWith(finished: PromiseLike<unknown>): void;
  /** The handler is returning or threw: release now, unless settleWith took the run over. */
  finish(): void;
  /**
   * For a response that is not the streaming path: its BODY may still be doing the run's work (an
   * image is generated, an alternate lane reasons and persists, inside the returned stream, after the
   * handler has returned). Keeps the lease until the body closes or errors. If the reader leaves first
   * the work goes on, so the lease is NOT deleted: renewals stop and it lapses within TURN_LEASE_MS.
   * An error status or an empty body means nothing is running: released at once. Call after the
   * handler has its Response; a no-op if settleWith already took the run over.
   */
  holdWhileBodyOpen(response: Response): Response;
}

export type ClaimOutcome =
  | { kind: "claimed"; claim: TurnClaim }
  | { kind: "in_flight"; traceId: string | null; conversationId: string | null }
  | { kind: "unavailable" };

interface LeaseMeta {
  traceId: string | null;
  conversationId: string | null;
}

function leaseMeta(metadata: unknown): LeaseMeta {
  const m = (metadata ?? {}) as { traceId?: unknown; conversationId?: unknown };
  return {
    traceId: typeof m.traceId === "string" ? m.traceId : null,
    conversationId: typeof m.conversationId === "string" ? m.conversationId : null,
  };
}

function warn(stage: string, key: string, error: unknown): void {
  logError("chat.turn-claim", error, { stage, key }, "warn");
}

/**
 * A store call nobody awaits. It must never throw: the heartbeat runs in a timer callback (a throw
 * there is an uncaught exception) and release runs in the route's `finally` (a throw there would turn
 * a finished reply into an error). A lease that fails to renew or release only lapses sooner.
 */
function background(stage: string, key: string, call: () => PromiseLike<unknown>): void {
  try {
    void Promise.resolve(call()).then(undefined, (e: unknown) => warn(stage, key, e));
  } catch (e) {
    warn(stage, key, e);
  }
}

function buildClaim(key: string, traceId: string, startedAt: string): TurnClaim {
  // Every write below is pinned to THIS run's trace: after a reclaim the row belongs to
  // someone else, and a slow owner must neither extend nor delete the new owner's lease.
  const own = { category: CATEGORY, key, metadata: { path: ["traceId"], equals: traceId } };
  let released = false;
  let bound = false;

  const timer = setInterval(() => {
    if (Date.now() - Date.parse(startedAt) > TURN_MAX_RUN_MS) {
      clearInterval(timer);
      return;
    }
    background("heartbeat", key, () =>
      prisma.brainMemory.updateMany({ where: own, data: { expiresAt: new Date(Date.now() + TURN_LEASE_MS) } }),
    );
  }, TURN_BEAT_MS);
  timer.unref?.();

  const release = () => {
    if (released) return;
    released = true;
    clearInterval(timer);
    background("release", key, () => prisma.brainMemory.deleteMany({ where: own }));
  };
  // The reader left but the work did not: stop renewing and let the row expire on its own.
  const lapse = () => {
    if (released) return;
    released = true;
    clearInterval(timer);
  };

  return {
    traceId,
    setConversation(conversationId) {
      if (released) return;
      background("conversation", key, () =>
        prisma.brainMemory.updateMany({ where: own, data: { metadata: { traceId, conversationId, startedAt } } }),
      );
    },
    settleWith(finished) {
      bound = true;
      Promise.resolve(finished).then(release, release);
    },
    finish() {
      if (!bound) release();
    },
    holdWhileBodyOpen(response) {
      if (bound) return response;
      if (!response.ok || !response.body) {
        release();
        return response;
      }
      bound = true;
      const reader = response.body.getReader();
      const held = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const { done, value } = await reader.read();
            if (done) {
              controller.close();
              release();
            } else controller.enqueue(value);
          } catch (error) {
            controller.error(error);
            release();
          }
        },
        cancel(reason) {
          lapse();
          return reader.cancel(reason);
        },
      });
      return new Response(held, { status: response.status, statusText: response.statusText, headers: response.headers });
    },
  };
}

/**
 * When a streaming run is over: the stream has drained (tools can no longer run; the errored row is
 * settled) AND the onFinish/onError persist has reported, however either ended. The persist gets
 * POST_DRAIN_GRACE_MS after the drain to report: an onFinish that throws is swallowed by the SDK and
 * never resolves onFinishPromise, and a lease must not wait on that for the whole run cap. An error
 * part resolves the persist EARLY, while tools may still run, so the drain is always awaited.
 */
export function afterDrain(drained: PromiseLike<unknown>, persisted: PromiseLike<unknown>, graceMs = POST_DRAIN_GRACE_MS): Promise<void> {
  const settled = (p: PromiseLike<unknown>) => Promise.resolve(p).then(() => undefined, () => undefined);
  return settled(drained).then(
    () =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, graceMs);
        timer.unref?.();
        void settled(persisted).then(() => {
          clearTimeout(timer);
          resolve();
        });
      }),
  );
}

export async function claimTurn(input: {
  clientMessageId: string;
  traceId: string;
  conversationId: string | null;
}): Promise<ClaimOutcome> {
  const key = keyFor(input.clientMessageId);
  const startedAt = new Date().toISOString();
  const fresh = () => ({
    content: `chat turn ${input.traceId} · ${startedAt}`,
    confidence: 0.1,
    source: SOURCE,
    expiresAt: new Date(Date.now() + TURN_LEASE_MS),
    deletedAt: null,
    metadata: { traceId: input.traceId, conversationId: input.conversationId, startedAt },
  });

  // A row can vanish between the failed create and the read (its owner just finished):
  // that is a free slot, so go round again instead of guessing.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      // brain-memory-direct-write: a self-expiring turn lease (active_chat_stream), a lock row, not a memory.
      await prisma.brainMemory.create({ data: { category: CATEGORY, key, ...fresh() } });
      return { kind: "claimed", claim: buildClaim(key, input.traceId, startedAt) };
    } catch (error) {
      if ((error as { code?: string } | null)?.code !== "P2002") {
        warn("create", key, error);
        return { kind: "unavailable" };
      }
    }

    try {
      const existing = await prisma.brainMemory.findUnique({
        where: { category_key: { category: CATEGORY, key } },
        select: { id: true, expiresAt: true, updatedAt: true, deletedAt: true, metadata: true },
      });
      if (!existing) continue;

      const live = !existing.deletedAt && existing.expiresAt !== null && existing.expiresAt.getTime() > Date.now();
      if (live) return { kind: "in_flight", ...leaseMeta(existing.metadata) };

      // The "lapsed" verdict came from expiresAt and the row's version: pin both, so a renewal
      // that lands after our read (it moves the deadline and bumps updatedAt) still wins.
      const swapped = await prisma.brainMemory.updateMany({
        where: { id: existing.id, updatedAt: existing.updatedAt, expiresAt: existing.expiresAt },
        data: fresh(),
      });
      if (swapped.count === 1) return { kind: "claimed", claim: buildClaim(key, input.traceId, startedAt) };

      const winner = await prisma.brainMemory.findUnique({
        where: { category_key: { category: CATEGORY, key } },
        select: { metadata: true },
      });
      if (winner) return { kind: "in_flight", ...leaseMeta(winner.metadata) };
    } catch (error) {
      warn("reclaim", key, error);
      return { kind: "unavailable" };
    }
  }
  return { kind: "unavailable" };
}
