/**
 * Universal soft-delete helpers · v7.9 · Apr 29.
 *
 * Phase 1 item #4 of the schema-audit hardening. Adds a nullable
 * `deletedAt: DateTime?` column + b-tree index to nine high-value
 * tables that were previously hard-deleted:
 *
 *   missions, tasks, mastery_decisions, commitments, brain_dumps,
 *   brain_memories, reflections, identity_snapshots, life_goals
 *
 * Soft-delete contract:
 *
 *   · `deletedAt = null`     → row is alive (default).
 *   · `deletedAt = now()`    → row is hidden from default queries.
 *   · clear `deletedAt`      → row is restored.
 *
 * Why soft-delete (vs hard-delete):
 *   · Brain layer mines patterns from "things Nour gave up on"
 *     (dropped goals, stale tasks, retracted decisions). Hard-delete
 *     erases that signal forever.
 *   · Audit / undo: a stray click in a UI shouldn't cost data.
 *   · Crons can re-emit a Reflection or IdentitySnapshot for the same
 *     day without losing the prior version's id (foreign keys etc).
 *
 * Why a helper module (vs inline `update({ data: { deletedAt: new Date() } })`):
 *   · One place to add audit logging when delete reasons get tracked.
 *   · Consistent return shape (`{ ok, before, after }`) for telemetry.
 *   · `findManyActive` / `findUniqueActive` save callers from
 *     hand-writing the `deletedAt: null` filter on every read.
 *
 * Tables NOT yet wired (intentional — TTL / append-only / no churn):
 *   chat_messages → already has soft-conversation via Conversation.deletedAt
 *   audit_logs / events / predictions → append-only, never deleted
 *   memory_edges → cascade-deleted with their source/target
 */

import { prisma } from "@/lib/prisma";
import { currentActor } from "@/lib/db/actor";
import { logSoftDelete, logRestore } from "@/lib/db/entity-audit";

// ─────────────────────────────────────────────────────────────────
// SUPPORTED MODELS
// ─────────────────────────────────────────────────────────────────

/**
 * The exact set of Prisma model client keys that have a `deletedAt`
 * column. Adding a new soft-delete-eligible table?
 *   1. Add `deletedAt DateTime? @map("deleted_at")` + `@@index([deletedAt])`
 *      to schema.prisma
 *   2. Add an ALTER TABLE entry to a fresh migration
 *   3. Add the model key here
 *   4. The helpers below light up automatically (typed).
 */
export const SOFT_DELETE_MODELS = [
  "mission",
  "task",
  "masteryDecision",
  "commitment",
  "brainDump",
  "brainMemory",
  "reflection",
  "identitySnapshot",
  "lifeGoal",
  // v10.0.148 · May 03 · Policy registry retire path. Lets an
  // operator soft-retire an automation rule without losing the
  // audit trail of "this used to exist."
  "automationPolicy",
] as const;

export type SoftDeleteModel = (typeof SOFT_DELETE_MODELS)[number];

/** Type guard — is this model in the soft-delete set? */
export function isSoftDeleteModel(s: string): s is SoftDeleteModel {
  return (SOFT_DELETE_MODELS as readonly string[]).includes(s);
}

// Loose Prisma model delegate type — every soft-delete model exposes
// these methods. We don't pull from `Prisma.ModelName` because the
// generated types churn between Prisma versions.
type ModelDelegate = {
  findUnique: (args: { where: object }) => Promise<unknown>;
  findFirst: (args: { where?: object; include?: object }) => Promise<unknown>;
  findMany: (args?: {
    where?: object;
    orderBy?: object;
    take?: number;
    skip?: number;
    include?: object;
    select?: object;
  }) => Promise<unknown[]>;
  count: (args?: { where?: object }) => Promise<number>;
  update: (args: { where: object; data: object }) => Promise<unknown>;
  updateMany: (args: { where: object; data: object }) => Promise<{ count: number }>;
};

function getDelegate(model: SoftDeleteModel): ModelDelegate {
   
  const d = (prisma as any)[model];
  if (!d || typeof d.update !== "function") {
    throw new Error(`soft-delete: unknown model "${model}"`);
  }
  return d as ModelDelegate;
}

// ─────────────────────────────────────────────────────────────────
// SOFT-DELETE / RESTORE
// ─────────────────────────────────────────────────────────────────

export interface SoftDeleteResult<T = unknown> {
  ok: boolean;
  /** Row state after the operation (or null when not found). */
  row: T | null;
  /** Was this a no-op (already deleted / already alive)? */
  noop: boolean;
  /** Actor that performed the operation, captured from async context. */
  actor: string;
}

/**
 * Mark a row deleted by id. Idempotent — if already deleted, returns
 * `noop: true` without changing `deletedAt` (preserves the original
 * delete timestamp).
 */
export async function softDelete<T = unknown>(
  model: SoftDeleteModel,
  where: { id: string } | object,
): Promise<SoftDeleteResult<T>> {
  const delegate = getDelegate(model);
  const actor = currentActor();

  // Read current state to detect already-deleted (so we can no-op).
  const before = (await delegate.findUnique({ where })) as
    | { id: string; deletedAt: Date | null }
    | null;

  if (!before) {
    return { ok: false, row: null, noop: false, actor };
  }
  if (before.deletedAt) {
    return { ok: true, row: before as T, noop: true, actor };
  }

  const row = (await delegate.update({
    where,
    data: { deletedAt: new Date() },
  })) as T;

  // v8.0 Phase 2A — emit audit row. Fire-and-forget; logSoftDelete
  // never throws, but we still don't await blocking the success path.
  void logSoftDelete(model, before.id, { source: "lib/db/soft-delete" });

  return { ok: true, row, noop: false, actor };
}

/**
 * Clear `deletedAt` to bring a row back. Idempotent — if already
 * alive, returns `noop: true`.
 */
export async function restore<T = unknown>(
  model: SoftDeleteModel,
  where: { id: string } | object,
): Promise<SoftDeleteResult<T>> {
  const delegate = getDelegate(model);
  const actor = currentActor();

  const before = (await delegate.findUnique({ where })) as
    | { id: string; deletedAt: Date | null }
    | null;

  if (!before) {
    return { ok: false, row: null, noop: false, actor };
  }
  if (!before.deletedAt) {
    return { ok: true, row: before as T, noop: true, actor };
  }

  const row = (await delegate.update({
    where,
    data: { deletedAt: null },
  })) as T;

  void logRestore(model, before.id, { source: "lib/db/soft-delete" });

  return { ok: true, row, noop: false, actor };
}

/**
 * Soft-delete every row matching `where`. Useful for "delete all my
 * BrainDumps from yesterday" kind of operations. Returns the count.
 */
export async function softDeleteMany(
  model: SoftDeleteModel,
  where: object,
): Promise<{ count: number; actor: string }> {
  const delegate = getDelegate(model);
  const actor = currentActor();

  // Only target alive rows so a re-run doesn't bump deletedAt timestamps.
  const result = await delegate.updateMany({
    where: { ...where, deletedAt: null },
    data: { deletedAt: new Date() },
  });

  return { count: result.count, actor };
}

/**
 * Restore every row matching `where`. Symmetrical to softDeleteMany.
 */
export async function restoreMany(
  model: SoftDeleteModel,
  where: object,
): Promise<{ count: number; actor: string }> {
  const delegate = getDelegate(model);
  const actor = currentActor();

  const result = await delegate.updateMany({
    where: { ...where, NOT: { deletedAt: null } },
    data: { deletedAt: null },
  });

  return { count: result.count, actor };
}

// ─────────────────────────────────────────────────────────────────
// READ HELPERS — auto-filter alive rows
// ─────────────────────────────────────────────────────────────────

/**
 * Merge `{ deletedAt: null }` into a `where` object. If `where`
 * already explicitly mentions `deletedAt`, the caller's value wins
 * (escape hatch for "show me everything" admin views).
 */
export function activeOnly<W extends object | undefined>(where?: W): object {
  if (!where) return { deletedAt: null };
  if ("deletedAt" in (where as object)) return where as object;
  return { ...(where as object), deletedAt: null };
}

/**
 * Same as activeOnly but inverse — returns only soft-deleted rows.
 * For admin / undo UIs.
 */
export function deletedOnly<W extends object | undefined>(where?: W): object {
  if (!where) return { NOT: { deletedAt: null } };
  if ("deletedAt" in (where as object)) return where as object;
  return { ...(where as object), NOT: { deletedAt: null } };
}

/**
 * Drop-in replacement for `prisma.<model>.findMany` that auto-filters
 * to alive rows. All other args pass through unchanged.
 *
 *   const tasks = await findManyActive("task", {
 *     where: { ownerId: "x" },
 *     orderBy: { createdAt: "desc" },
 *     take: 50,
 *   });
 */
export async function findManyActive<T = unknown>(
  model: SoftDeleteModel,
  args: Parameters<ModelDelegate["findMany"]>[0] = {},
): Promise<T[]> {
  const delegate = getDelegate(model);
  return (await delegate.findMany({
    ...args,
    where: activeOnly(args?.where),
  })) as T[];
}

/**
 * Drop-in replacement for `findFirst` that auto-filters to alive.
 */
export async function findFirstActive<T = unknown>(
  model: SoftDeleteModel,
  args: Parameters<ModelDelegate["findFirst"]>[0] = {},
): Promise<T | null> {
  const delegate = getDelegate(model);
  return (await delegate.findFirst({
    ...args,
    where: activeOnly(args?.where),
  })) as T | null;
}

/**
 * Count of alive rows matching `where`.
 */
export async function countActive(
  model: SoftDeleteModel,
  where?: object,
): Promise<number> {
  const delegate = getDelegate(model);
  return delegate.count({ where: activeOnly(where) });
}

// ─────────────────────────────────────────────────────────────────
// CONVENIENCE: per-model bound API
// ─────────────────────────────────────────────────────────────────

/**
 * Curry a model name into a small object so call sites read naturally:
 *
 *   const tasks = softDeleteFor("task");
 *   await tasks.delete({ id: "t1" });
 *   await tasks.restore({ id: "t1" });
 *   const alive = await tasks.findManyActive({ where: { ownerId: "x" } });
 *
 * Same semantics as the free functions; just nicer at the call site.
 */
export function softDeleteFor(model: SoftDeleteModel) {
  return {
    delete: <T = unknown>(where: { id: string } | object) =>
      softDelete<T>(model, where),
    restore: <T = unknown>(where: { id: string } | object) =>
      restore<T>(model, where),
    deleteMany: (where: object) => softDeleteMany(model, where),
    restoreMany: (where: object) => restoreMany(model, where),
    findManyActive: <T = unknown>(
      args: Parameters<ModelDelegate["findMany"]>[0] = {},
    ) => findManyActive<T>(model, args),
    findFirstActive: <T = unknown>(
      args: Parameters<ModelDelegate["findFirst"]>[0] = {},
    ) => findFirstActive<T>(model, args),
    countActive: (where?: object) => countActive(model, where),
  };
}
