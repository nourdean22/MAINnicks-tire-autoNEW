/**
 * Authenticated operator quality-override (Creative Compiler 2.0 Milestone 1).
 *
 * When the quality-automation engine returns REQUEST_OPERATOR_DECISION for
 * ADVISORY findings (critic severity "warn" | "repair" — mild inconsistency,
 * weak composition, a visible-but-non-deceptive AI artifact, a knowingly
 * accepted misspelled visual element), an authenticated operator may publish the
 * asset anyway. The decision is recorded BOUND TO THE EXACT
 * (inventoryId, assetVersion, contentHash):
 *   - a re-render / caption / audio / metadata change alters the hash and
 *     invalidates the override (verified at consume time);
 *   - it is consumed ATOMICALLY when publication begins (no double-use);
 *   - it can NEVER accept a "block"-severity finding, and the caller MUST still
 *     re-run every hard gate (claim safety, rights, approval integrity, kill
 *     switch, account, platform policy, hash match) regardless of the override.
 *
 * Hash parity with the approval path: contentHash === the approval record's
 * mediaHash (contentApprovals.computeMediaHash), so "same bytes the operator
 * saw" is the same check the approval integrity gate already makes.
 */
import { randomUUID } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { operatorQualityOverrides } from "../../drizzle/schema";
import type { DB } from "../db";
import { createLogger } from "../lib/logger";

const log = createLogger("services:operator-override");

/** How long a publish-anyway decision stays valid. Short by design: an override
 *  is a decision about a specific asset the operator just looked at. */
export const OVERRIDE_TTL_HOURS = 24;

/** Severities an operator MAY accept. "block" is a hard gate — never overridable. */
export const OVERRIDABLE_SEVERITIES = ["warn", "repair"] as const;
export type OverridableSeverity = (typeof OVERRIDABLE_SEVERITIES)[number];

export interface OverrideFinding {
  findingId: string;
  severity: "warn" | "repair" | "block";
}

/** A finding is overridable iff it is advisory (warn|repair). A block finding is
 *  a hard gate and disqualifies the whole override — the operator cannot accept
 *  an unsupported claim, a rights gap, or a policy violation as "taste". */
export function isOverridableFinding(f: { severity: string }): boolean {
  return f.severity === "warn" || f.severity === "repair";
}

export type CreateOverrideResult =
  | { ok: true; overrideId: string; expiresAt: Date }
  | { ok: false; reason: "no_findings" }
  | { ok: false; reason: "contains_hard_block"; blockedFindingIds: string[] };

/**
 * Record a publish-anyway override. Refuses if the operator tried to accept ANY
 * block-severity finding (that path must go through repair or a hard-gate fix,
 * never an override). Binds to the current contentHash + assetVersion.
 */
export async function createOperatorOverride(
  database: DB,
  args: {
    campaignId?: string | null;
    inventoryId: string;
    assetId?: string | null;
    assetVersion: number;
    contentHash: string;
    briefHash: string;
    findings: OverrideFinding[];
    operatorReason: string;
    actorId: number;
    actorEmail?: string | null;
    now?: () => number;
  },
): Promise<CreateOverrideResult> {
  if (!args.findings.length) return { ok: false, reason: "no_findings" };
  const hardBlocks = args.findings.filter((f) => !isOverridableFinding(f));
  if (hardBlocks.length) {
    return { ok: false, reason: "contains_hard_block", blockedFindingIds: hardBlocks.map((f) => f.findingId) };
  }
  const now = args.now ? args.now() : Date.now();
  const overrideId = `ovr_${randomUUID()}`;
  const expiresAt = new Date(now + OVERRIDE_TTL_HOURS * 3600_000);
  const severities = [...new Set(args.findings.map((f) => f.severity))];
  // Guarantee at most ONE active override per (inventoryId, assetVersion): a new
  // acceptance supersedes any prior active one, so a stale active row can never
  // mask this newer valid override when consume selects a single active row.
  try {
    await database.update(operatorQualityOverrides)
      .set({ state: "superseded" })
      .where(and(
        eq(operatorQualityOverrides.inventoryId, args.inventoryId),
        eq(operatorQualityOverrides.assetVersion, args.assetVersion),
        eq(operatorQualityOverrides.state, "active"),
      ));
  } catch (err) {
    log.warn("supersede prior overrides skipped (table pending 0089?)", { err: err instanceof Error ? err.message.slice(0, 120) : String(err) });
  }
  await database.insert(operatorQualityOverrides).values({
    id: overrideId,
    campaignId: args.campaignId ?? null,
    inventoryId: args.inventoryId,
    assetId: args.assetId ?? null,
    assetVersion: args.assetVersion,
    contentHash: args.contentHash,
    briefHash: args.briefHash,
    action: "publish_anyway",
    acceptedFindingIds: JSON.stringify(args.findings.map((f) => f.findingId)),
    acceptedSeverities: JSON.stringify(severities),
    operatorReason: args.operatorReason,
    actorId: args.actorId,
    actorEmail: args.actorEmail ?? null,
    state: "active",
    expiresAt,
  });
  log.info("operator quality-override recorded", { overrideId, inventoryId: args.inventoryId, assetVersion: args.assetVersion, findings: args.findings.length });
  return { ok: true, overrideId, expiresAt };
}

export type OverrideConsumption =
  | { ok: true; overrideId: string; acceptedFindingIds: string[] }
  | { ok: false; reason: "none" | "expired" | "hash_mismatch" | "lost_race" };

/**
 * Find an ACTIVE override for (inventoryId, assetVersion), confirm it binds to
 * the CURRENT contentHash, and consume it ATOMICALLY (active -> consumed). Any
 * mismatch flips it to expired/invalidated and returns the reason — it NEVER
 * force-publishes. This is the ONLY thing an override does; the caller re-runs
 * every hard gate independently.
 */
export async function consumeOverrideForPublish(
  database: DB,
  args: { inventoryId: string; assetVersion: number; currentContentHash: string; currentBriefHash: string; now?: () => number },
): Promise<OverrideConsumption> {
  const now = args.now ? args.now() : Date.now();
  // Deploy-safe: this runs on EVERY reel publish, but the table may not exist yet
  // (0089 is hand-applied by the operator). A missing table / query error means
  // "no override" — the publish proceeds on the approval, never wedged. Once the
  // migration lands, overrides activate with no code change.
  let rows: Array<typeof operatorQualityOverrides.$inferSelect>;
  try {
    rows = await database
      .select()
      .from(operatorQualityOverrides)
      .where(and(
        eq(operatorQualityOverrides.inventoryId, args.inventoryId),
        eq(operatorQualityOverrides.assetVersion, args.assetVersion),
        eq(operatorQualityOverrides.state, "active"),
      ))
      .orderBy(desc(operatorQualityOverrides.createdAt)) // newest active first — never mask a newer override with a stale one
      .limit(1);
  } catch (err) {
    log.warn("override lookup skipped (table pending 0089?)", { err: err instanceof Error ? err.message.slice(0, 120) : String(err) });
    return { ok: false, reason: "none" };
  }
  if (!rows.length) return { ok: false, reason: "none" };
  const ov = rows[0];

  if (new Date(ov.expiresAt).getTime() < now) {
    await database.update(operatorQualityOverrides).set({ state: "expired" }).where(eq(operatorQualityOverrides.id, ov.id));
    log.warn("override expired at publish", { overrideId: ov.id });
    return { ok: false, reason: "expired" };
  }
  // Exact-hash binding: a re-render (media hash) or a caption/metadata edit
  // (brief hash) changed what the operator accepted, so the override no longer
  // describes what is about to go live.
  if (ov.contentHash !== args.currentContentHash || ov.briefHash !== args.currentBriefHash) {
    await database.update(operatorQualityOverrides).set({ state: "invalidated" }).where(eq(operatorQualityOverrides.id, ov.id));
    log.warn("override invalidated — content or brief hash changed since acceptance", { overrideId: ov.id });
    return { ok: false, reason: "hash_mismatch" };
  }
  // Atomic consume — the active->consumed CAS prevents two concurrent publishes
  // from both using one override (mirrors selectiveRepair's claim gate).
  const { affectedRowCount } = await import("../lib/db-affected");
  const updRes = await database
    .update(operatorQualityOverrides)
    .set({ state: "consumed", consumedAt: new Date(now) })
    .where(and(eq(operatorQualityOverrides.id, ov.id), eq(operatorQualityOverrides.state, "active")));
  if (affectedRowCount(updRes) !== 1) {
    log.warn("override lost the consume race", { overrideId: ov.id });
    return { ok: false, reason: "lost_race" };
  }
  log.info("operator override consumed at publish", { overrideId: ov.id, inventoryId: args.inventoryId });
  return { ok: true, overrideId: ov.id, acceptedFindingIds: JSON.parse(ov.acceptedFindingIds) as string[] };
}

/**
 * Return a consumed override to "active" when the publish it authorized never
 * happened (publishToSocial threw before anything went live).
 *
 * Why this exists: consumption is deliberately BEFORE the external call — that
 * ordering is what makes it exactly-once. But it also meant a transport error
 * BURNED the operator's acceptance: the draft rolled back to its prior status
 * and was publishable again, while the override that authorized it was gone, so
 * the retry silently lost the operator's decision and re-blocked. Restoring it
 * keeps the override's lifecycle symmetric with the inventory-status rollback
 * that runs in the same catch.
 *
 * The CAS (consumed -> active) means this can never resurrect an override that
 * was revoked, expired, or invalidated in the meantime, and the hash binding is
 * untouched — a re-render still invalidates it on the next attempt. expiresAt is
 * NOT extended: a failed publish does not buy more time.
 *
 * Caveat, deliberate: a throw is not proof nothing was posted. The caller
 * already restores the inventory status on the same signal, so both artifacts
 * make the same assumption; the reel path parks `publish_ambiguous` instead
 * precisely because there the post may be live.
 */
export async function releaseConsumedOverride(database: DB, overrideId: string): Promise<boolean> {
  const { affectedRowCount } = await import("../lib/db-affected");
  try {
    const res = await database
      .update(operatorQualityOverrides)
      .set({ state: "active", consumedAt: null })
      .where(and(eq(operatorQualityOverrides.id, overrideId), eq(operatorQualityOverrides.state, "consumed")));
    const restored = affectedRowCount(res) === 1;
    log.warn(restored ? "override released after a failed publish — operator acceptance preserved" : "override release found nothing to restore", { overrideId });
    return restored;
  } catch (err) {
    // Never let bookkeeping mask the publish error the caller is rethrowing.
    log.warn("override release failed — operator may need to re-accept", { overrideId, err: err instanceof Error ? err.message.slice(0, 120) : String(err) });
    return false;
  }
}

/** Revoke an active override (operator changed their mind before publish). */
export async function revokeOperatorOverride(database: DB, overrideId: string): Promise<boolean> {
  const { affectedRowCount } = await import("../lib/db-affected");
  const res = await database
    .update(operatorQualityOverrides)
    .set({ state: "revoked" })
    .where(and(eq(operatorQualityOverrides.id, overrideId), eq(operatorQualityOverrides.state, "active")));
  return affectedRowCount(res) === 1;
}
