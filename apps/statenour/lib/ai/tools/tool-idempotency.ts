/**
 * Tool idempotency · 2026-07-22
 *
 * Defense-in-depth against DUPLICATE destructive tool side effects. The chat
 * turn can re-execute for several reasons — the client auto-regen after a
 * network kill (use-chat-stream.ts), a manual retry, or the best-of-2
 * pre-stream regen (NICK_VERIFIED_REGEN) — and each re-run re-invokes the
 * model's tool calls fresh. Without a guard, a dropped SSE after a committed
 * `sendTelegram` / `stageCustomerAlert` / live `triggerInstagramAutopost`
 * fires it AGAIN (duplicate message, duplicate PENDING receipt, duplicate
 * PUBLIC post).
 *
 * `withToolIdempotency` claims a short-lived marker keyed by the action's
 * CONTENT before the side effect runs. The claim is atomic via BrainMemory's
 * `@@unique([category, key])` constraint (same idiom as the objection-injection
 * log). A second identical action inside the window returns the caller's
 * `onDuplicate()` sentinel WITHOUT running the effect. Best-effort throughout:
 * any DB problem falls through to running the action (never blocks a real send
 * because of an infra hiccup), and a marker whose action THREW is released so a
 * genuine retry can proceed.
 */
import { createHash } from "node:crypto";

const CATEGORY = "tool_idempotency";

/** Stable 16-hex content fingerprint for the dedup key. */
export function idempotencyKey(tool: string, content: string): string {
  const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);
  return `${tool}:${hash}`;
}

export async function withToolIdempotency<T>(
  key: string,
  windowMs: number,
  run: () => Promise<T>,
  onDuplicate: () => T,
  /**
   * True iff `result` means the side effect COMMITTED. Required for tools that
   * report failure by RETURN VALUE instead of throwing (sendTelegram -> false,
   * queryNick -> { error }). If a run reports failure, its marker is released so
   * a real retry can proceed — otherwise a failed send holds the marker and the
   * retry falsely reports "already done". Omit only when run() always throws on
   * failure.
   */
  succeeded?: (result: T) => boolean,
): Promise<T> {
  let prisma: typeof import("@/lib/prisma").prisma;
  try {
    ({ prisma } = await import("@/lib/prisma"));
  } catch {
    return run(); // no DB client — cannot dedup; do NOT block the action
  }

  const dedupKey = key.slice(0, 190);
  const where = { category_key: { category: CATEGORY, key: dedupKey } } as const;

  try {
    await prisma.brainMemory.create({
      data: {
        category: CATEGORY,
        key: dedupKey,
        content: new Date().toISOString(),
        confidence: 1,
        source: CATEGORY,
        expiresAt: new Date(Date.now() + windowMs),
      },
    });
  } catch (e) {
    // Unique-constraint violation = a marker already exists for this content.
    if ((e as { code?: string })?.code === "P2002") {
      const existing = await prisma.brainMemory.findUnique({ where, select: { expiresAt: true } }).catch(() => null);
      // Still inside the window → a live duplicate re-fire. Skip the side effect.
      if (existing?.expiresAt && existing.expiresAt.getTime() > Date.now()) {
        return onDuplicate();
      }
      // Expired marker (not yet pruned by the decay cron) → reclaim + proceed.
      // A failed reclaim means the dedup guard is silently OFF for this
      // action — log it (lazy sink: this module must not import prisma
      // transitively at load time).
      await prisma.brainMemory
        .update({ where, data: { content: new Date().toISOString(), expiresAt: new Date(Date.now() + windowMs) } })
        .catch((e) => logIdemError("reclaim-expired-marker", dedupKey, e));
    } else {
      // Any other DB error → don't block the real action.
      return run();
    }
  }

  try {
    const result = await run();
    // The action ran but reported FAILURE by return value (didn't throw) — release
    // the marker so a genuine retry proceeds instead of hitting a false "already done".
    if (succeeded && !succeeded(result)) {
      // A failed release leaves the marker stuck — a genuine retry inside the
      // window would falsely report "already done". Loud, not fatal.
      await prisma.brainMemory.deleteMany({ where: { category: CATEGORY, key: dedupKey } }).catch((e) => logIdemError("release-on-reported-failure", dedupKey, e));
    }
    return result;
  } catch (err) {
    // The action threw AFTER claiming — release the marker so a real retry works.
    await prisma.brainMemory.deleteMany({ where: { category: CATEGORY, key: dedupKey } }).catch((e) => logIdemError("release-after-throw", dedupKey, e));
    throw err;
  }
}

/**
 * Lazy log sink — this module intentionally has no top-level prisma import
 * (see the guarded dynamic import in withToolIdempotency), and
 * `@/lib/utils/error-log` imports prisma transitively. Logging must never
 * affect the action path.
 */
async function logIdemError(stage: string, key: string, e: unknown): Promise<void> {
  try {
    const { logError } = await import("@/lib/utils/error-log");
    logError("ai.tool-idempotency", e, { fn: "withToolIdempotency", stage, key }, "warn");
  } catch {
    // logging failure is not allowed to become an action failure
  }
}
