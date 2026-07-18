/**
 * reelPublishAuthority — the ONE authorization every reel door must pass.
 *
 * The defects this encodes, all confirmed at file:line before the fix:
 *  - publishPost ran eleven gates and never consulted the rendered-QA verdict.
 *  - schedulePost did the same AND hashed the media URL *string* against an
 *    approval storing a hash of the video BYTES — unsatisfiable by construction.
 *  - Both had hand-copied the approval block, and the copies had drifted.
 *
 * The governing rule under test: absence of evidence is never permission — every
 * non-allowed gate verdict stops the publish.
 *
 * The single exception is deliberate and tested both ways: a draft whose reel job
 * cannot be resolved at all is enforced only under REEL_GATE_REQUIRE_JOB=true,
 * because production measurement showed the link is unreliable (reel_jobs.briefId
 * is free text; 2 of 8 recent jobs resolved). Default-off makes the gap loud
 * rather than silent; it does not make it safe.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let gateResult: { allowed: boolean; gate: string; reason: string; findings: unknown[] };
let approvalResult: Record<string, unknown>;
let reelJobRows: Array<{ id: number }>;

vi.mock("./services/contentApprovals", () => ({
  verifyApprovalRecord: async () => approvalResult,
  describeApprovalFailure: (r: string) => `approval failure: ${r}`,
}));
vi.mock("./services/qualityGate", () => ({
  evaluateReelPublishGate: async () => gateResult,
}));

let overridePresent = false;
vi.mock("./services/operatorOverride", () => ({
  hasActiveOverride: async () => ({ present: overridePresent, acceptedFindingIds: ["f1"] }),
}));

import { authorizeReelPublish, resolveReelJobId, ReelNotPublishableError } from "./services/reelPublishAuthority";

/** Fake drizzle surface: select().from().where().orderBy().limit() */
const fakeDb = () =>
  ({
    select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => reelJobRows }) }) }) }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

const draft = (briefJson: string | null) => ({ id: "inv_1", version: 4, briefJson });

beforeEach(() => {
  delete process.env.REEL_GATE_REQUIRE_JOB;
  overridePresent = false;
  gateResult = { allowed: true, gate: "proceed", reason: "clean", findings: [] };
  approvalResult = { ok: true, briefHash: "bh", mediaHash: "mh", expiresAt: null };
  reelJobRows = [];
});

describe("resolveReelJobId", () => {
  it("reads briefJson.reelJobId without a query — the cron path writes it", async () => {
    expect(await resolveReelJobId(fakeDb(), { id: "inv_1", briefJson: JSON.stringify({ reelJobId: 750001 }) })).toBe(750001);
  });

  it("falls back to the newest reel_jobs row bound by briefId", async () => {
    reelJobRows = [{ id: 660002 }];
    expect(await resolveReelJobId(fakeDb(), { id: "inv_1", briefJson: "{}" })).toBe(660002);
  });

  it("returns null — never a guess — when neither link resolves", async () => {
    reelJobRows = [];
    expect(await resolveReelJobId(fakeDb(), { id: "inv_1", briefJson: "{}" })).toBeNull();
  });

  it("survives an unparseable brief and still tries the fallback", async () => {
    reelJobRows = [{ id: 42 }];
    expect(await resolveReelJobId(fakeDb(), { id: "inv_1", briefJson: "{not json" })).toBe(42);
  });

  it("rejects a non-positive or non-integer reelJobId rather than querying with it", async () => {
    reelJobRows = [];
    for (const bad of [0, -1, 1.5, "abc", null]) {
      expect(await resolveReelJobId(fakeDb(), { id: "i", briefJson: JSON.stringify({ reelJobId: bad }) })).toBeNull();
    }
  });
});

describe("authorizeReelPublish", () => {
  const call = (briefJson = JSON.stringify({ reelJobId: 1 })) =>
    authorizeReelPublish(fakeDb(), { draft: draft(briefJson), videoUrl: "https://cdn/x.mp4" });

  it("authorizes when the approval verifies AND the gate allows", async () => {
    const auth = await call();
    expect(auth.reelJobId).toBe(1);
    expect(auth.gate).toBe("proceed");
  });

  it("returns the override binding built from the CANONICAL hashes, not a local recompute", async () => {
    approvalResult = { ok: true, briefHash: "brief_abc", mediaHash: "media_xyz", expiresAt: null };
    const auth = await call();
    // media_xyz is a byte hash from verifyApprovalRecord. The old schedulePost
    // computed sha256(url) here, which could never equal it.
    expect(auth.overrideBinding).toEqual({
      inventoryId: "inv_1",
      assetVersion: 3, // version - 1: approval binds the reviewed version
      currentContentHash: "media_xyz",
      currentBriefHash: "brief_abc",
    });
  });

  it("REFUSES when the approval record is missing", async () => {
    approvalResult = { ok: false, reason: "no_record" };
    await expect(call()).rejects.toBeInstanceOf(ReelNotPublishableError);
  });

  it("REFUSES an expired approval", async () => {
    approvalResult = { ok: false, reason: "expired" };
    await expect(call()).rejects.toThrow(/expired/i);
  });

  it("REFUSES on a media hash mismatch", async () => {
    approvalResult = { ok: false, reason: "media_mismatch" };
    await expect(call()).rejects.toThrow(/media_mismatch/);
  });

  // The one deliberate exception. Production measurement: reel_jobs.briefId is
  // free text, not a foreign key — only 2 of 8 recent jobs resolved to a real
  // inventory row. Enforcing today could refuse reels the operator can currently
  // publish, so the hard stop is opt-in.
  it("REFUSES an unresolvable reel job when REEL_GATE_REQUIRE_JOB=true", async () => {
    process.env.REEL_GATE_REQUIRE_JOB = "true";
    reelJobRows = [];
    await expect(call("{}")).rejects.toThrow(/Refusing to publish without a quality decision/i);
  });

  it("by DEFAULT proceeds without a job but reports gate=job_unresolved (loud, not silent)", async () => {
    delete process.env.REEL_GATE_REQUIRE_JOB;
    reelJobRows = [];
    const auth = await call("{}");
    expect(auth.reelJobId).toBeNull();
    expect(auth.gate).toBe("job_unresolved");
    // The approval binding must still be correct — the override path stays usable.
    expect(auth.overrideBinding.currentContentHash).toBe("mh");
  });

  it("an unresolvable job still REFUSES on a bad approval — the flag never weakens integrity", async () => {
    delete process.env.REEL_GATE_REQUIRE_JOB;
    reelJobRows = [];
    approvalResult = { ok: false, reason: "media_mismatch" };
    await expect(call("{}")).rejects.toBeInstanceOf(ReelNotPublishableError);
  });

  it("does NOT call the gate when the approval already failed (fail fast, no wasted work)", async () => {
    approvalResult = { ok: false, reason: "brief_mismatch" };
    let gateCalls = 0;
    gateResult = { get allowed() { gateCalls++; return true; }, gate: "proceed", reason: "", findings: [] } as never;
    await expect(call()).rejects.toBeInstanceOf(ReelNotPublishableError);
    expect(gateCalls).toBe(0);
  });

  it.each([
    ["unavailable", "vision critic did not evaluate"],
    ["stale", "verdict predates a repair re-render"],
    ["needs_review", "unrecognized defect codes"],
    ["needs_paid_repair", "block finding"],
  ])("REFUSES when the gate says %s — the human doors can no longer publish past it", async (gate, reason) => {
    gateResult = { allowed: false, gate, reason, findings: [{}] };
    await expect(call()).rejects.toThrow(new RegExp(gate));
  });

  it("surfaces the finding count so the operator knows what to resolve", async () => {
    gateResult = { allowed: false, gate: "needs_paid_repair", reason: "block", findings: [{}, {}] };
    await expect(call()).rejects.toThrow(/2 finding\(s\)/);
  });
});

describe("operator override is honoured AT THE GATE, not after it", () => {
  const call = () => authorizeReelPublish(fakeDb(), {
    draft: draft(JSON.stringify({ reelJobId: 1 })), videoUrl: "https://cdn/x.mp4",
  });
  const warnFinding = { severity: "warn" };
  const repairFinding = { severity: "repair" };
  const blockFinding = { severity: "block" };

  it("PROCEEDS on advisory findings when a valid override exists", async () => {
    // The whole defect: the override was consumed ~130 lines downstream at the
    // publish CAS, which this function throws long before reaching. The Queue
    // recorded an override, retried, hit the same refusal, and reported success.
    gateResult = { allowed: false, gate: "needs_paid_repair", reason: "advisory", findings: [repairFinding] };
    overridePresent = true;
    const auth = await call();
    expect(auth.gate).toBe("needs_paid_repair_overridden");
    expect(auth.overrideBinding.inventoryId).toBe("inv_1");
  });

  it("still REFUSES the same findings when no override exists", async () => {
    gateResult = { allowed: false, gate: "needs_paid_repair", reason: "advisory", findings: [warnFinding] };
    overridePresent = false;
    await expect(call()).rejects.toBeInstanceOf(ReelNotPublishableError);
  });

  it("NEVER lets an override carry a BLOCK finding", async () => {
    // OVERRIDABLE_SEVERITIES is warn|repair by contract; block is the hard gate.
    gateResult = { allowed: false, gate: "needs_paid_repair", reason: "block present", findings: [warnFinding, blockFinding] };
    overridePresent = true;
    await expect(call()).rejects.toThrow(/needs_paid_repair/);
  });

  it.each(["unavailable", "stale"])("NEVER lets an override carry '%s' — there is no finding to have judged", async (gate) => {
    // These mean the evidence is missing or describes a different file. Allowing
    // an override here would re-open the fail-open this whole arc closed.
    gateResult = { allowed: false, gate, reason: "no evidence", findings: [repairFinding] };
    overridePresent = true;
    await expect(call()).rejects.toThrow(new RegExp(gate));
  });

  it("refuses when the gate gave no findings at all — nothing was accepted", async () => {
    gateResult = { allowed: false, gate: "needs_review", reason: "incomplete", findings: [] };
    overridePresent = true;
    await expect(call()).rejects.toBeInstanceOf(ReelNotPublishableError);
  });
});
