/**
 * Autonomy control edits change ONE setting against the STORED policy (2026-10-08).
 *
 * Before: the limit editor on Autonomy control published the policy the phone
 * held, and the command center sends only part of it (version, mode, kill
 * switches, limits). The router's shape check refused that every time, so the
 * Generation budget could not be changed from the phone. Kill switches built
 * their edit from the 30 s cache. And a version collision was recognised by
 * matching /duplicate/i against the error message, which drizzle fills with the
 * SQL and its params — the code sits on `.cause` — so the retry never ran.
 */
import { DrizzleQueryError } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import { DEFAULT_AUTONOMY_POLICY, validateAutonomyPolicyShape, type AutonomyPolicy } from "../../client/src/lib/autonomyPolicy";

const state = vi.hoisted(() => ({
  rows: [] as Array<{ version: number; policyJson: string; note: string; createdBy: string }>,
  dbAvailable: true,
  /** Runs once, just before the next insert: another writer taking a version first. */
  beforeInsert: null as null | (() => void),
  /** Thrown by the next insert instead of writing (a non-duplicate failure). */
  insertError: null as null | Error,
}));

vi.mock("../db", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const dupError = (version: number) =>
    new DrizzleQueryError(
      "insert into `autonomy_policy_versions` (`version`, `policy_json`, `note`, `created_by`) values (?, ?, ?, ?)",
      [version, "{}", "note", "op"],
      Object.assign(new Error(`Duplicate entry '${version}' for key 'autonomy_policy_versions.uq_autonomy_policy_version'`), {
        code: "ER_DUP_ENTRY",
        errno: 1062,
      }),
    );
  const fake = {
    select: () => ({
      from: () => ({
        orderBy: () => ({
          limit: async () => [...state.rows].sort((a, b) => b.version - a.version).slice(0, 1),
        }),
      }),
    }),
    insert: () => ({
      values: async (v: { version: number; policyJson: string; note: string; createdBy: string }) => {
        const race = state.beforeInsert;
        state.beforeInsert = null;
        race?.();
        if (state.insertError) { const e = state.insertError; state.insertError = null; throw e; }
        if (state.rows.some((r) => r.version === v.version)) throw dupError(v.version);
        state.rows.push(v);
      },
    }),
  };
  return { ...actual, getDb: async () => (state.dbAvailable ? fake : null), getDbTyped: async () => (state.dbAvailable ? fake : null) };
});

// With the db faked, the real admin-role read throws and a mutation is refused
// (audit F-11). No security row → the documented owner fallback.
vi.mock("../services/adminSecurity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/adminSecurity")>()),
  getAdminSecurityState: async () => null,
}));

import {
  PolicyValidationError,
  clearPolicyCache,
  getActivePolicy,
  publishPolicyVersion,
  setKillSwitch,
  setPaidRepairPermission,
  setPolicyLimit,
} from "../services/autonomyControl";
import { contentAdminRouter } from "../routers/content";

const stored = (version: number, policy: AutonomyPolicy) =>
  ({ version, policyJson: JSON.stringify({ ...policy, version }), note: "", createdBy: "seed" });
const latest = (): AutonomyPolicy & { version: number } => {
  const top = [...state.rows].sort((a, b) => b.version - a.version)[0];
  return JSON.parse(top.policyJson);
};
/** Production-like: limits and switches the operator chose, not the defaults. */
const chosen: AutonomyPolicy = {
  ...DEFAULT_AUTONOMY_POLICY,
  formatPermissions: { ...DEFAULT_AUTONOMY_POLICY.formatPermissions, reel: "auto" },
  limits: { ...DEFAULT_AUTONOMY_POLICY.limits, maxGenerationCostPerDayUsd: 12 },
  autonomousRepair: { paidBeatRegeneration: "auto" },
  emergencyControls: { ...DEFAULT_AUTONOMY_POLICY.emergencyControls, generationKillSwitch: true },
};

beforeEach(() => {
  state.rows = [stored(5, chosen)];
  state.dbAvailable = true;
  state.beforeInsert = null;
  state.insertError = null;
  clearPolicyCache();
});

describe("a limit edit changes one limit against the stored policy", () => {
  it("CONTROL — what the phone used to publish fails the router's shape check", () => {
    // collectCommandCenter's policy section, with source removed, is all the old editor sent.
    const { version, operatingMode, emergencyControls, limits } = chosen;
    const sent = { version, operatingMode, emergencyControls, limits: { ...limits, maxGenerationCostPerDayUsd: 0 } };
    expect(validateAutonomyPolicyShape(sent)).toBe(false);
    expect(validateAutonomyPolicyShape({ ...chosen, limits: sent.limits })).toBe(true);
  });

  it("writes exactly the next version and keeps everything the phone did not send", async () => {
    await expect(setPolicyLimit("maxGenerationCostPerDayUsd", 0, "owner@nickstire.org")).resolves.toEqual({ version: 6 });
    const p = latest();
    expect(p.version).toBe(6);
    expect(p.limits.maxGenerationCostPerDayUsd).toBe(0);
    expect(p.emergencyControls.generationKillSwitch).toBe(true);
    expect(p.formatPermissions.reel).toBe("auto");
    expect(p.autonomousRepair).toEqual({ paidBeatRegeneration: "auto" });
    expect(state.rows.at(-1)).toMatchObject({ note: "maxGenerationCostPerDayUsd 12 -> 0", createdBy: "owner@nickstire.org" });
  });

  it("a concurrent edit that took the version first is re-applied on top, not overwritten", async () => {
    state.beforeInsert = () => {
      state.rows.push(stored(6, { ...chosen, emergencyControls: { ...chosen.emergencyControls, publishingKillSwitch: true } }));
    };
    await expect(setPolicyLimit("maxGenerationCostPerDayUsd", 0, "op")).resolves.toEqual({ version: 7 });
    const p = latest();
    expect(p.emergencyControls.publishingKillSwitch).toBe(true); // the other phone's switch survived
    expect(p.limits.maxGenerationCostPerDayUsd).toBe(0); // and so did this edit
  });

  it("a non-duplicate write failure is not retried", async () => {
    state.insertError = new DrizzleQueryError("insert into `autonomy_policy_versions` ...", [6], Object.assign(new Error("Lock wait timeout exceeded"), { code: "ER_LOCK_WAIT_TIMEOUT", errno: 1205 }));
    await expect(setPolicyLimit("maxGenerationCostPerDayUsd", 0, "op")).rejects.toBeInstanceOf(DrizzleQueryError);
    expect(state.rows.map((r) => r.version)).toEqual([5]);
  });

  it("out of the schema's range is a PolicyValidationError and nothing is written", async () => {
    await expect(setPolicyLimit("maxGenerationCostPerDayUsd", 5000, "op")).rejects.toBeInstanceOf(PolicyValidationError);
    expect(state.rows.map((r) => r.version)).toEqual([5]);
  });

  it("an unreachable store refuses the edit rather than editing the code default", async () => {
    state.dbAvailable = false;
    await expect(setPolicyLimit("maxGenerationCostPerDayUsd", 0, "op")).rejects.toThrow(/DB not available/);
    expect(state.rows.map((r) => r.version)).toEqual([5]);
  });

  it("an empty store edits the default, as version 2", async () => {
    state.rows = [];
    await expect(setPolicyLimit("maxFeedPostsPerDay", 1, "op")).resolves.toEqual({ version: 2 });
    expect(latest().limits).toEqual({ ...DEFAULT_AUTONOMY_POLICY.limits, maxFeedPostsPerDay: 1 });
  });
});

describe("the paid-repair switch", () => {
  it("auto -> approval_required changes only that field", async () => {
    await setPaidRepairPermission("approval_required", "op");
    const p = latest();
    expect(p.autonomousRepair).toEqual({ paidBeatRegeneration: "approval_required" });
    expect({ ...p, autonomousRepair: chosen.autonomousRepair, version: 5 }).toEqual({ ...chosen, version: 5 });
    expect(state.rows.at(-1)?.note).toBe("paid beat repair auto -> approval_required");
  });

  it("a policy written before the field existed reads as approval_required in the note", async () => {
    const { autonomousRepair: _omit, ...legacy } = chosen;
    state.rows = [stored(5, legacy as AutonomyPolicy)];
    await setPaidRepairPermission("auto", "op");
    expect(latest().autonomousRepair).toEqual({ paidBeatRegeneration: "auto" });
    expect(state.rows.at(-1)?.note).toBe("paid beat repair approval_required -> auto");
  });
});

describe("kill switches", () => {
  it("arm on top of the stored policy, not the 30 s cache", async () => {
    await getActivePolicy(); // this process now caches v5
    state.rows.push(stored(6, { ...chosen, limits: { ...chosen.limits, maxGenerationCostPerDayUsd: 3 } })); // another instance's edit
    await expect(setKillSwitch("global", true, "op")).resolves.toEqual({ version: 7 });
    const p = latest();
    expect(p.emergencyControls).toMatchObject({ globalKillSwitch: true, generationKillSwitch: true });
    expect(p.limits.maxGenerationCostPerDayUsd).toBe(3); // the cached v5 would have put 12 back
  });

  it("still arm when the stored version fails validation — on top of the default that governs", async () => {
    state.rows = [{ version: 5, policyJson: "{\"version\":5,\"operatingMode\":\"warp\"}", note: "", createdBy: "seed" }];
    await expect(setKillSwitch("global", true, "op")).resolves.toEqual({ version: 6 });
    expect(latest()).toEqual({
      ...DEFAULT_AUTONOMY_POLICY,
      version: 6,
      emergencyControls: { ...DEFAULT_AUTONOMY_POLICY.emergencyControls, globalKillSwitch: true },
    });
  });
});

describe("publishPolicyVersion (a whole policy)", () => {
  it("retries a drizzle-wrapped duplicate key against the fresh max", async () => {
    state.beforeInsert = () => { state.rows.push(stored(6, chosen)); };
    await expect(publishPolicyVersion({ ...chosen, version: 5 }, "full publish", "op")).resolves.toEqual({ version: 7 });
  });
});

const adminCtx = (): TrpcContext => ({
  user: {
    id: 1, openId: "admin-user", email: "admin@nickstire.com", name: "Admin User", loginMethod: "manus",
    role: "admin", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
  },
  req: { protocol: "https", headers: {} } as TrpcContext["req"],
  res: { clearCookie: () => {} } as TrpcContext["res"],
} as TrpcContext);

describe("router", () => {
  it("setAutonomyLimit publishes, and an out-of-range value is a BAD_REQUEST, not a server error", async () => {
    const caller = contentAdminRouter.createCaller(adminCtx());
    await expect(caller.setAutonomyLimit({ key: "maxGenerationCostPerDayUsd", value: 0 })).resolves.toEqual({ version: 6 });
    await expect(caller.setAutonomyLimit({ key: "maxGenerationCostPerDayUsd", value: 5000 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(state.rows.map((r) => r.version)).toEqual([5, 6]);
  });

  it("setAutonomyPaidRepair accepts only auto and approval_required", async () => {
    const caller = contentAdminRouter.createCaller(adminCtx());
    await expect(caller.setAutonomyPaidRepair({ permission: "approval_required" })).resolves.toEqual({ version: 6 });
    // @ts-expect-error — "manual" is a valid PublishPermission, but not a choice on this switch
    await expect(caller.setAutonomyPaidRepair({ permission: "manual" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(latest().autonomousRepair).toEqual({ paidBeatRegeneration: "approval_required" });
  });
});
