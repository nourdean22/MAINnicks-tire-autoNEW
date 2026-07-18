/**
 * Operator quality-override (Creative Compiler 2.0 Milestone 1). Proves the
 * exact-hash publish-anyway path: an operator accepts ADVISORY findings, the
 * override is recorded bound to the exact (contentHash, briefHash), it is
 * consumed atomically at publish, a block finding can never be accepted, and any
 * render/caption change invalidates it.
 */
import { describe, expect, it } from "vitest";
import {
  isOverridableFinding,
  createOperatorOverride,
  consumeOverrideForPublish,
  revokeOperatorOverride,
  releaseConsumedOverride,
} from "./services/operatorOverride";

// Minimal fake of the drizzle surface the service touches. select().limit()
// returns a preloaded result; update() returns a configurable affectedRows.
function makeDb() {
  const state = {
    inserted: [] as Record<string, unknown>[],
    updated: [] as Record<string, unknown>[],
    selectResult: [] as Record<string, unknown>[],
    updateAffected: 1,
  };
  const db = {
    insert: () => ({ values: async (row: Record<string, unknown>) => { state.inserted.push(row); return [{ affectedRows: 1 }]; } }),
    select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => state.selectResult }) }) }) }),
    update: () => ({ set: (vals: Record<string, unknown>) => ({ where: async () => { state.updated.push(vals); return [{ affectedRows: state.updateAffected }]; } }) }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { db: db as any, state };
}

const ADVISORY = [
  { findingId: "f_artifact", severity: "repair" as const },
  { findingId: "f_pacing", severity: "warn" as const },
];

describe("finding classification (advisory vs hard)", () => {
  it("warn and repair are overridable; block is a hard gate", () => {
    expect(isOverridableFinding({ severity: "warn" })).toBe(true);
    expect(isOverridableFinding({ severity: "repair" })).toBe(true);
    expect(isOverridableFinding({ severity: "block" })).toBe(false);
  });
});

describe("createOperatorOverride", () => {
  it("records a publish-anyway override for advisory findings, bound to both hashes", async () => {
    const { db, state } = makeDb();
    const res = await createOperatorOverride(db, {
      inventoryId: "inv_1", assetVersion: 3, contentHash: "media_hash", briefHash: "brief_hash",
      findings: ADVISORY, operatorReason: "accept the minor artifact, ship it", actorId: 7, actorEmail: "op@nick",
    });
    expect(res.ok).toBe(true);
    expect(state.inserted).toHaveLength(1);
    const row = state.inserted[0];
    expect(row.state).toBe("active");
    expect(row.action).toBe("publish_anyway");
    expect(row.contentHash).toBe("media_hash");
    expect(row.briefHash).toBe("brief_hash");
    expect(row.actorId).toBe(7);
    expect(JSON.parse(row.acceptedFindingIds as string)).toEqual(["f_artifact", "f_pacing"]);
    expect(JSON.parse(row.acceptedSeverities as string).sort()).toEqual(["repair", "warn"]);
  });

  it("REFUSES to accept a block-severity finding — a hard gate is never overridable", async () => {
    const { db, state } = makeDb();
    const res = await createOperatorOverride(db, {
      inventoryId: "inv_1", assetVersion: 3, contentHash: "h", briefHash: "b",
      findings: [{ findingId: "f_ok", severity: "repair" }, { findingId: "f_claim", severity: "block" }],
      operatorReason: "trying to sneak a claim past", actorId: 7,
    });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.reason).toBe("contains_hard_block");
    if (res.reason !== "contains_hard_block") throw new Error("unreachable");
    expect(res.blockedFindingIds).toEqual(["f_claim"]);
    expect(state.inserted).toHaveLength(0); // nothing recorded
  });

  it("refuses an empty finding set", async () => {
    const { db } = makeDb();
    const res = await createOperatorOverride(db, {
      inventoryId: "inv_1", assetVersion: 3, contentHash: "h", briefHash: "b",
      findings: [], operatorReason: "nothing", actorId: 7,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("no_findings");
  });
});

describe("consumeOverrideForPublish", () => {
  const validRow = (over: Partial<Record<string, unknown>> = {}) => ({
    id: "ovr_1",
    expiresAt: new Date(Date.now() + 3600_000),
    contentHash: "media_hash",
    briefHash: "brief_hash",
    acceptedFindingIds: JSON.stringify(["f_artifact", "f_pacing"]),
    ...over,
  });

  it("returns 'none' when there is no active override (publish proceeds on the approval)", async () => {
    const { db } = makeDb();
    const c = await consumeOverrideForPublish(db, { inventoryId: "inv_1", assetVersion: 3, currentContentHash: "media_hash", currentBriefHash: "brief_hash" });
    expect(c).toEqual({ ok: false, reason: "none" });
  });

  it("is deploy-safe: a select error (table pending 0089) yields 'none', never throws", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = { select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => { throw new Error("Table 'operator_quality_overrides' doesn't exist"); } }) }) }) }) } as any;
    const c = await consumeOverrideForPublish(db, { inventoryId: "inv_1", assetVersion: 3, currentContentHash: "media_hash", currentBriefHash: "brief_hash" });
    expect(c).toEqual({ ok: false, reason: "none" });
  });

  it("consumes a valid override atomically and returns the accepted findings", async () => {
    const { db, state } = makeDb();
    state.selectResult = [validRow()];
    const c = await consumeOverrideForPublish(db, { inventoryId: "inv_1", assetVersion: 3, currentContentHash: "media_hash", currentBriefHash: "brief_hash" });
    expect(c.ok).toBe(true);
    if (!c.ok) throw new Error("unreachable");
    expect(c.overrideId).toBe("ovr_1");
    expect(c.acceptedFindingIds).toEqual(["f_artifact", "f_pacing"]);
    expect(state.updated.some((u) => u.state === "consumed")).toBe(true);
  });

  it("INVALIDATES when the media hash changed since acceptance (a new render)", async () => {
    const { db, state } = makeDb();
    state.selectResult = [validRow({ contentHash: "old_media" })];
    const c = await consumeOverrideForPublish(db, { inventoryId: "inv_1", assetVersion: 3, currentContentHash: "new_media", currentBriefHash: "brief_hash" });
    expect(c).toEqual({ ok: false, reason: "hash_mismatch" });
    expect(state.updated.some((u) => u.state === "invalidated")).toBe(true);
  });

  it("INVALIDATES when the brief hash changed since acceptance (a caption/metadata edit)", async () => {
    const { db, state } = makeDb();
    state.selectResult = [validRow({ briefHash: "old_brief" })];
    const c = await consumeOverrideForPublish(db, { inventoryId: "inv_1", assetVersion: 3, currentContentHash: "media_hash", currentBriefHash: "new_brief" });
    expect(c).toEqual({ ok: false, reason: "hash_mismatch" });
    expect(state.updated.some((u) => u.state === "invalidated")).toBe(true);
  });

  it("EXPIRES a stale override at execution time", async () => {
    const { db, state } = makeDb();
    state.selectResult = [validRow({ expiresAt: new Date(Date.now() - 1000) })];
    const c = await consumeOverrideForPublish(db, { inventoryId: "inv_1", assetVersion: 3, currentContentHash: "media_hash", currentBriefHash: "brief_hash" });
    expect(c).toEqual({ ok: false, reason: "expired" });
    expect(state.updated.some((u) => u.state === "expired")).toBe(true);
  });

  it("loses the consume race atomically (CAS affected 0 rows)", async () => {
    const { db, state } = makeDb();
    state.selectResult = [validRow()];
    state.updateAffected = 0; // another publisher consumed it first
    const c = await consumeOverrideForPublish(db, { inventoryId: "inv_1", assetVersion: 3, currentContentHash: "media_hash", currentBriefHash: "brief_hash" });
    expect(c).toEqual({ ok: false, reason: "lost_race" });
  });
});

describe("revokeOperatorOverride", () => {
  it("revokes an active override (operator changed their mind)", async () => {
    const { db, state } = makeDb();
    const ok = await revokeOperatorOverride(db, "ovr_1");
    expect(ok).toBe(true);
    expect(state.updated.some((u) => u.state === "revoked")).toBe(true);
  });
});

describe("releaseConsumedOverride (a failed publish must not burn the acceptance)", () => {
  it("returns a consumed override to active and clears consumedAt", async () => {
    const { db, state } = makeDb();
    state.updateAffected = 1;
    const restored = await releaseConsumedOverride(db, "ovr_1");
    expect(restored).toBe(true);
    expect(state.updated).toHaveLength(1);
    expect(state.updated[0].state).toBe("active");
    expect(state.updated[0].consumedAt).toBeNull();
  });

  it("restores nothing when the override is no longer consumed (revoked/expired won the CAS)", async () => {
    const { db, state } = makeDb();
    state.updateAffected = 0; // the consumed->active CAS matched no row
    expect(await releaseConsumedOverride(db, "ovr_1")).toBe(false);
  });

  it("never throws — bookkeeping must not mask the publish error being rethrown", async () => {
    const broken = { update: () => ({ set: () => ({ where: async () => { throw new Error("db gone"); } }) }) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await releaseConsumedOverride(broken as any, "ovr_1")).toBe(false);
  });
});
