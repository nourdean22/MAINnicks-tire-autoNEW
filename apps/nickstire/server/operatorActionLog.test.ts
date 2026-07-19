/**
 * withOperatorAction — observability that must never block recovery.
 *
 * The distinction this file exists to protect: a REFUSED action (the system did
 * not permit it) and a FAILED action (it was permitted and broke) need different
 * fixes. "Operators keep being refused" is a policy problem; "this keeps
 * breaking" is a defect. Collapsing them into one bucket makes the log useless
 * for exactly the question it was built to answer.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let inserted: Array<Record<string, unknown>>;
let insertThrows: boolean;

vi.mock("./db", () => ({
  getDb: async () => ({
    insert: () => ({
      values: async (v: Record<string, unknown>) => {
        if (insertThrows) throw new Error("db down");
        inserted.push(v);
        return [{ affectedRows: 1 }];
      },
    }),
  }),
}));

import { withOperatorAction, recordOperatorAction, ACTION_OUTCOME } from "./services/operatorActionLog";

const ctx = () => JSON.parse(String(inserted[0]?.contextJson ?? "{}"));

beforeEach(() => {
  inserted = [];
  insertThrows = false;
});

describe("outcome classification", () => {
  it("records OK with a duration on success", async () => {
    const r = await withOperatorAction({ action: "reassemble", operatorId: 7, jobId: 42 }, async () => ({ jobId: 42, clipsUsed: 6 }));
    expect(r).toMatchObject({ clipsUsed: 6 });
    expect(inserted[0]).toMatchObject({ actionType: "operator_reassemble", decision: "OK" });
    const c = ctx();
    expect(c).toMatchObject({ operatorId: 7, jobId: 42 });
    expect(typeof c.durationMs).toBe("number");
    // The summariser keeps the useful fields and drops the rest.
    expect(c.result).toMatchObject({ clipsUsed: 6 });
  });

  it("classifies a REFUSAL separately from a failure", async () => {
    await expect(withOperatorAction({ action: "discard", jobId: 1 }, async () => {
      throw new Error("BAD_REQUEST: this job cannot be closed from here");
    })).rejects.toThrow();
    expect(inserted[0].decision).toBe(ACTION_OUTCOME.refused);
  });

  it("classifies a genuine break as FAILED", async () => {
    await expect(withOperatorAction({ action: "reassemble", jobId: 1 }, async () => {
      throw new Error("ffmpeg exited 1");
    })).rejects.toThrow();
    expect(inserted[0].decision).toBe(ACTION_OUTCOME.failed);
  });

  it("RE-THROWS the original error — the caller still sees it", async () => {
    const boom = new Error("ffmpeg exited 1");
    await expect(withOperatorAction({ action: "x" }, async () => { throw boom; })).rejects.toBe(boom);
  });

  it("marks the money-spending action as such", async () => {
    await withOperatorAction({ action: "regenerate", jobId: 9, costsMoney: true }, async () => ({ newJobId: 10 }));
    expect(ctx()).toMatchObject({ costsMoney: true, action: "regenerate" });
  });
});

describe("must never block recovery", () => {
  it("a logging failure does not break the wrapped action", async () => {
    // Unlike the publish-attempt ledger, where the record IS the safety property,
    // losing a telemetry row must never stop an operator recovering a reel.
    insertThrows = true;
    const r = await withOperatorAction({ action: "reassemble", jobId: 1 }, async () => "done");
    expect(r).toBe("done");
    expect(inserted).toHaveLength(0);
  });

  it("recordOperatorAction never throws", async () => {
    insertThrows = true;
    await expect(recordOperatorAction({ action: "x", outcome: ACTION_OUTCOME.ok })).resolves.toBeUndefined();
  });
});

describe("column safety", () => {
  it("keeps every outcome inside decision varchar(24)", () => {
    for (const v of Object.values(ACTION_OUTCOME)) expect(v.length).toBeLessThanOrEqual(24);
  });

  it("keeps actionType inside varchar(48) even for a long action name", async () => {
    await withOperatorAction({ action: "a".repeat(80) }, async () => null);
    expect(String(inserted[0].actionType).length).toBeLessThanOrEqual(48);
  });
});
