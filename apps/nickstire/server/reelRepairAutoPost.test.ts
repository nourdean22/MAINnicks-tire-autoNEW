/**
 * F5 (2026-10-17) · a repaired reel posts after a CLEAN re-QA with no human tap.
 *
 * Operator decision 2026-10-13 (2): "repaired reels AUTO-POST after a clean re-QA".
 *
 * Before this, a beat repair re-rendered the master and the old approval either
 *   - went void through the asset digest (asset_bytes_changed_since_approval),
 *     which auto-approval left "for a human", so the repaired reel waited on a tap; or
 *   - CARRIED OVER, when the approval had no digest (or the new master's registry
 *     row was missing and the URL lookup returned the OLD digest): reels/reel-<id>.mp4
 *     is a deterministic key, so the URL is unchanged and the old yes covered new bytes.
 *
 * The guards, each pinned below:
 *   G1 freshness  the gate reads `proceed` from a verdict evaluated AFTER the repair
 *                 replaced the old render (payload.mp4History[].replacedAt).
 *   G2 integrity  an approval recorded before the latest repair never covers the
 *                 repaired render; auto-approval writes a fresh one bound to the
 *                 current caption sha + mp4 through recordReelApproval.
 *   G3 bounded    repair attempts (payload.repairQueue length) <= policy cap.
 *   G4 no bypass  auto-approval only records consent; every publish gate still runs.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const T_APPROVED = "2026-10-15T10:00:00.000Z";
const T_REPAIRED = "2026-10-15T12:00:00.000Z";
const T_REQA = "2026-10-15T13:00:00.000Z";

/* ── G2 at the reader: a pre-repair approval does not cover the repaired render ── */

describe("reelApprovalProblem: an approval recorded before the latest repair is void", () => {
  afterEach(() => { vi.doUnmock("./db"); vi.resetModules(); });

  async function problemFor(mp4History: unknown) {
    const { captionFingerprint } = await import("./services/reelApproval");
    // By table NAME: vi.resetModules gives the service its own schema instance.
    const { getTableName } = await import("drizzle-orm");
    const approval = {
      reelJobId: 42,
      captionSha: captionFingerprint("cap"),
      videoUrl: "https://x/reels/reel-42.mp4",
      approvedBy: "owner",
      approvedAt: new Date(T_APPROVED),
      expiresAt: new Date(Date.now() + 3600_000),
      revokedAt: null,
      assetSha256: null, // URL-only approval: the case the digest cannot catch
    };
    const job = { payload: JSON.stringify({ mp4History }) };
    vi.doMock("./db", () => ({
      getDb: async () => ({
        select: () => ({
          from: (t: unknown) => {
            const name = getTableName(t as never);
            const rows = name === "reel_publish_approvals" ? [approval] : name === "reel_jobs" ? [job] : [];
            const tail = { limit: async () => rows };
            return { where: () => ({ ...tail, orderBy: () => tail }) };
          },
        }),
      }),
    }));
    vi.resetModules();
    const { reelApprovalProblem } = await import("./services/reelApproval");
    return reelApprovalProblem({ jobId: 42, caption: "cap", videoUrl: "https://x/reels/reel-42.mp4" });
  }

  it("POSITIVE CONTROL: no repair since approval -> the approval covers the reel", async () => {
    expect(await problemFor([])).toBeNull();
    expect(await problemFor([{ mp4Url: "https://x/reels/reel-42.mp4", replacedAt: "2026-10-14T09:00:00.000Z" }])).toBeNull();
  });

  it("a repair after the approval voids it, even with the same URL and no digest", async () => {
    const p = await problemFor([{ mp4Url: "https://x/reels/reel-42.mp4", replacedAt: T_REPAIRED }]);
    expect(p?.code).toBe("video_changed_since_approval");
    expect(p?.reason).toContain("repair");
  });

  it("an unreadable repair history fails closed", async () => {
    const p = await problemFor("not-a-list");
    expect(p?.code).toBe("video_changed_since_approval");
  });
});

/* ── auto-approval: the repaired path and its guards ── */

type Gate = { gate: string; allowed: boolean; source: string; repairAttempts: number; findings: unknown[]; reason: string };

function arm(entries: Array<Record<string, unknown>>, gates: Record<number, Gate>, cap = 2) {
  const record = vi.fn().mockResolvedValue({ approvalId: "a", expiresAt: new Date(), captionSha: "s", videoUrl: "u", publishWindowStart: null, publishWindowEnd: null, assetSha256: null });
  vi.doMock("./services/autonomyControl", () => ({
    getActivePolicy: vi.fn().mockResolvedValue({ version: 11, formatPermissions: { reel: "auto" }, limits: { maxRepairAttemptsPerAsset: cap } }),
  }));
  class ReelApprovalWriteError extends Error { constructor(public code: string, m: string) { super(m); } }
  vi.doMock("./services/reelApproval", () => ({
    listReelPublishQueue: vi.fn().mockResolvedValue({ entries, approvalsTableReadable: true }),
    recordReelApproval: record,
    ReelApprovalWriteError,
  }));
  const gate = vi.fn(async (jobId: number) => gates[jobId] ?? { gate: "unavailable", allowed: false, source: "unavailable", repairAttempts: 0, findings: [], reason: "none" });
  vi.doMock("./services/qualityGate", () => ({ evaluateReelPublishGate: gate }));
  vi.resetModules();
  return { record, gate };
}

const clean: Gate = { gate: "proceed", allowed: true, source: "persisted", repairAttempts: 1, findings: [], reason: "clean" };
const repaired = (jobId: number, over: Record<string, unknown> = {}) => ({
  jobId,
  captionSha: `sha${jobId}`,
  videoUrl: `https://x/reels/reel-${jobId}.mp4`,
  vetoReason: null,
  inventoryHold: null,
  approvalProblem: { code: "video_changed_since_approval", reason: "repaired" },
  approvedAt: T_APPROVED,
  repair: { attempts: 1, lastReplacedAt: T_REPAIRED, verdictEvaluatedAt: T_REQA },
  ...over,
});

describe("autoApproveAssembledReels: a repaired reel with a clean re-QA is re-approved by policy", () => {
  afterEach(() => {
    vi.doUnmock("./services/autonomyControl"); vi.doUnmock("./services/reelApproval"); vi.doUnmock("./services/qualityGate"); vi.resetModules();
  });

  it("repaired + clean re-QA on the current mp4 -> a fresh approval bound to the current caption sha and mp4", async () => {
    const { record, gate } = arm([repaired(1)], { 1: clean });
    const { autoApproveAssembledReels } = await import("./services/reelAutoApproval");
    const out = await autoApproveAssembledReels();
    expect(out.approved).toEqual([1]);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][0]).toMatchObject({ jobId: 1, expectedCaptionSha: "sha1", expectedVideoUrl: "https://x/reels/reel-1.mp4" });
    expect(String(record.mock.calls[0][0].approvedBy)).toMatch(/auto-approval/);
    // read-only: auto-approval never runs QA itself
    expect(gate.mock.calls[0][1]).toEqual({ runIfMissing: false });
  });

  it("the byte-digest void takes the same path (asset_bytes_changed_since_approval)", async () => {
    const { record } = arm([repaired(2, { approvalProblem: { code: "asset_bytes_changed_since_approval", reason: "r" } })], { 2: clean });
    const { autoApproveAssembledReels } = await import("./services/reelAutoApproval");
    expect((await autoApproveAssembledReels()).approved).toEqual([2]);
    expect(record).toHaveBeenCalledTimes(1);
  });

  it("G1: a verdict evaluated BEFORE the repair replaced the render is stale -> no approval", async () => {
    const { record } = arm([repaired(3, { repair: { attempts: 1, lastReplacedAt: T_REPAIRED, verdictEvaluatedAt: "2026-10-15T11:00:00.000Z" } })], { 3: clean });
    const { autoApproveAssembledReels } = await import("./services/reelAutoApproval");
    const out = await autoApproveAssembledReels();
    expect(record).not.toHaveBeenCalled();
    expect(out.skipped).toEqual([{ jobId: 3, why: "repair_reqa_stale" }]);
  });

  it("G1: no verdict timestamp at all -> no approval", async () => {
    const { record } = arm([repaired(4, { repair: { attempts: 1, lastReplacedAt: T_REPAIRED, verdictEvaluatedAt: null } })], { 4: clean });
    const { autoApproveAssembledReels } = await import("./services/reelAutoApproval");
    await autoApproveAssembledReels();
    expect(record).not.toHaveBeenCalled();
  });

  it("G1: re-QA not clean (needs_review, stale, auto_repair, disabled) -> no approval", async () => {
    const notClean = ["needs_review", "stale", "auto_repair", "unavailable"].map((g, i) => [10 + i, { ...clean, gate: g, allowed: false }] as const);
    const disabled = [14, { ...clean, gate: "disabled", allowed: true, source: "disabled" }] as const;
    const all = [...notClean, disabled];
    const { record } = arm(all.map(([id]) => repaired(id)), Object.fromEntries(all));
    const { autoApproveAssembledReels } = await import("./services/reelAutoApproval");
    const out = await autoApproveAssembledReels();
    expect(record).not.toHaveBeenCalled();
    expect(out.skipped.every((s) => s.why === "repair_reqa_not_clean")).toBe(true);
  });

  it("G1: a gate that cannot be read -> no approval", async () => {
    const { record, gate } = arm([repaired(5)], {});
    gate.mockRejectedValueOnce(new Error("db blip"));
    const { autoApproveAssembledReels } = await import("./services/reelAutoApproval");
    const out = await autoApproveAssembledReels();
    expect(record).not.toHaveBeenCalled();
    expect(out.skipped[0]).toMatchObject({ jobId: 5 });
  });

  it("G3: more repair attempts than the policy cap -> no approval", async () => {
    const { record } = arm([repaired(6, { repair: { attempts: 3, lastReplacedAt: T_REPAIRED, verdictEvaluatedAt: T_REQA } })], { 6: clean }, 2);
    const { autoApproveAssembledReels } = await import("./services/reelAutoApproval");
    const out = await autoApproveAssembledReels();
    expect(record).not.toHaveBeenCalled();
    expect(out.skipped).toEqual([{ jobId: 6, why: "repair_cap_exceeded" }]);
  });

  it("G2: video changed WITHOUT a repair after the approval is still a human's call", async () => {
    const { record } = arm([
      repaired(7, { repair: null }),
      repaired(8, { approvedAt: "2026-10-15T12:30:00.000Z" }), // approval is newer than the repair
      repaired(9, { approvedAt: null }),
    ], { 7: clean, 8: clean, 9: clean });
    const { autoApproveAssembledReels } = await import("./services/reelAutoApproval");
    const out = await autoApproveAssembledReels();
    expect(record).not.toHaveBeenCalled();
    expect(out.skipped.map((s) => s.why)).toEqual(Array(3).fill("video_changed_since_approval"));
  });

  it("G2/G4: caption drift, a revocation, a veto and an inventory hold still refuse a repaired reel", async () => {
    const { record } = arm([
      repaired(20, { approvalProblem: { code: "caption_changed_since_approval", reason: "r" } }),
      repaired(21, { approvalProblem: { code: "approval_revoked", reason: "r" } }),
      repaired(22, { vetoReason: "condemned" }),
      repaired(23, { inventoryHold: "rejected" }),
    ], { 20: clean, 21: clean, 22: clean, 23: clean });
    const { autoApproveAssembledReels } = await import("./services/reelAutoApproval");
    const out = await autoApproveAssembledReels();
    expect(record).not.toHaveBeenCalled();
    expect(out.skipped.map((s) => s.why)).toEqual(["caption_changed_since_approval", "approval_revoked", "vetoed", "inventory_rejected"]);
  });
});

/* ── G4: consent is the only thing F5 changes; the publish chain is untouched ── */

describe("G4: the publish door still runs every gate after auto-approval", () => {
  const CRON = readFileSync(path.join(__dirname, "cron", "jobs", "dailyReelPost.ts"), "utf8");
  const AUTO = readFileSync(path.join(__dirname, "services", "reelAutoApproval.ts"), "utf8");

  it("auto-approval records consent only: it cannot publish, claim or advance", () => {
    for (const forbidden of ["publishToSocial", "status: \"publishing\"", "setAutopostProgress", "update(reelJobs)"]) {
      expect(AUTO).not.toContain(forbidden);
    }
    // CONTROL: the file does reach the real writer and the gate it reads.
    expect(AUTO).toContain("recordReelApproval(");
    expect(AUTO).toContain("evaluateReelPublishGate");
  });

  it("after selection the door still runs rendered QA, vetoes, originality and the approval check, in that order, before the claim", () => {
    const door = CRON.slice(CRON.indexOf("if (skipped.length) {"));
    const order = [
      "await evaluateReelPublishGate(job.id);",
      "condemnedContentProblem({",
      "auditPublishBlock(job.id)",
      "publishDisclosureProblem({",
      "await loadPublishedCorpus(job.id)",
      "await reelApprovalProblem({ jobId: job.id, caption, videoUrl })",
      "const claimRes = await d.update(reelJobs).set({ status: \"publishing\"",
    ].map((s) => door.indexOf(s));
    for (const i of order) expect(i).toBeGreaterThan(-1);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});
