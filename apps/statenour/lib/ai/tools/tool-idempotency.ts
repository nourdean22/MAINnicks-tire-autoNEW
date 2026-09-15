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
 * Two claim stores, one contract (2026-09-15):
 *   · `options.durable` → action_attempts (lib/services/action-attempts.ts),
 *     the durable Operation Ledger the 2026-09-13 note said would come once a
 *     dedicated schema was migrated deliberately. It is migrated. One row per
 *     operation key with the full state machine; sendTelegram is the first
 *     consumer. A missing table falls back to the bridge below.
 *   · otherwise → the BrainMemory `tool_idempotency` marker bridge, unchanged,
 *     for every caller that has not opted in yet.
 */
import { createHash } from "node:crypto";
import type { SettledState } from "@/lib/services/action-attempts";

const CATEGORY = "tool_idempotency";

export type ToolCompletionDisposition = "success" | "known_failure" | "unknown";

export interface IdempotencyDuplicateContext {
  /** UNKNOWN means the prior attempt may have committed; never imply "done". */
  state: "claimed" | "unknown";
  expiresAt: Date | null;
  /** Present when the durable ActionAttempt store answered (2026-09-15). */
  attemptId?: string;
  /** The prior attempt's real ledger state — SUCCEEDED_UNVERIFIED, UNKNOWN, EXECUTING, VERIFIED. */
  attemptState?: string;
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
  /**
   * 2026-09-15 · opt into the DURABLE claim store: one action_attempts row per
   * operation key with the full state machine (lib/services/action-attempts.ts),
   * instead of a BrainMemory marker. sendTelegram is the first consumer. If the
   * table does not exist in this environment the call falls back to the bridge
   * below and logs `durable-missing-table` — never crash the API on a missing table.
   */
  durable?: {
    tool: string;
    effectClass?: "write" | "read" | "unknown";
    /**
     * Decorate the result with the ledger's verdict. Called ONLY after
     * `settleAttempt` resolved — never on the missing-table fallback (no row
     * exists) and never when the settle itself failed (the row is still
     * EXECUTING). A result that carries `ledgerState` therefore always names a
     * transition the ledger confirmed (Codex review of #2338).
     */
    stamp?: (result: T, ledger: { attemptId: string; state: SettledState }) => T;
  };
  /** The provider's own reference for a successful effect (message id, sid...), recorded on the attempt. */
  externalReference?: (result: T) => string | undefined;
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
  if (options.durable) {
    const durable = await runDurable(key, windowMs, run, onDuplicate, succeeded, options, options.durable);
    if (durable.handled) return durable.value;
    // table missing in this environment — fall through to the BrainMemory bridge
  }

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
      let existing: { expiresAt: Date | null; content: string | null } | null;
      try {
        existing = await prisma.brainMemory.findUnique({
          where,
          select: { expiresAt: true, content: true },
        });
      } catch (readError) {
        await logIdemError("read-existing-marker", dedupKey, readError);
        if (options.onClaimUnavailable) return options.onClaimUnavailable(readError);
        // Legacy callers retain their historical fail-open semantics, but a
        // failed read is never re-labelled as "expired" and never reclaimed.
        return run();
      }

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

function dispose<T>(result: T, succeeded: ((result: T) => boolean) | undefined, options: ToolIdempotencyOptions<T>): ToolCompletionDisposition {
  if (options.classifyResult) return options.classifyResult(result);
  if (succeeded) return succeeded(result) ? "success" : "known_failure";
  return "success";
}

/**
 * The durable path (2026-09-15): claim → run → settle against action_attempts.
 * Returns `handled: false` ONLY when the table is missing, so the caller can
 * fall back to the BrainMemory bridge; every other store failure is decided
 * here by the caller's own fail-open / fail-closed policy.
 */
async function runDurable<T>(
  key: string,
  windowMs: number,
  run: () => Promise<T>,
  onDuplicate: (context?: IdempotencyDuplicateContext) => T,
  succeeded: ((result: T) => boolean) | undefined,
  options: ToolIdempotencyOptions<T>,
  durable: NonNullable<ToolIdempotencyOptions<T>["durable"]>,
): Promise<{ handled: true; value: T } | { handled: false }> {
  const svc = await import("@/lib/services/action-attempts");
  const operationKey = key.slice(0, 190);
  let begun: Awaited<ReturnType<typeof svc.beginAttempt>>;
  try {
    begun = await svc.beginAttempt({
      operationKey,
      tool: durable.tool,
      effectClass: durable.effectClass,
      argumentsHash: operationKey.slice(operationKey.indexOf(":") + 1),
      windowMs,
    });
  } catch (error) {
    if (svc.isMissingTableError(error)) {
      await logIdemError("durable-missing-table", operationKey, error);
      return { handled: false };
    }
    await logIdemError("durable-begin", operationKey, error);
    if (options.onClaimUnavailable) return { handled: true, value: await options.onClaimUnavailable(error) };
    return { handled: true, value: await run() };
  }

  if (begun.kind === "duplicate") {
    return {
      handled: true,
      value: onDuplicate({
        state: begun.state === "UNKNOWN" ? "unknown" : "claimed",
        expiresAt: begun.holdUntil,
        attemptId: begun.attemptId,
        attemptState: begun.state,
      }),
    };
  }
  let result: T;
  try {
    result = await run();
  } catch (error) {
    const disposition = options.classifyError?.(error) ?? "known_failure";
    await svc
      .settleAttempt(begun.attemptId, {
        disposition,
        unknownHoldMs: options.unknownWindowMs,
        reason: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
      })
      .catch((settleError) => logIdemError("durable-settle-after-throw", operationKey, settleError));
    throw error;
  }

  // Settle, then stamp. The stamp runs only on a CONFIRMED settlement: if the
  // ledger write fails the row is still EXECUTING and the caller gets the raw
  // result — no attemptId, no ledgerState — because claiming a transition the
  // store never made is exactly the lie this contract exists to end.
  const disposition = dispose(result, succeeded, options);
  let settled: SettledState;
  try {
    settled = await svc.settleAttempt(begun.attemptId, {
      disposition,
      unknownHoldMs: options.unknownWindowMs,
      externalReference: disposition === "success" ? options.externalReference?.(result) : undefined,
    });
  } catch (error) {
    await logIdemError("durable-settle", operationKey, error);
    return { handled: true, value: result };
  }
  return { handled: true, value: durable.stamp ? durable.stamp(result, { attemptId: begun.attemptId, state: settled }) : result };
}

async function logIdemError(stage: string, key: string, error: unknown): Promise<void> {
  try {
    const { logError } = await import("@/lib/utils/error-log");
    logError("ai.tool-idempotency", error, { fn: "withToolIdempotency", stage, key }, "warn");
  } catch {
    // Logging failure is not allowed to become an action failure.
  }
}
