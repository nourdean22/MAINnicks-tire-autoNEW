/**
 * classifyInventoryRow — a queue entry may only claim "awaiting review" if
 * something can actually be reviewed.
 *
 * Grounded in production, 2026-07-19: the Queue showed 30 reel items in
 * `pending`, every one with a failed job and no media. Thirty corpses presented
 * as work, from a leaked API key that has since been rotated.
 *
 * The classifier is deliberately narrow. It is far more dangerous to wrongly
 * bury a reviewable item than to leave a dead one visible, so every branch that
 * is not certain returns "none".
 */
import { describe, it, expect } from "vitest";
import { classifyInventoryRow, planInventoryReconcile, type InventoryJobPair } from "./services/inventoryJobReconcile";

const pair = (over: Partial<InventoryJobPair> = {}): InventoryJobPair => ({
  inventoryId: "inv_1", inventoryStatus: "pending",
  jobId: 540023, jobStatus: "failed", hasRenderedAsset: false,
  jobError: "Veo submit failed (HTTP 403): Your API key was reported as leaked.",
  ...over,
});

describe("the production case", () => {
  it("flags a pending row whose job failed with no media", () => {
    const v = classifyInventoryRow(pair());
    expect(v.action).toBe("mark_failed");
  });

  it("marks a LEAKED-KEY failure as regenerable — the brief was never the problem", () => {
    const v = classifyInventoryRow(pair());
    expect(v).toMatchObject({ regenerable: true });
    expect(v.reason).toMatch(/environmental/i);
  });

  it.each([
    "Veo submit failed (HTTP 429): monthly spending cap exceeded",
    "Higgsfield CLI exited with code 2. Stderr: Error: Session expired.",
    "recovered from stuck 'generating' (no progress >12m)",
  ])("treats '%s' as regenerable too", (err) => {
    expect(classifyInventoryRow(pair({ jobError: err })).action).toBe("mark_failed");
    expect(classifyInventoryRow(pair({ jobError: err })) as any).toMatchObject({ regenerable: true });
  });

  it("does NOT promise regeneration for a malformed brief — that is a dead end", () => {
    const v = classifyInventoryRow(pair({ jobError: "brief has no storyboardBeats" }));
    expect(v).toMatchObject({ action: "mark_failed", regenerable: false });
  });
});

describe("refuses to bury anything reviewable", () => {
  it("LEAVES a failed job that still has rendered media — that is recoverable", () => {
    // The Action Center can rebuild from surviving clips. Hiding it would remove
    // the operator's chance to recover real work.
    const v = classifyInventoryRow(pair({ hasRenderedAsset: true }));
    expect(v.action).toBe("none");
    expect(v.reason).toMatch(/rendered media survives/i);
  });

  it.each(["generating", "assembled", "queued", "publishing"])("leaves a job that is still '%s' alone", (status) => {
    // An in-flight job legitimately has no asset yet. Burying it would destroy
    // work that is actively being produced.
    expect(classifyInventoryRow(pair({ jobStatus: status })).action).toBe("none");
  });

  it("never touches a row that already published", () => {
    expect(classifyInventoryRow(pair({ inventoryStatus: "published" })).action).toBe("none");
  });

  it("never touches a manually staged row with no job behind it", () => {
    const v = classifyInventoryRow(pair({ jobId: null, jobStatus: null }));
    expect(v.action).toBe("none");
    expect(v.reason).toMatch(/no reel job/i);
  });

  it("never invents a success — the only action it can take is mark_failed", () => {
    const actions = new Set(
      ["pending", "needs_review", "published", "rejected"].flatMap((s) =>
        ["failed", "assembled", "posted", null].map((j) =>
          classifyInventoryRow(pair({ inventoryStatus: s, jobStatus: j as never })).action)),
    );
    expect([...actions].sort()).toEqual(["mark_failed", "none"]);
  });
});

describe("the plan is a report, not an action", () => {
  it("counts what would change and why, without changing anything", () => {
    const plan = planInventoryReconcile([
      pair({ inventoryId: "a" }),
      pair({ inventoryId: "b", jobError: "brief has no storyboardBeats" }),
      pair({ inventoryId: "c", hasRenderedAsset: true }),
      pair({ inventoryId: "d", inventoryStatus: "published" }),
    ]);
    // examined counts queue ROWS, not join rows — the number the operator can
    // verify by eye against the Queue screen.
    expect(plan.examined).toBe(4);
    expect(plan.misreported).toBe(2);
    expect(plan.regenerable).toBe(1);
    expect(plan.rows.map((r) => r.inventoryId)).toEqual(["a", "b"]);
  });

  it("reports zero cleanly on a healthy queue", () => {
    const plan = planInventoryReconcile([pair({ jobStatus: "assembled" })]);
    expect(plan.misreported).toBe(0);
    expect(plan.rows).toEqual([]);
  });
});

/**
 * ONE VERDICT PER INVENTORY ROW, NOT PER JOB.
 *
 * The caller joins reelJobs on briefId, so one inventory row can arrive as
 * several pairs. Classifying each independently meant one dead job could condemn
 * a queue item whose sibling job was alive — and REGENERATE DELIBERATELY CREATES
 * THAT SHAPE: it marks the old job failed and enqueues a new one against the same
 * brief. So the moment an operator regenerated a dead reel, this planner would see
 * the corpse, ignore the live replacement, and offer to kill the recovery it had
 * just been used to start.
 */
describe("a row with several jobs is judged once, by all of them", () => {
  const dead = (inventoryId: string, jobId: number) =>
    pair({ inventoryId, jobId, jobStatus: "failed", hasRenderedAsset: false });

  it("LEAVES a row whose dead job was superseded by a live regeneration", () => {
    const plan = planInventoryReconcile([
      dead("inv_1", 900001),                                                  // superseded corpse
      pair({ inventoryId: "inv_1", jobId: 900002, jobStatus: "generating" }), // the replacement
    ]);
    expect(plan.misreported).toBe(0);
    expect(plan.rows).toEqual([]);
  });

  it("counts that row ONCE as examined, not once per job", () => {
    const plan = planInventoryReconcile([dead("inv_1", 1), dead("inv_1", 2), dead("inv_1", 3)]);
    expect(plan.examined).toBe(1);
    // All three are dead, so the row IS misreported — but it is one row, not three.
    expect(plan.misreported).toBe(1);
  });

  it("reports against the NEWEST job — its failure is the current one", () => {
    const plan = planInventoryReconcile([
      pair({ inventoryId: "inv_1", jobId: 100, jobStatus: "failed", jobError: "brief has no storyboardBeats" }),
      pair({ inventoryId: "inv_1", jobId: 200, jobStatus: "failed", jobError: "Veo submit failed (HTTP 403): Your API key was reported as leaked." }),
    ]);
    expect(plan.rows[0].jobId).toBe(200);
  });

  it("stays regenerable when ANY dead sibling can be revived", () => {
    // The operator only needs one good path forward; reporting none when one
    // exists would strand recoverable work.
    const plan = planInventoryReconcile([
      pair({ inventoryId: "inv_1", jobId: 100, jobStatus: "failed", jobError: "429 spending cap" }),
      pair({ inventoryId: "inv_1", jobId: 200, jobStatus: "failed", jobError: "brief has no storyboardBeats" }),
    ]);
    expect(plan.misreported).toBe(1);
    expect(plan.regenerable).toBe(1);
  });

  it("one job with surviving media protects the whole row", () => {
    const plan = planInventoryReconcile([
      dead("inv_1", 100),
      pair({ inventoryId: "inv_1", jobId: 200, jobStatus: "failed", hasRenderedAsset: true }),
    ]);
    expect(plan.misreported).toBe(0);
  });

  it("still judges unrelated rows independently", () => {
    const plan = planInventoryReconcile([
      dead("inv_1", 1), pair({ inventoryId: "inv_1", jobId: 2, jobStatus: "generating" }),
      dead("inv_2", 3),
    ]);
    expect(plan.examined).toBe(2);
    expect(plan.rows.map((r) => r.inventoryId)).toEqual(["inv_2"]);
  });
});
