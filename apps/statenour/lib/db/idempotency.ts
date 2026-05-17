/**
 * Universal idempotency helpers · v7.7 · Apr 29.
 *
 * Phase 1 of the schema-audit hardening adds a nullable
 * `idempotency_key` column + UNIQUE PARTIAL INDEX to six tables:
 *   autonomous_actions, scheduled_actions, task_events, goal_events,
 *   reflections, decision_replays.
 *
 * This module provides:
 *
 *   1. mintIdempotencyKey(parts: object) — deterministic 32-char hash
 *      from any composite. Caller-side OR server-side; same input →
 *      same key, so a retry within the same logical action collides
 *      and is suppressed by the unique index.
 *
 *   2. idempotentCreate({ model, key, data, find }) — generic upsert-
 *      shaped wrapper. If a row with that key already exists → returns
 *      it untouched. Else inserts. Catches P2002 unique-violations
 *      gracefully when two concurrent inserts race.
 *
 *   3. Time-bucketed mint shortcuts for the common "fire every Nminutes"
 *      cron pattern: `mintIdempotencyKey.bucketed(parts, bucketSeconds)`
 *      hashes (parts + floor(now / bucket)) so retries within the
 *      same bucket collide.
 *
 * Why this exists:
 *   · Crons retry on Vercel cold-starts → without this, every cold
 *     start risks doubling autonomous actions / scheduled tasks /
 *     reflections.
 *   · Webhooks deliver-at-least-once → retries duplicate event logs.
 *   · Network blips between admin UI and API → users see "I already
 *     clicked submit" double-fires.
 *
 * Pure module — no DB writes from here. Just hashing + a thin upsert
 * helper that callers wrap their model-specific writes in.
 */

import { createHash } from "node:crypto";

// ─────────────────────────────────────────────────────────────────
// MINTING
// ─────────────────────────────────────────────────────────────────

/**
 * Deterministic 32-char hex from any JSON-serializable composite.
 * Order-stable: keys are sorted before hashing so {a,b} and {b,a}
 * produce the same key.
 */
function stableHash(parts: Record<string, unknown> | string): string {
  const serialized =
    typeof parts === "string"
      ? parts
      : JSON.stringify(parts, Object.keys(parts).sort());
  return createHash("sha256").update(serialized).digest("hex").slice(0, 32);
}

/**
 * Mint an idempotency key from any composite. The composite should
 * include EVERY field that should make the action "the same" —
 * typically the entity refs + action verb + a time bucket.
 *
 * Example:
 *   mintIdempotencyKey({
 *     ruleName: "auto_followup_expired_quote",
 *     targetType: "quote",
 *     targetId: "qt-123",
 *     dateBucket: "2026-04-29-am",
 *   })
 *
 * Always returns a 32-char hex key. Prefix with "idem-" for log
 * legibility — distinguishes from server-fallback "srv-" keys used
 * elsewhere (e.g. ChatMessage's synthesizeFallbackClientMessageId).
 */
export function mintIdempotencyKey(
  parts: Record<string, unknown> | string,
): string {
  return `idem-${stableHash(parts)}`;
}

/**
 * Time-bucketed variant. Common case: "this cron fires every 6h —
 * retries within the same hour should collide, but the next 6h
 * window should produce a new key."
 *
 * Pass bucketSeconds matching your cron cadence. Use floor(now /
 * bucket) so all calls within the same bucket map to the same key.
 *
 * Example for a 6-hourly autonomous action:
 *   bucketedIdempotencyKey({
 *     ruleName: "send_morning_brief",
 *     userId: "nour",
 *   }, 6 * 60 * 60)
 */
export function bucketedIdempotencyKey(
  parts: Record<string, unknown>,
  bucketSeconds: number,
  now: number = Date.now(),
): string {
  const bucket = Math.floor(now / 1000 / bucketSeconds) * bucketSeconds;
  return mintIdempotencyKey({ ...parts, _bucket: bucket });
}

mintIdempotencyKey.bucketed = bucketedIdempotencyKey;

// ─────────────────────────────────────────────────────────────────
// UPSERT WRAPPER
// ─────────────────────────────────────────────────────────────────

/**
 * Minimal interface for any Prisma model that has an
 * `idempotencyKey` field + supports findFirst + create. Generic
 * over the row type so call sites keep their strong types.
 */
interface IdempotentModel<TRow, TCreateInput> {
  findFirst(args: {
    where: { idempotencyKey: string };
  }): Promise<TRow | null>;
  create(args: { data: TCreateInput }): Promise<TRow>;
}

interface IdempotentCreateOpts<TRow, TCreateInput> {
  /** The Prisma model (e.g. prisma.autonomousAction). */
  model: IdempotentModel<TRow, TCreateInput>;
  /** Idempotency key. Already minted by caller. */
  key: string;
  /** Data for the create call (must include idempotencyKey: key). */
  data: TCreateInput;
}

interface IdempotentCreateResult<TRow> {
  row: TRow;
  /** True when this call inserted; false when a prior row was returned. */
  created: boolean;
}

/**
 * Idempotent create. Returns the existing row when the key collides,
 * else inserts. Race-safe via P2002 catch (two concurrent inserts).
 *
 * The caller is responsible for setting `data.idempotencyKey = key`.
 * (We don't merge it in to keep TCreateInput strict — runtime check
 * verifies it matches.)
 */
export async function idempotentCreate<TRow, TCreateInput>(
  opts: IdempotentCreateOpts<TRow, TCreateInput>,
): Promise<IdempotentCreateResult<TRow>> {
  const { model, key, data } = opts;

  // Sanity check: caller forgot to thread the key into data
  if (
    !data ||
    typeof data !== "object" ||
    (data as Record<string, unknown>).idempotencyKey !== key
  ) {
    throw new Error(
      `idempotentCreate: data.idempotencyKey must equal the key passed in (${key})`,
    );
  }

  // 1. Fast path — was this already done?
  const existing = await model.findFirst({ where: { idempotencyKey: key } });
  if (existing) {
    return { row: existing, created: false };
  }

  // 2. Try to insert. If two callers raced the findFirst, the second
  //    will hit P2002 — recover by reading the winner's row.
  try {
    const row = await model.create({ data });
    return { row, created: true };
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "P2002") {
      const existingAfterRace = await model.findFirst({
        where: { idempotencyKey: key },
      });
      if (existingAfterRace) {
        return { row: existingAfterRace, created: false };
      }
    }
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────
// CONVENTIONS
// ─────────────────────────────────────────────────────────────────

/**
 * Standard idempotency key recipes for the 6 tables the migration
 * touches. Use these so all crons and event paths produce
 * predictable, collision-prone keys for the legitimate retry case.
 */
export const idempotencyRecipe = {
  autonomousAction: (parts: {
    ruleName: string;
    targetType?: string | null;
    targetId?: string | null;
    /** Cron cadence in seconds — typical 5min (300) for hot rules,
     *  6h (21600) for daily ones. */
    bucketSeconds: number;
  }): string =>
    bucketedIdempotencyKey(
      {
        ruleName: parts.ruleName,
        targetType: parts.targetType ?? "",
        targetId: parts.targetId ?? "",
      },
      parts.bucketSeconds,
    ),

  scheduledAction: (parts: {
    actionType: string;
    entityType: string;
    entityId: string;
    scheduledFor: Date | string;
  }): string =>
    mintIdempotencyKey({
      actionType: parts.actionType,
      entityType: parts.entityType,
      entityId: parts.entityId,
      scheduledFor:
        parts.scheduledFor instanceof Date
          ? parts.scheduledFor.toISOString()
          : parts.scheduledFor,
    }),

  taskEvent: (parts: {
    taskId: string;
    kind: string;
    payloadHash?: string;
    bucketSeconds?: number;
  }): string =>
    bucketedIdempotencyKey(
      {
        taskId: parts.taskId,
        kind: parts.kind,
        payloadHash: parts.payloadHash ?? "",
      },
      parts.bucketSeconds ?? 60, // default 1-minute bucket
    ),

  goalEvent: (parts: {
    goalId: string;
    kind: string;
    payloadHash?: string;
    bucketSeconds?: number;
  }): string =>
    bucketedIdempotencyKey(
      {
        goalId: parts.goalId,
        kind: parts.kind,
        payloadHash: parts.payloadHash ?? "",
      },
      parts.bucketSeconds ?? 60,
    ),

  reflection: (parts: {
    date: string; // YYYY-MM-DD
    scope: string;
    category: string;
  }): string =>
    mintIdempotencyKey({
      date: parts.date,
      scope: parts.scope,
      category: parts.category,
    }),

  decisionReplay: (parts: {
    decisionId: number | null;
    reviewAt: Date | string;
  }): string =>
    mintIdempotencyKey({
      decisionId: parts.decisionId ?? "null",
      reviewAt:
        parts.reviewAt instanceof Date
          ? parts.reviewAt.toISOString()
          : parts.reviewAt,
    }),
};
