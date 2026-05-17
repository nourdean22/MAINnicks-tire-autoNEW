/**
 * Universal entity-audit trail · v8.0 · Apr 29 (Phase 2A).
 *
 * Generic provenance helper. Composed on top of v7.8 (actor
 * propagation via AsyncLocalStorage) and v7.9 (soft-delete) to
 * answer:
 *
 *   · "Show me everything Nick has done to my goals this week"
 *   · "What changed in this mission between Mon and Wed?"
 *   · "Who soft-deleted this brain memory and why?"
 *
 * Public surface:
 *   · recordAudit({entityType, entityId, action, before?, after?, reason?, source?})
 *       Single-shot append. Picks up the actor automatically from
 *       async context (currentActor()).
 *   · logCreate(entityType, entityId, after, opts?)
 *   · logUpdate(entityType, entityId, before, after, opts?)
 *   · logSoftDelete(entityType, entityId, opts?)
 *   · logRestore(entityType, entityId, opts?)
 *   · logPurge(entityType, entityId, opts?)
 *       Convenience constructors that pre-fill `action` and only emit
 *       when the diff is non-empty (saves audit-log churn on idempotent
 *       no-op updates).
 *
 *       Names use the `log*` prefix to avoid colliding with the v7.8
 *       `auditCreate()` / `auditUpdate()` helpers in lib/db/actor.ts
 *       (those return createdBy/updatedBy spread shapes; these return
 *       Promise<boolean>).
 *   · diffData(before, after) — shallow JSON-safe diff. Returns
 *       {beforeDiff, afterDiff, changedKeys}. Used internally and
 *       exposed for callers building richer audit reasons.
 *   · getEntityHistory(entityType, entityId, opts?) — read helper
 *       for the API endpoint and admin UI.
 *
 * Performance + safety notes:
 *   · Audit writes are fire-and-forget at the call site (we await
 *     the create but never throw — a logging failure must not break
 *     the user's mutation). Errors are console.warn'd.
 *   · Idempotency: each emit auto-mints a 5s-bucket key from
 *     {entityType + entityId + action + diff-hash}. Concurrent same-
 *     state writes collapse to one audit row.
 *   · before/after store ONLY changed fields (the diff), not the full
 *     row. Saves bytes + makes the log readable.
 */

import { prisma } from "@/lib/prisma";
import { currentActor, type Actor } from "@/lib/db/actor";
import { mintIdempotencyKey, bucketedIdempotencyKey } from "@/lib/db/idempotency";
import { publish as publishBus } from "@/lib/db/brain-bus";

// ─────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────

export type AuditAction =
  | "created"
  | "updated"
  | "soft_deleted"
  | "restored"
  | "purged";

export interface RecordAuditInput {
  entityType: string;
  entityId: string;
  action: AuditAction;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string | null;
  source?: string | null;
  /**
   * Override the auto-resolved actor. Use sparingly — the default
   * (`currentActor()`) is correct in 99% of cases.
   */
  actor?: Actor;
}

export interface AuditEntry {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  actor: string;
  before: unknown;
  after: unknown;
  reason: string | null;
  source: string | null;
  createdAt: Date;
}

// ─────────────────────────────────────────────────────────────────
// DIFF
// ─────────────────────────────────────────────────────────────────

/**
 * Shallow diff: returns the changed-keys subset of two records.
 * `null` and `undefined` are treated as equivalent (DB nullable
 * round-trip safety). Non-primitive fields are compared by JSON
 * stringify, which is fine for our use case (Prisma rows + plain
 * data objects).
 *
 *   diffData({a: 1, b: 2}, {a: 1, b: 3}) →
 *     { beforeDiff: {b: 2}, afterDiff: {b: 3}, changedKeys: ["b"] }
 *
 * Returns empty diffs (`{}`/`[]`) when the inputs are identical.
 */
export function diffData(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): {
  beforeDiff: Record<string, unknown>;
  afterDiff: Record<string, unknown>;
  changedKeys: string[];
} {
  const b = before ?? {};
  const a = after ?? {};
  const allKeys = new Set([...Object.keys(b), ...Object.keys(a)]);
  const beforeDiff: Record<string, unknown> = {};
  const afterDiff: Record<string, unknown> = {};
  const changedKeys: string[] = [];

  for (const key of allKeys) {
    const bv = b[key];
    const av = a[key];
    if (eq(bv, av)) continue;
    beforeDiff[key] = bv ?? null;
    afterDiff[key] = av ?? null;
    changedKeys.push(key);
  }

  return { beforeDiff, afterDiff, changedKeys };
}

function eq(x: unknown, y: unknown): boolean {
  if (x === y) return true;
  if (x == null && y == null) return true;
  if (x == null || y == null) return false;
  if (x instanceof Date && y instanceof Date) return x.getTime() === y.getTime();
  // Best-effort structural compare for objects/arrays. Cheap and
  // correct for our row shapes.
  try {
    return JSON.stringify(x) === JSON.stringify(y);
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────
// WRITE
// ─────────────────────────────────────────────────────────────────

/**
 * Append an audit row. Never throws — a logging failure must not
 * break the caller's transaction. Returns true when the row was
 * written, false when suppressed or errored.
 */
export async function recordAudit(input: RecordAuditInput): Promise<boolean> {
  try {
    const actor = input.actor ?? currentActor();
    // Auto-mint idempotency key in a 5s bucket so concurrent retries
    // collapse. Diff hash is included so distinct mutations of the
    // same entity within the bucket don't collide.
    const diffHash = mintIdempotencyKey({
      before: input.before ?? null,
      after: input.after ?? null,
    });
    const idempotencyKey = bucketedIdempotencyKey(
      {
        entityType: input.entityType,
        entityId: input.entityId,
        action: input.action,
        diffHash,
      },
      5,
    );

    // Race-safe: catch the unique-violation when two concurrent
    // writes collide on the same idempotency key. The first write
    // wins; the second is silently dropped.
    await prisma.entityAudit
      .create({
        data: {
          entityType: input.entityType.slice(0, 64),
          entityId: input.entityId,
          action: input.action,
          actor,
          before: (input.before ?? undefined) as object | undefined,
          after: (input.after ?? undefined) as object | undefined,
          reason: input.reason ?? null,
          source: input.source ?? null,
          idempotencyKey,
        },
      })
      .catch((err: { code?: string }) => {
        if (err?.code === "P2002") return; // dup, fine
        throw err;
      });

    // v8.7 BATCH 41 — publish to the brain bus so subscribers can
    // react without polling. Fire-and-forget; never blocks the
    // audit-write path. Channel: "entity_audit" with the envelope
    // shape carrying entityType/entityId/action/actor for routing.
    void publishBus("entity_audit", {
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      actor,
      reason: input.reason ?? null,
      source: input.source ?? null,
    }).catch(() => {
      // Bus failures are silent — we already wrote the audit row.
    });

    return true;
  } catch (err) {
    console.warn("[entity-audit] write failed:", err);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────
// CONVENIENCE CONSTRUCTORS
// ─────────────────────────────────────────────────────────────────

interface AuditOpts {
  reason?: string | null;
  source?: string | null;
  actor?: Actor;
}

/**
 * Audit a `create`. `after` is the full create payload (we have no
 * before-state for a brand-new row).
 */
export function logCreate(
  entityType: string,
  entityId: string,
  after: Record<string, unknown>,
  opts: AuditOpts = {},
): Promise<boolean> {
  return recordAudit({
    entityType,
    entityId,
    action: "created",
    after,
    ...opts,
  });
}

/**
 * Audit an `update`. Computes the diff internally and skips emitting
 * when nothing actually changed (so a `prisma.update` that no-ops
 * because the new value equals the old doesn't pollute the log).
 */
export async function logUpdate(
  entityType: string,
  entityId: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  opts: AuditOpts = {},
): Promise<boolean> {
  const { beforeDiff, afterDiff, changedKeys } = diffData(before, after);
  if (changedKeys.length === 0) return false;
  return recordAudit({
    entityType,
    entityId,
    action: "updated",
    before: beforeDiff,
    after: afterDiff,
    ...opts,
  });
}

export function logSoftDelete(
  entityType: string,
  entityId: string,
  opts: AuditOpts = {},
): Promise<boolean> {
  return recordAudit({
    entityType,
    entityId,
    action: "soft_deleted",
    ...opts,
  });
}

export function logRestore(
  entityType: string,
  entityId: string,
  opts: AuditOpts = {},
): Promise<boolean> {
  return recordAudit({
    entityType,
    entityId,
    action: "restored",
    ...opts,
  });
}

export function logPurge(
  entityType: string,
  entityId: string,
  opts: AuditOpts = {},
): Promise<boolean> {
  return recordAudit({
    entityType,
    entityId,
    action: "purged",
    ...opts,
  });
}

// ─────────────────────────────────────────────────────────────────
// READ
// ─────────────────────────────────────────────────────────────────

export interface GetHistoryOpts {
  /** Cap rows returned; defaults to 50, max 500. */
  limit?: number;
  /** Skip rows for pagination. */
  offset?: number;
  /** Only return entries newer than this. */
  since?: Date;
  /** Only return rows by this actor (e.g. "nick" or "cron:brain-cycle"). */
  actor?: string;
  /** Only return entries matching this action verb. */
  action?: AuditAction;
}

/**
 * Read the audit history for one entity, newest first. Drives the
 * /api/audit/entity endpoint + the admin "history" tab.
 */
export async function getEntityHistory(
  entityType: string,
  entityId: string,
  opts: GetHistoryOpts = {},
): Promise<AuditEntry[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);

  const where: Record<string, unknown> = { entityType, entityId };
  if (opts.since) where.createdAt = { gte: opts.since };
  if (opts.actor) where.actor = opts.actor;
  if (opts.action) where.action = opts.action;

  const rows = await prisma.entityAudit.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    skip: offset,
    select: {
      id: true,
      entityType: true,
      entityId: true,
      action: true,
      actor: true,
      before: true,
      after: true,
      reason: true,
      source: true,
      createdAt: true,
    },
  });

  return rows as AuditEntry[];
}

/**
 * Read recent audits across the WHOLE system, no actor filter.
 * Drives the /brain/continuity firehose strip — "what's been happening
 * in Nick's head across every surface in the last N hours."
 */
export async function getGlobalActivity(
  opts: { limit?: number; since?: Date } = {},
): Promise<AuditEntry[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const where: Record<string, unknown> = {};
  if (opts.since) where.createdAt = { gte: opts.since };

  const rows = await prisma.entityAudit.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      entityType: true,
      entityId: true,
      action: true,
      actor: true,
      before: true,
      after: true,
      reason: true,
      source: true,
      createdAt: true,
    },
  });

  return rows as AuditEntry[];
}

/**
 * Read recent audits by actor. Drives "what did Nick do today?"
 * and "show me cron activity" admin views.
 */
export async function getActorActivity(
  actor: string,
  opts: { limit?: number; since?: Date } = {},
): Promise<AuditEntry[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const where: Record<string, unknown> = { actor };
  if (opts.since) where.createdAt = { gte: opts.since };

  const rows = await prisma.entityAudit.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      entityType: true,
      entityId: true,
      action: true,
      actor: true,
      before: true,
      after: true,
      reason: true,
      source: true,
      createdAt: true,
    },
  });

  return rows as AuditEntry[];
}

/**
 * Strip non-audit-relevant noise fields from a row before diffing.
 * Saves audit log space on `updatedAt` / Prisma-managed columns
 * that flip every save.
 */
const NOISE_KEYS = new Set([
  "updatedAt",
  "updated_at",
  "createdAt",
  "created_at",
  "lastSeen",
  "last_seen",
]);

export function stripNoise<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(row)) {
    if (NOISE_KEYS.has(k)) continue;
    out[k] = row[k];
  }
  return out as T;
}
