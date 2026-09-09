/**
 * The two ways the reel lane could still stop and wait for a human, closed.
 *
 * Measured on prod 2026-09-09 over 14 days of daily-reel-post rows: 30 pulses
 * held on `needs_paid_repair` (one reel, channel dark behind it for a day) and
 * three `needs_regen` rows sat dead since 2026-09-07 holding 8 paid clips that
 * nothing ever retried. Every other hold in that window was either self-healing
 * or correct (not production hour, already posted today).
 *
 * Both fixes are BOUNDED, and the bound is what these tests actually pin:
 *   · paid repair spends only when policy says so, and only through
 *     requestBeatRepair, which enforces the daily budget and the repair cap
 *   · a resume refuses anything that is not plainly resumable, and gives up
 *     after MAX_AUTO_RESUMES
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const CRON = readFileSync(path.join(__dirname, "cron", "jobs", "dailyReelPost.ts"), "utf8");
const SCHEDULER = readFileSync(path.join(__dirname, "cron", "scheduler.ts"), "utf8");

afterEach(() => { vi.doUnmock("./db"); vi.resetModules(); });

describe("paid repair is a policy switch, not a standing question", () => {
  it("needs_paid_repair takes the SAME repair path as auto_repair when policy says auto", () => {
    expect(CRON).toContain('if (g.gate === "auto_repair" || paidRepairAllowed)');
    expect(CRON).toContain('pol?.autonomousRepair?.paidBeatRegeneration === "auto"');
  });

  it("only needs_paid_repair can be policy-authorized — no other refusal is spendable", () => {
    const decl = CRON.slice(CRON.indexOf("let paidRepairAllowed = false;"));
    const guard = decl.slice(0, decl.indexOf("if (g.gate === \"auto_repair\""));
    expect(guard).toContain('if (g.gate === "needs_paid_repair")');
    // reject / stock_fallback / needs_review must never reach the spend branch.
    for (const gate of ["reject", "stock_fallback", "needs_review"]) {
      expect(guard).not.toContain(`"${gate}"`);
    }
  });

  it("an unreadable policy does NOT authorize money", () => {
    const decl = CRON.slice(CRON.indexOf("let paidRepairAllowed = false;"));
    const block = decl.slice(0, decl.indexOf("const target"));
    // The catch must leave the flag false and say so — never default to spending.
    expect(block).toContain("treating as approval_required");
    expect(block).not.toMatch(/catch[\s\S]{0,200}paidRepairAllowed\s*=\s*true/);
  });

  it("the spend still goes through requestBeatRepair, which holds the budget and cap", () => {
    // Not a re-implementation: the ceilings live in that writer, and this is the
    // only call site the cron uses.
    //
    // Anchor widened 2026-09-09: the call gained an `actor` argument and went
    // multi-line. The invariant was never the formatting — it is that the cron
    // spends through that writer and nowhere else — so both halves are pinned
    // separately below rather than by one brittle single-line string.
    expect(CRON).toContain("await requestBeatRepair({");
    const call = CRON.slice(CRON.indexOf("await requestBeatRepair({"));
    expect(call.slice(0, 300)).toContain("jobId: job.id");
    expect(call.slice(0, 300)).toContain("beatNumber: target.beatNumber as number");
    // Exactly one call site in the cron: a second would be a second spend door.
    expect(CRON.split("requestBeatRepair(").length - 1).toBe(1);
  });

  it("and it spends as the CRON, never inheriting a human's approval at the boundary", () => {
    // enforceAtBoundary reads an operator tap as self-approval and lets operator
    // paths proceed on an unreachable policy store. See reelAutonomyP0.test.ts.
    const call = CRON.slice(CRON.indexOf("await requestBeatRepair({"));
    expect(call.slice(0, 300)).toContain('actor: { type: "cron"');
  });

  it("PLANTED CANARY: the default policy is approval_required, so nobody starts spending by upgrade", () => {
    const POLICY = readFileSync(path.join(__dirname, "..", "client", "src", "lib", "autonomyPolicy.ts"), "utf8");
    expect(POLICY).toContain('autonomousRepair: { paidBeatRegeneration: "approval_required" }');
    const CONTROL = readFileSync(path.join(__dirname, "services", "autonomyControl.ts"), "utf8");
    expect(CONTROL).toContain('.default({ paidBeatRegeneration: "approval_required" })');
  });
});

describe("a provider timeout resumes itself", () => {
  it("the pulse calls it every tick, and a failure never takes the pulse down", () => {
    expect(SCHEDULER).toContain("resumeTimedOutReelJobs()");
    const call = SCHEDULER.slice(SCHEDULER.indexOf("const resumed = await resumeTimedOutReelJobs()"));
    expect(call.slice(0, 400)).toContain(".catch(");
  });

  it("resumes a needs_regen job that kept its clips, and counts the resume", async () => {
    const updates: any[] = [];
    // The db handle must NOT be thenable — `await getDb()` would unwrap it.
    // Only the terminal .where() of the UPDATE returns a promise.
    const updateChain: any = {
      set: (v: any) => { updates.push(v); return updateChain; },
      where: async () => [{ affectedRows: 1 }],
    };
    const chain: any = {
      select: () => chain, from: () => chain, where: () => chain,
      limit: async () => [{
        id: 7, briefId: "autopost-2026-09-19", status: "needs_regen", igPostId: null,
        clipUrlsJson: JSON.stringify(["https://a/1.mp4", "https://a/2.mp4"]),
        payload: JSON.stringify({ storyboardBeats: [1, 2, 3, 4, 5].map((n) => ({ beatNumber: n })), promptPack: [1, 2, 3, 4, 5] }),
      }],
      update: () => updateChain,
    };
    vi.doMock("./db", () => ({ getDb: async () => chain }));
    vi.resetModules();
    process.env.REEL_GENERATION_ENABLED = "true";

    const { resumeTimedOutReelJobs } = await import("./services/reelPipeline");
    const out = await resumeTimedOutReelJobs();

    expect(out.resumed).toEqual([7]);
    expect(updates[0].status).toBe("queued");
    expect(updates[0].attempts).toBe(0);
    expect(updates[0].error).toBeNull();
    expect(JSON.parse(updates[0].payload).autoResumes).toBe(1);
  });

  it("PLANTED CANARY: refuses a published job, a clip gap, a full clip set, and a job at the resume cap", async () => {
    const rows = [
      { id: 1, status: "needs_regen", igPostId: "999", clipUrlsJson: "[]", payload: "{}" },
      { id: 2, status: "needs_regen", igPostId: null, clipUrlsJson: JSON.stringify(["https://a/1.mp4", null]), payload: JSON.stringify({ storyboardBeats: [{}, {}, {}], promptPack: [1, 2, 3] }) },
      { id: 3, status: "needs_regen", igPostId: null, clipUrlsJson: JSON.stringify(["https://a/1.mp4", "https://a/2.mp4"]), payload: JSON.stringify({ storyboardBeats: [{}, {}], promptPack: [1, 2] }) },
      { id: 4, status: "needs_regen", igPostId: null, clipUrlsJson: JSON.stringify(["https://a/1.mp4"]), payload: JSON.stringify({ storyboardBeats: [{}, {}, {}], promptPack: [1, 2, 3], autoResumes: 2 }) },
    ];
    const chain: any = { select: () => chain, from: () => chain, where: () => chain, limit: async () => rows,
      update: () => { throw new Error("must not write"); } };
    vi.doMock("./db", () => ({ getDb: async () => chain }));
    vi.resetModules();
    process.env.REEL_GENERATION_ENABLED = "true";

    const { resumeTimedOutReelJobs, MAX_AUTO_RESUMES } = await import("./services/reelPipeline");
    const out = await resumeTimedOutReelJobs();

    expect(out.resumed).toEqual([]);
    expect(out.skipped.map((s: any) => s.why).sort()).toEqual(
      ["already_published", "auto_resume_cap", "clip_gap", "nothing_missing"],
    );
    expect(MAX_AUTO_RESUMES).toBe(2);
  });

  it("does nothing at all when generation is disabled", async () => {
    vi.doMock("./db", () => ({ getDb: async () => { throw new Error("must not touch the db"); } }));
    vi.resetModules();
    process.env.REEL_GENERATION_ENABLED = "false";
    const { resumeTimedOutReelJobs } = await import("./services/reelPipeline");
    await expect(resumeTimedOutReelJobs()).resolves.toEqual({ resumed: [], skipped: [] });
  });
});
