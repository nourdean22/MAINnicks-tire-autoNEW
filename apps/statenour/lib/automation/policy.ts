/**
 * Policy registry · v10.0.148 · May 03
 *
 * Canonical service for the AutomationPolicy table — the governance
 * spine that sits on top of every automation surface (cron / tool /
 * slash / autonomous-action / webhook).
 *
 * Pre-fix: rules deciding which actions auto-fire vs queue for approval
 * were scattered across cron files, tool defs, and chat interceptors.
 * Operators couldn't answer "what is allowed to fire automatically
 * right now?" without reading 50 files.
 *
 * Now: every automation has an inspectable record with the six required
 * fields (objective / trigger / inputs / approvalClass / rollback /
 * successMetric). The pending-action approval UI keys off this table.
 *
 * Policy ID convention: `<surface>.<name>` — e.g. `cron.embed-backfill`,
 * `tool.send-email-via-resend`, `slash.save`. The surface prefix means
 * IDs never collide across registries; you can always tell at a glance
 * what kind of automation a policy covers.
 *
 * Approval classes:
 *   · auto      — runs without operator review (read-only, low risk)
 *   · pending   — queues an AutonomousAction needing approval first
 *   · forbidden — coded but disabled (e.g. retired, never-allowed)
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ServiceError } from "@/lib/utils/service-error";
import { logger as rootLogger } from "@/lib/logger";
import { softDelete } from "@/lib/db/soft-delete";

const log = rootLogger.withSurface("automation/policy");

// ─── Types ────────────────────────────────────────────────────────────

export type PolicySurface =
  | "cron"
  | "tool"
  | "slash"
  | "autonomous-action"
  | "webhook";

export type ApprovalClass = "auto" | "pending" | "forbidden";

export type PolicyResult = "success" | "failure" | "pending_approval" | "rolled_back";

export interface PolicyRecord {
  id: string;
  surface: PolicySurface;
  name: string;
  objective: string;
  trigger: string;
  inputs: unknown;
  approvalClass: ApprovalClass;
  rollback: string | null;
  successMetric: string;
  owner: string;
  enabled: boolean;
  lastFiredAt: Date | null;
  lastResult: PolicyResult | null;
  fireCount: number;
  notes: string | null;
  metadata: unknown;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface PolicyUpsertInput {
  id: string; // <surface>.<name>
  surface: PolicySurface;
  name: string;
  objective: string;
  trigger: string;
  inputs?: unknown;
  approvalClass?: ApprovalClass;
  rollback?: string | null;
  successMetric: string;
  owner?: string;
  enabled?: boolean;
  notes?: string | null;
  metadata?: unknown;
  tags?: string[];
}

// ─── Read-side ────────────────────────────────────────────────────────

export async function listPolicies(filter?: {
  surface?: PolicySurface;
  approvalClass?: ApprovalClass;
  enabledOnly?: boolean;
}): Promise<PolicyRecord[]> {
  const rows = await prisma.automationPolicy.findMany({
    where: {
      deletedAt: null,
      ...(filter?.surface ? { surface: filter.surface } : {}),
      ...(filter?.approvalClass ? { approvalClass: filter.approvalClass } : {}),
      ...(filter?.enabledOnly ? { enabled: true } : {}),
    },
    orderBy: [{ surface: "asc" }, { name: "asc" }],
  });
  return rows.map(rowToRecord);
}

export async function getPolicy(id: string): Promise<PolicyRecord | null> {
  const row = await prisma.automationPolicy.findFirst({
    where: { id, deletedAt: null },
  });
  return row ? rowToRecord(row) : null;
}

/**
 * Coverage check — given a list of expected policy IDs (e.g. derived
 * from `config/crons.ts` active entries), return which IDs are missing
 * from the registry. Used by the pre-push gate so a new automation
 * can't ship without a declared policy.
 */
export async function findMissingPolicies(expectedIds: string[]): Promise<string[]> {
  if (expectedIds.length === 0) return [];
  const found = await prisma.automationPolicy.findMany({
    where: { id: { in: expectedIds }, deletedAt: null },
    select: { id: true },
  });
  const foundSet = new Set(found.map((r) => r.id));
  return expectedIds.filter((id) => !foundSet.has(id));
}

// ─── Write-side ───────────────────────────────────────────────────────

/**
 * Upsert by id — used by the seed script + admin UI. Keeps the policy
 * row in sync with the canonical declaration in code without losing
 * operator-edited fields like `enabled` or `notes` if we re-seed.
 */
export async function upsertPolicy(input: PolicyUpsertInput): Promise<PolicyRecord> {
  validatePolicyInput(input);
  // Prisma 6 distinguishes "set to JSON null" (Prisma.JsonNull) from
  // "DB NULL" (Prisma.DbNull) for nullable Json columns. Coerce the
  // service inputs into the shape Prisma expects.
  const inputsJson = jsonOrNull(input.inputs);
  const metadataJson = jsonOrNull(input.metadata);
  const row = await prisma.automationPolicy.upsert({
    where: { id: input.id },
    create: {
      id: input.id,
      surface: input.surface,
      name: input.name,
      objective: input.objective,
      trigger: input.trigger,
      inputs: inputsJson,
      approvalClass: input.approvalClass ?? "auto",
      rollback: input.rollback ?? null,
      successMetric: input.successMetric,
      owner: input.owner ?? "nour",
      enabled: input.enabled ?? true,
      notes: input.notes ?? null,
      metadata: metadataJson,
      tags: input.tags ?? [],
    },
    update: {
      // On re-seed, refresh the declarative fields but preserve
      // operator edits to enabled / notes / metadata. The seed script
      // is the source of truth for objective/trigger/inputs/rollback/
      // successMetric/tags; the operator can override approvalClass
      // through the UI and we don't want a re-seed clobbering that.
      surface: input.surface,
      name: input.name,
      objective: input.objective,
      trigger: input.trigger,
      inputs: inputsJson,
      rollback: input.rollback ?? null,
      successMetric: input.successMetric,
      owner: input.owner ?? "nour",
      tags: input.tags ?? [],
    },
  });
  log.info("policy_upserted", { id: input.id, surface: input.surface });
  return rowToRecord(row);
}

/** Operator-facing toggle — flips approvalClass from the admin UI. */
export async function setApprovalClass(
  id: string,
  approvalClass: ApprovalClass,
): Promise<PolicyRecord> {
  const existing = await prisma.automationPolicy.findFirst({
    where: { id, deletedAt: null },
  });
  if (!existing) throw new ServiceError("Policy not found", 404);
  const row = await prisma.automationPolicy.update({
    where: { id },
    data: { approvalClass },
  });
  log.warn("approval_class_changed", {
    id,
    from: existing.approvalClass,
    to: approvalClass,
  });
  return rowToRecord(row);
}

/** Operator-facing kill-switch — pause without deleting. */
export async function setEnabled(id: string, enabled: boolean): Promise<PolicyRecord> {
  const existing = await prisma.automationPolicy.findFirst({
    where: { id, deletedAt: null },
  });
  if (!existing) throw new ServiceError("Policy not found", 404);
  const row = await prisma.automationPolicy.update({
    where: { id },
    data: { enabled },
  });
  log.info("policy_enabled_changed", { id, enabled });
  return rowToRecord(row);
}

/** Operator-facing notes edit. */
export async function updateNotes(id: string, notes: string | null): Promise<PolicyRecord> {
  const row = await prisma.automationPolicy.update({
    where: { id },
    data: { notes },
  });
  return rowToRecord(row);
}

/**
 * Soft-delete a policy. Used when an automation is fully retired —
 * keeping the row out of the active registry but preserving the
 * audit trail of "this used to exist." `reason` is logged but not
 * persisted on the row directly (operator can write it into `notes`
 * before retiring if they want it permanent).
 */
export async function retirePolicy(id: string, reason: string): Promise<void> {
  await softDelete("automationPolicy", { id });
  log.warn("policy_retired", { id, reason });
}

// ─── Fire-logging ─────────────────────────────────────────────────────

/**
 * Called by the surface implementations themselves (cron wrappers,
 * tool dispatchers, etc.) after every fire. Updates lastFiredAt +
 * lastResult + fireCount so the registry doubles as a health
 * dashboard.
 *
 * Best-effort: a missing policy id is logged as a warning but does
 * not throw — surface implementations can't fail just because their
 * policy entry hasn't been seeded yet (during the rollout window).
 *
 * v10.0.169 — now also inserts an AutomationPolicyFire row for the
 * chronological history.
 */
export async function logPolicyFire(
  id: string,
  result: PolicyResult,
  opts?: {
    resultMessage?: string;
    durationMs?: number;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const now = new Date();
  try {
    // First update the policy summary, then insert fire event only if policy exists
    const updated = await prisma.automationPolicy.updateMany({
      where: { id, deletedAt: null },
      data: {
        lastFiredAt: now,
        lastResult: result,
        fireCount: { increment: 1 },
      },
    });
    if (updated.count === 0) {
      log.warn("policy_fire_missing_registry", { id, result });
      return;
    }
    // Policy exists - insert the fire event. Coerce Json column via
    // jsonOrNull() (Prisma 6's nullable-Json shape requires Prisma.DbNull
    // sentinel rather than literal null).
    await prisma.automationPolicyFire.create({
      data: {
        policyId: id,
        firedAt: now,
        result,
        resultMessage: opts?.resultMessage ?? null,
        durationMs: opts?.durationMs ?? null,
        metadata: jsonOrNull(opts?.metadata),
      },
    });
  } catch (err) {
    log.error("policy_fire_log_failed", {
      id,
      result,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ─── Fire History ───────────────────────────────────────────────────────────

export interface PolicyFireRecord {
  id: string;
  policyId: string;
  firedAt: Date;
  result: string;
  resultMessage: string | null;
  durationMs: number | null;
  metadata: Record<string, unknown> | null;
}

/**
 * Fetch fire history for a specific policy, ordered by most recent first.
 * Useful for rendering chronological history in /system/policies.
 */
export async function getPolicyFireHistory(
  policyId: string,
  opts?: { limit?: number; offset?: number },
): Promise<PolicyFireRecord[]> {
  const fires = await prisma.automationPolicyFire.findMany({
    where: { policyId },
    orderBy: { firedAt: "desc" },
    take: opts?.limit ?? 50,
    skip: opts?.offset ?? 0,
  });
  return fires.map((f) => ({
    id: f.id,
    policyId: f.policyId,
    firedAt: f.firedAt,
    result: f.result,
    resultMessage: f.resultMessage,
    durationMs: f.durationMs,
    metadata: f.metadata as Record<string, unknown> | null,
  }));
}

// ─── Helpers ──────────────────────────────────────────────────────────

function rowToRecord(row: {
  id: string;
  surface: string;
  name: string;
  objective: string;
  trigger: string;
  inputs: unknown;
  approvalClass: string;
  rollback: string | null;
  successMetric: string;
  owner: string;
  enabled: boolean;
  lastFiredAt: Date | null;
  lastResult: string | null;
  fireCount: number;
  notes: string | null;
  metadata: unknown;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}): PolicyRecord {
  return {
    id: row.id,
    surface: row.surface as PolicySurface,
    name: row.name,
    objective: row.objective,
    trigger: row.trigger,
    inputs: row.inputs,
    approvalClass: row.approvalClass as ApprovalClass,
    rollback: row.rollback,
    successMetric: row.successMetric,
    owner: row.owner,
    enabled: row.enabled,
    lastFiredAt: row.lastFiredAt,
    lastResult: row.lastResult as PolicyResult | null,
    fireCount: row.fireCount,
    notes: row.notes,
    metadata: row.metadata,
    tags: row.tags,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const VALID_SURFACES: PolicySurface[] = [
  "cron",
  "tool",
  "slash",
  "autonomous-action",
  "webhook",
];
const VALID_APPROVAL: ApprovalClass[] = ["auto", "pending", "forbidden"];

/**
 * Coerce a service-layer JSON input into Prisma's nullable-Json shape.
 * `undefined` → leave the field alone, `null` → DB NULL, anything else
 * is passed through. Prisma.JsonNull would be the right pick if we
 * wanted JSON `null`, but operator-facing semantics here is "no value
 * set" (DB NULL), so DbNull is correct.
 */
function jsonOrNull(
  value: unknown,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (value === undefined || value === null) return Prisma.DbNull;
  return value as Prisma.InputJsonValue;
}

function validatePolicyInput(input: PolicyUpsertInput): void {
  if (!input.id || !input.id.includes(".")) {
    throw new ServiceError(
      `policy id must be "<surface>.<name>" — got "${input.id}"`,
      400,
    );
  }
  const [surfacePart] = input.id.split(".");
  if (surfacePart !== input.surface) {
    throw new ServiceError(
      `policy id surface "${surfacePart}" disagrees with explicit surface "${input.surface}"`,
      400,
    );
  }
  if (!VALID_SURFACES.includes(input.surface)) {
    throw new ServiceError(`invalid surface "${input.surface}"`, 400);
  }
  if (input.approvalClass && !VALID_APPROVAL.includes(input.approvalClass)) {
    throw new ServiceError(
      `invalid approvalClass "${input.approvalClass}"`,
      400,
    );
  }
  if (!input.objective.trim()) {
    throw new ServiceError("policy.objective is required", 400);
  }
  if (!input.trigger.trim()) {
    throw new ServiceError("policy.trigger is required", 400);
  }
  if (!input.successMetric.trim()) {
    throw new ServiceError("policy.successMetric is required", 400);
  }
}
