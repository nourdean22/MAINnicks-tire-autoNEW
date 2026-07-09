/**
 * lib/ai/reasoning/idempotency.ts · Phase N.1 (2026-05-18 PM)
 *
 * Idempotency keys for /api/nick/reason · closes the double-tap spend
 * leak. Pre-N: operator taps "ask nick" twice rapidly · 2 mega-tier
 * runs fire · ~$0.40 burned. Reservation system catches the 2nd at
 * the budget gate but only AFTER the 1st has already started running.
 *
 * Now: client sends an Idempotency-Key (auto-generated nanoid · stable
 * for the duration of the operator's click intent). Server records
 * "in-flight by key X · started at T". A second request with the
 * same key within the TTL returns the cached result (or "still running"
 * if the first hasn't finished yet · client polls).
 *
 * TTL: 10 minutes. Long enough for a mega run + operator confirm
 * dialog · short enough that stale keys don't accumulate.
 *
 * Storage: BrainMemory(category="reasoning_idempotency", key=`idem:<X>`).
 * Metadata carries the original request hash + completed result (or
 * "in_flight" marker). Aligned with the Phase H.6.2 reservation
 * pattern.
 */

import type { ReasoningResult } from "./types";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

export const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Lazy error sink · error-log statically imports lib/prisma, and this module
// deliberately keeps its import graph DB-free (all prisma access is via
// dynamic import inside try blocks). Never throws.
function logIdempotencyError(err: unknown, extra: Record<string, unknown>): void {
  void import("@/lib/utils/error-log")
    .then(({ logError }) => logError("ai.reasoning-idempotency", err, extra, "warn"))
    .catch(() => {});
}

export interface IdempotencyLookup {
  /** True if this key is currently in flight (started · not yet completed) */
  inFlight: boolean;
  /** Completed result · only present when inFlight=false and the run finished */
  result: ReasoningResult | null;
  /** ISO timestamp when first seen */
  firstSeenAt: string | null;
}

/** Look up a key · returns null if no entry exists at all (caller should
 *  proceed normally + reserve the key). */
export async function lookupIdempotency(
  key: string,
): Promise<IdempotencyLookup | null> {
  try {
    const { prisma } = await import("@/lib/prisma");
    const cutoff = new Date(Date.now() - IDEMPOTENCY_TTL_MS);
    const row = await prisma.brainMemory.findFirst({
      where: {
        category: BRAIN_CATEGORIES.REASONING_IDEMPOTENCY,
        key: `idem:${key}`,
        createdAt: { gte: cutoff },
        deletedAt: null,
      },
      orderBy: { createdAt: "desc" },
      select: { metadata: true, createdAt: true },
    });
    if (!row) return null;
    const meta = (row.metadata ?? {}) as {
      state?: "in_flight" | "completed";
      result?: ReasoningResult;
    };
    return {
      inFlight: meta.state === "in_flight",
      result: meta.state === "completed" ? (meta.result ?? null) : null,
      firstSeenAt: row.createdAt.toISOString(),
    };
  } catch {
    // Fail-open · idempotency is best-effort · prefer letting the run
    // proceed over blocking on a tooling error.
    return null;
  }
}

/** Reserve an idempotency key · marks it in-flight. Pair with
 *  storeIdempotencyResult on completion OR releaseIdempotency on
 *  failure. */
export async function reserveIdempotency(key: string, requestHash: string): Promise<void> {
  try {
    const { prisma } = await import("@/lib/prisma");
    await prisma.brainMemory.create({
      data: {
        category: BRAIN_CATEGORIES.REASONING_IDEMPOTENCY,
        key: `idem:${key}`,
        content: `in-flight · request hash ${requestHash.slice(0, 16)}`,
        confidence: 0.5,
        source: "reasoning-idempotency",
        createdBy: "system",
        metadata: {
          state: "in_flight",
          requestHash,
          reservedAt: Date.now(),
        },
      },
    });
  } catch (err) {
    // Best-effort · TTL prune handles abandoned reservations
    logIdempotencyError(err, { fn: "reserveIdempotency", key });
  }
}

/** Store the completed result · subsequent requests with the same key
 *  get the cached result via lookupIdempotency. */
export async function storeIdempotencyResult(
  key: string,
  result: ReasoningResult,
): Promise<void> {
  try {
    const { prisma } = await import("@/lib/prisma");
    // Prisma's JSON column needs InputJsonValue · cast via JSON
    // round-trip so the nested ReasoningResult shape is accepted.
    const metadataJson = JSON.parse(
      JSON.stringify({
        state: "completed",
        result,
        completedAt: Date.now(),
      }),
    );
    await prisma.brainMemory.updateMany({
      where: { category: BRAIN_CATEGORIES.REASONING_IDEMPOTENCY, key: `idem:${key}` },
      data: {
        content: `completed · ${result.tier} tier · ${result.trace.cost.calls} calls`,
        metadata: metadataJson,
      },
    });
  } catch (err) {
    // Best-effort
    logIdempotencyError(err, { fn: "storeIdempotencyResult", key });
  }
}

/** Release a reservation on failure · operator can retry with the
 *  same key after a real error. */
export async function releaseIdempotency(key: string): Promise<void> {
  try {
    const { prisma } = await import("@/lib/prisma");
    await prisma.brainMemory.deleteMany({
      where: { category: BRAIN_CATEGORIES.REASONING_IDEMPOTENCY, key: `idem:${key}` },
    });
  } catch (err) {
    // Best-effort
    logIdempotencyError(err, { fn: "releaseIdempotency", key });
  }
}

/** Hash a reasoning request body for collision detection. Two requests
 *  with the same idempotency key but DIFFERENT bodies are an operator
 *  error · we surface it rather than silently return the wrong cached
 *  result. */
export function hashRequest(body: {
  question?: string;
  brainContext?: string;
  tier?: string;
}): string {
  const norm = JSON.stringify({
    question: (body.question ?? "").trim(),
    brainContext: body.brainContext ?? "",
    tier: body.tier ?? "auto",
  });
  // Simple FNV-1a hash · sufficient for collision detection (not crypto)
  let h = 2166136261;
  for (let i = 0; i < norm.length; i++) {
    h ^= norm.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/** Opportunistic cleanup · called from the gate at ~10% sample. */
export async function pruneStaleIdempotency(): Promise<void> {
  try {
    const { prisma } = await import("@/lib/prisma");
    const cutoff = new Date(Date.now() - IDEMPOTENCY_TTL_MS);
    await prisma.brainMemory.deleteMany({
      where: { category: BRAIN_CATEGORIES.REASONING_IDEMPOTENCY, createdAt: { lt: cutoff } },
    });
  } catch (err) {
    // Best-effort
    logIdempotencyError(err, { fn: "pruneStaleIdempotency" });
  }
}
