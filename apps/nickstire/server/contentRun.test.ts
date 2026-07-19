/**
 * contentRun — the two-state model, defended.
 *
 * `implementationState` (what was built) and `operationalState` (what was proven)
 * are separate columns because collapsing them is how a green checkmark ends up
 * over work that never happened. This codebase has shipped both failure modes:
 * an override button that reported success while the publish was refused, and an
 * audio gate that read "approve" from a stage that had never run.
 *
 * The rule these tests exist to enforce: `published` is not settable by
 * assertion. It requires something a human can go and look at.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let row: Record<string, unknown> | null;
let updates: Array<Record<string, unknown>>;
let inserts: Array<Record<string, unknown>>;
let dbDown: boolean;

vi.mock("./db", () => ({
  getDb: async () => {
    if (dbDown) return null;
    return {
      insert: () => ({ values: async (v: Record<string, unknown>) => { inserts.push(v); return [{ affectedRows: 1 }]; } }),
      select: () => ({ from: () => ({ where: () => ({ limit: async () => (row ? [row] : []) }) }) }),
      update: () => ({ set: (v: Record<string, unknown>) => ({ where: async () => { updates.push(v); return [{ affectedRows: 1 }]; } }) }),
    };
  },
}));

import {
  createContentRun, advanceContentRun, getContentRun,
  RUN_STAGE, IMPLEMENTATION_STATE, OPERATIONAL_STATE,
} from "./services/contentRun";

beforeEach(() => {
  updates = []; inserts = []; dbDown = false;
  row = {
    id: "run_1", stage: RUN_STAGE.requested,
    implementationState: IMPLEMENTATION_STATE.pending,
    operationalState: OPERATIONAL_STATE.unproven,
    costCents: 0,
    evidenceJson: JSON.stringify([{ at: "2026-07-19T09:00:00.000Z", what: "run requested" }]),
  };
});

describe("the published guard", () => {
  it("REFUSES to mark a run published without proof", async () => {
    // Without this, the strongest state in the system is settable by assertion.
    const ok = await advanceContentRun("run_1", {
      operationalState: OPERATIONAL_STATE.published,
      evidence: { at: "now", what: "we called the API and it did not throw" },
    });
    expect(ok).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it("ALLOWS published when there is something to point at", async () => {
    const ok = await advanceContentRun("run_1", {
      operationalState: OPERATIONAL_STATE.published,
      evidence: { at: "now", what: "posted", proof: "https://instagram.com/reel/abc" },
    });
    expect(ok).toBe(true);
    expect(updates[0].operationalState).toBe("published");
  });

  it("'we called it and it did not throw' is ATTEMPTED, and needs no proof", async () => {
    // This distinction IS the publish-ambiguity problem, in one field.
    const ok = await advanceContentRun("run_1", {
      operationalState: OPERATIONAL_STATE.attempted,
      evidence: { at: "now", what: "publish call returned without error" },
    });
    expect(ok).toBe(true);
    expect(updates[0].operationalState).toBe("attempted");
  });
});

describe("the two states are independent", () => {
  it("a BUILT run is still UNPROVEN — a green build proves nothing operationally", async () => {
    await advanceContentRun("run_1", {
      stage: RUN_STAGE.awaiting_approval,
      implementationState: IMPLEMENTATION_STATE.built,
      evidence: { at: "now", what: "media assembled and QA passed" },
    });
    const u = updates[0];
    expect(u.implementationState).toBe("built");
    // operationalState was NOT touched, so it stays unproven.
    expect(u.operationalState).toBeUndefined();
  });
});

describe("the evidence chain", () => {
  it("APPENDS rather than overwrites — the step that went wrong must survive", async () => {
    await advanceContentRun("run_1", { evidence: { at: "t2", what: "format chosen: carousel" } });
    const chain = JSON.parse(String(updates[0].evidenceJson));
    expect(chain).toHaveLength(2);
    expect(chain[0].what).toMatch(/requested/);
    expect(chain[1].what).toMatch(/carousel/);
  });

  it("survives an unreadable chain instead of losing the run", async () => {
    row = { ...row, evidenceJson: "{not json" };
    const ok = await advanceContentRun("run_1", { evidence: { at: "t2", what: "recovered" } });
    expect(ok).toBe(true);
    expect(JSON.parse(String(updates[0].evidenceJson))).toHaveLength(1);
  });
});

describe("cost accumulates", () => {
  it("adds rather than replaces, so a multi-generation run totals correctly", async () => {
    row = { ...row, costCents: 250 };
    await advanceContentRun("run_1", { addCostCents: 175 });
    expect(updates[0].costCents).toBe(425);
  });
});

describe("refusals and absences", () => {
  it("advancing a run that does not exist returns false, not a throw", async () => {
    row = null;
    expect(await advanceContentRun("nope", { stage: RUN_STAGE.qa })).toBe(false);
  });

  it("createContentRun returns null when the database is unavailable", async () => {
    dbDown = true;
    expect(await createContentRun({ requestedTopic: "brakes" })).toBeNull();
  });

  it("a new run starts pending AND unproven", async () => {
    const id = await createContentRun({ requestedTopic: "brakes", requestedBy: "7" });
    expect(id).toMatch(/^run_/);
    expect(inserts[0]).toMatchObject({
      stage: "requested", implementationState: "pending", operationalState: "unproven",
    });
    // requestedFormat omitted = "choose for me"
    expect(inserts[0].requestedFormat).toBeNull();
  });
});

describe("the operator summary states the truth once", () => {
  it("isProvenPublished is false for an ATTEMPTED run", async () => {
    row = { ...row, operationalState: OPERATIONAL_STATE.attempted };
    expect((await getContentRun("run_1"))?.isProvenPublished).toBe(false);
  });

  it("isProvenPublished is true only for a published run", async () => {
    row = { ...row, operationalState: OPERATIONAL_STATE.published };
    expect((await getContentRun("run_1"))?.isProvenPublished).toBe(true);
  });

  it("flags a held run as needing the operator", async () => {
    row = { ...row, stage: RUN_STAGE.held };
    expect((await getContentRun("run_1"))?.needsOperator).toBe(true);
  });
});

describe("column safety", () => {
  it("every state value fits varchar(32)", () => {
    for (const set of [RUN_STAGE, IMPLEMENTATION_STATE, OPERATIONAL_STATE]) {
      for (const v of Object.values(set)) expect(v.length).toBeLessThanOrEqual(32);
    }
  });
});
