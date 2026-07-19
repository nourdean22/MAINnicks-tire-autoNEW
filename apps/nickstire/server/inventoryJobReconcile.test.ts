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
