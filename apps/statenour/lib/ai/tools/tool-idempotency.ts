/**
 * Tool idempotency · 2026-07-22; unknown-completion hardening 2026-09-13.
 *
 * Defense-in-depth against DUPLICATE destructive tool side effects.
 *
 * Historical behavior is preserved by default: a reported/throwing failure
 * releases the short-lived marker and infrastructure failure fails open. A
 * caller that can distinguish "known failure" from "the request may have
 * committed but the response was lost" can opt into the stricter semantics
 * below. UNKNOWN completion keeps the marker and suppresses blind retries.
 *
 * This is intentionally a bridge, not the final durable Operation Ledger.
 * BrainMemory remains the existing short-lived claim store until a dedicated
 * operation schema can be introduced and migrated deliberately.
 */
import { createHash } from "node:crypto";

const CATEGORY = "tool_idempotency";

export type ToolCompletionDisposition = "success" | "known_failure" | "unknown";

export interface IdempotencyDuplicateContext {
  /** UNKNOWN means the prior attempt may have committed; never imply "done". */
  state: "claimed" | "unknown";
  expiresAt: Date | null;
}

export interface ToolIdempotencyOptions<T> {
  /** Stronger than the legacy boolean `succeeded` predicate. */
  classifyResult?: (result: T) => ToolCompletionDisposition;
  /** Legacy default is known_failure, preserving all existing callers. */
  classifyError?: (error: unknown) => Exclude<ToolCompletionDisposition, "success">;
  /** Hold UNKNOWN attempts longer than the ordinary duplicate window. */
  unknownWindowMs?: number;
  /**
   * Optional fail-closed policy for actions that must not run when the
   * idempotency claim store is unavailable. Existing callers stay fail-open.
   */
  onClaimUnavailable?: (error: unknown) => T | Promise<T>;
}

/** Stable 16-hex content fingerprint for the dedup key. */
export function idempotencyKey(tool: string, content: string): string {
  const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);
  return `${tool}:${hash}`;
}

function markerContent(state: "claimed" | "unknown", now = new Date()): string {
  return `${state}:${now.toISOString()}`;
}

function markerState(content: string | null | undefined): IdempotencyDuplicateContext["state"] {
  return content?.startsWith("unknown:") ? "unknown" : "claimed";
}

export async function withToolIdempotency<T>(
  key: string,
  windowMs: number,
  run: () => Promise<T>,
  onDuplicate: (context?: IdempotencyDuplicateContext) => T,
  /**
   * Backward-compatible success predicate. False maps to known_failure unless
   * `options.classifyResult` is supplied.
   */
  succeeded?: (result: T) => boolean,
  options: ToolIdempotencyOptions<T> = {},
): Promise<T> {
  let prisma: typeof import("@/lib/prisma").prisma;
  try {
    ({ prisma } = await import("@/lib/prisma"));
  } catch (error) {
    if (options.onClaimUnavailable) return options.onClaimUnavailable(error);
    return run();
  }

  const dedupKey = key.slice(0, 190);
  const where = { category_key: { category: CATEGORY, key: dedupKey } } as const;
  const now = () => new Date();

  const markUnknown = async () => {
    const holdMs = Math.max(windowMs, options.unknownWindowMs ?? windowMs);
    await prisma.brainMemory
      .update({
        where,
        data: {
          content: markerContent("unknown", now()),
          expiresAt: new Date(Date.now() + holdMs),
        },
      })
      .catch((error) => logIdemError("mark-unknown", dedupKey, error));
  };

  try {
    const claimedAt = now();
    await prisma.brainMemory.create({
      data: {
        category: CATEGORY,
        key: dedupKey,
        content: markerContent("claimed", claimedAt),
        confidence: 1,
        source: CATEGORY,
        expiresAt: new Date(claimedAt.getTime() + windowMs),
      },
    });
  } catch (error) {
    if ((error as { code?: string })?.code === "P2002") {
      const existing = await prisma.brainMemory
        .findUnique({ where, select: { expiresAt: true, content: true } })
        .catch(() => null);
      if (existing?.expiresAt && existing.expiresAt.getTime() > Date.now()) {
        return onDuplicate({
          state: markerState(existing.content),
          expiresAt: existing.expiresAt,
        });
      }

      try {
        const reclaimedAt = now();
        await prisma.brainMemory.update({
          where,
          data: {
            content: markerContent("claimed", reclaimedAt),
            expiresAt: new Date(reclaimedAt.getTime() + windowMs),
          },
        });
      } catch (reclaimError) {
        await logIdemError("reclaim-expired-marker", dedupKey, reclaimError);
        if (options.onClaimUnavailable) return options.onClaimUnavailable(reclaimError);
        return run();
      }
    } else {
      if (options.onClaimUnavailable) return options.onClaimUnavailable(error);
      return run();
    }
  }

  try {
    const result = await run();
    const disposition: ToolCompletionDisposition = options.classifyResult
      ? options.classifyResult(result)
      : succeeded
        ? (succeeded(result) ? "success" : "known_failure")
        : "success";

    if (disposition === "known_failure") {
      await prisma.brainMemory
        .deleteMany({ where: { category: CATEGORY, key: dedupKey } })
        .catch((error) => logIdemError("release-on-known-failure", dedupKey, error));
    } else if (disposition === "unknown") {
      await markUnknown();
    }
    return result;
  } catch (error) {
    const disposition = options.classifyError?.(error) ?? "known_failure";
    if (disposition === "unknown") {
      await markUnknown();
    } else {
      await prisma.brainMemory
        .deleteMany({ where: { category: CATEGORY, key: dedupKey } })
        .catch((releaseError) => logIdemError("release-after-known-throw", dedupKey, releaseError));
    }
    throw error;
  }
}

async function logIdemError(stage: string, key: string, error: unknown): Promise<void> {
  try {
    const { logError } = await import("@/lib/utils/error-log");
    logError("ai.tool-idempotency", error, { fn: "withToolIdempotency", stage, key }, "warn");
  } catch {
    // Logging failure is not allowed to become an action failure.
  }
}
