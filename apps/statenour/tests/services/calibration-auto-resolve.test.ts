/**
 * Calibration review items resolve themselves under a per-kind allowlist
 * (job 2026-10-31-self-learning-statenour W1). Disarmed by default: the
 * resolver records its decision on the item and changes nothing else until the
 * settings flag `calibration.auto_resolve_armed` is boolean true.
 *
 * The store is a small in-memory fake whose updateMany really evaluates its
 * WHERE, so the race and stale-read arms test the compare-and-swap itself, not
 * a mocked `{ count }` (claim-before-act).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, any>;

const h = vi.hoisted(() => {
  const state = {
    items: new Map<string, Row>(),
    predictions: new Map<string, Row>(),
    tasks: new Map<string, Row>(),
    prefs: new Map<string, Row>(),
    lessons: [] as Row[],
    predictionUpdates: 0,
    taskUpdates: 0,
    prefThrows: false,
    barrier: 0 as number, // >0: findMany waits until this many readers arrived
    beforeSwap: null as null | (() => void),
    rawRead: false, // findMany hands rows out uncloned (lets a test plant a throwing field)
  };
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { state, log };
});

function clone<T>(v: T): T {
  return structuredClone(v);
}

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v instanceof Date) return row[k] instanceof Date && row[k].getTime() === v.getTime();
    return row[k] === v;
  });
}

function bump(row: Row) {
  row.updatedAt = new Date(row.updatedAt.getTime() + 1000);
}

let waiting: Array<() => void> = [];

function makeClient() {
  const s = h.state;
  return {
    calibrationReviewItem: {
      findMany: async ({ where, orderBy, take }: { where: Row; orderBy?: Row; take?: number }) => {
        let rows = [...s.items.values()].filter((r) => matches(r, where));
        if (orderBy?.createdAt === "asc") rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        if (take !== undefined) rows = rows.slice(0, take);
        const out = s.rawRead ? rows : rows.map(clone);
        if (s.barrier > 0) {
          await new Promise<void>((resolve) => {
            waiting.push(resolve);
            if (waiting.length >= s.barrier) {
              const all = waiting;
              waiting = [];
              s.barrier = 0;
              all.forEach((r) => r());
            }
          });
        }
        return out;
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        if (s.beforeSwap) {
          const fn = s.beforeSwap;
          s.beforeSwap = null;
          fn();
        }
        let count = 0;
        for (const row of s.items.values()) {
          if (matches(row, where)) {
            Object.assign(row, clone(data));
            bump(row);
            count++;
          }
        }
        return { count };
      },
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const row = s.items.get(where.id);
        if (!row) throw new Error("P2025");
        Object.assign(row, clone(data));
        bump(row);
        return clone(row);
      },
    },
    prediction: {
      findUnique: async ({ where }: { where: Row }) => clone(s.predictions.get(where.id) ?? null),
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const row = s.predictions.get(where.id);
        if (!row) throw new Error("P2025: prediction not found");
        Object.assign(row, data);
        s.predictionUpdates++;
        return clone(row);
      },
    },
    task: {
      findUnique: async ({ where }: { where: Row }) => clone(s.tasks.get(where.id) ?? null),
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const row = s.tasks.get(where.id);
        if (!row) throw new Error("P2025: task not found");
        Object.assign(row, data);
        s.taskUpdates++;
        return clone(row);
      },
    },
    brainMemory: {
      upsert: async (args: Row) => {
        s.lessons.push(args);
        return {};
      },
    },
    userPreference: {
      findUnique: async ({ where }: { where: Row }) => {
        if (s.prefThrows) throw new Error("connection reset");
        return clone(s.prefs.get(where.key) ?? null);
      },
    },
  };
}

vi.mock("@/lib/prisma", () => {
  const client: Row = makeClient();
  client.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => {
    // Rollback on throw, like a real transaction.
    const snap = {
      items: clone(h.state.items),
      predictions: clone(h.state.predictions),
      tasks: clone(h.state.tasks),
      predictionUpdates: h.state.predictionUpdates,
      taskUpdates: h.state.taskUpdates,
    };
    try {
      return await fn(client);
    } catch (err) {
      h.state.items = snap.items;
      h.state.predictions = snap.predictions;
      h.state.tasks = snap.tasks;
      h.state.predictionUpdates = snap.predictionUpdates;
      h.state.taskUpdates = snap.taskUpdates;
      throw err;
    }
  };
  return { prisma: client };
});
vi.mock("@/lib/logger", () => ({ logger: { withSurface: () => h.log } }));
vi.mock("@/lib/brain/calibration-engine", () => ({ calculateScoreboardStats: vi.fn() }));

import {
  AUTO_RESOLVE_ARMED_KEY,
  AUTO_RESOLVER,
  evaluateCalibrationItem,
  runCalibrationAutoResolve,
} from "@/lib/services/calibration-auto-resolve";
import { invalidateSettingsCache } from "@/lib/services/settings";
import { bulkResolveCalibrationReviews } from "@/lib/services/system-calibration";

const T0 = new Date("2026-10-30T03:00:00Z");

function taskItem(id: string, roiScore: number, outcomeScore: number, title = "Ship the tire finder fix"): Row {
  return {
    id,
    type: "task_roi",
    sourceId: `task-${id}`,
    sourceType: "Task",
    status: "pending",
    predictedOutcome: { roiScore, title, effort: "M" },
    proposedActualOutcome: { outcomeScore, classification: "accurate", rationale: "matches" },
    approvedActualOutcome: null,
    confidence: 0.5,
    evidence: null,
    reviewedBy: null,
    reviewedAt: null,
    correctionNote: null,
    accuracyScore: null,
    calibrationImpact: null,
    createdAt: T0,
    updatedAt: T0,
  };
}

function predItem(id: string, status: string, prediction = "Weekly leads exceed 40", confidence = 0.8): Row {
  return {
    id,
    type: "prediction",
    sourceId: `pred-${id}`,
    sourceType: "Prediction",
    status: "pending",
    predictedOutcome: { status: "confirmed", confidence, prediction },
    proposedActualOutcome: { status, outcomeDescription: `Auto-graded ${status}` },
    approvedActualOutcome: null,
    confidence,
    evidence: null,
    reviewedBy: null,
    reviewedAt: null,
    correctionNote: null,
    accuracyScore: null,
    calibrationImpact: null,
    createdAt: T0,
    updatedAt: T0,
  };
}

function seed(item: Row) {
  h.state.items.set(item.id, item);
  if (item.sourceType === "Prediction") {
    h.state.predictions.set(item.sourceId, {
      id: item.sourceId,
      prediction: item.predictedOutcome.prediction,
      confidence: item.confidence,
      status: "pending",
      outcome: null,
      brierScore: null,
    });
  } else {
    h.state.tasks.set(item.sourceId, { id: item.sourceId, title: item.predictedOutcome.title, outcomeScore: null });
  }
}

function arm(value: unknown = true, type = "boolean") {
  h.state.prefs.set(AUTO_RESOLVE_ARMED_KEY, { key: AUTO_RESOLVE_ARMED_KEY, value: String(value), type });
}

const item = (id: string) => h.state.items.get(id)!;
const decisionOf = (id: string) => item(id).calibrationImpact?.autoResolve;

beforeEach(() => {
  h.state.items = new Map();
  h.state.predictions = new Map();
  h.state.tasks = new Map();
  h.state.prefs = new Map();
  h.state.lessons = [];
  h.state.predictionUpdates = 0;
  h.state.taskUpdates = 0;
  h.state.prefThrows = false;
  h.state.barrier = 0;
  h.state.beforeSwap = null;
  h.state.rawRead = false;
  waiting = [];
  Object.values(h.log).forEach((f) => f.mockClear());
  invalidateSettingsCache();
});

describe("allowlist: one test per kind", () => {
  it("task_roi_close_match: proposed score within 5 of the estimate is in scope", () => {
    expect(evaluateCalibrationItem(taskItem("a", 70, 74) as never)).toMatchObject({
      verdict: "resolve",
      kind: "task_roi_close_match",
    });
  });

  it("task_roi_close_match: a gap of 6 is out of scope", () => {
    expect(evaluateCalibrationItem(taskItem("a", 70, 76) as never)).toEqual({
      verdict: "hold",
      kind: null,
      reason: "out of scope",
    });
  });

  it("prediction_graded: a confirmed or disproven grade is in scope", () => {
    expect(evaluateCalibrationItem(predItem("p", "confirmed") as never)).toMatchObject({
      verdict: "resolve",
      kind: "prediction_graded",
    });
    expect(evaluateCalibrationItem(predItem("p", "disproven") as never)).toMatchObject({
      verdict: "resolve",
      kind: "prediction_graded",
    });
  });

  it("prediction_graded: needs_more_evidence is out of scope", () => {
    expect(evaluateCalibrationItem(predItem("p", "needs_more_evidence") as never).reason).toBe("out of scope");
  });

  it("an unknown type is out of scope", () => {
    expect(evaluateCalibrationItem({ ...taskItem("a", 70, 72), type: "business_projection" } as never).reason).toBe(
      "out of scope",
    );
  });

  it("a safety, personal-data or spend item is held even when its numbers fit a kind", () => {
    const spend = evaluateCalibrationItem(predItem("p", "confirmed", "Ad spend stays under budget") as never);
    expect(spend.verdict).toBe("hold");
    expect(spend.reason).toMatch(/^excluded:/);
    const pii = evaluateCalibrationItem(taskItem("a", 70, 71, "Scrub personal data from exports") as never);
    expect(pii.verdict).toBe("hold");
    expect(pii.reason).toMatch(/^excluded:/);
  });

  it("plural and cost words are held too (payments, credentials, hosting costs, invoices)", () => {
    for (const title of [
      "Fix failed payments at checkout",
      "Rotate the Railway credentials",
      "Cut hosting costs under 40 a month",
      "Send overdue invoices",
    ]) {
      const d = evaluateCalibrationItem(taskItem("a", 70, 71, title) as never);
      expect(d, title).toMatchObject({ verdict: "hold", reason: expect.stringMatching(/^excluded:/) });
    }
  });
});

describe("the bulk 'approve low risk' tap after the writer extraction", () => {
  it("writes the same source rows, item fields and lessons as before", async () => {
    seed(taskItem("a", 70, 74));
    seed(predItem("p", "disproven"));
    seed(taskItem("far", 70, 90));
    expect(await bulkResolveCalibrationReviews("approve_low_risk")).toEqual({ processedCount: 2 });
    expect(h.state.tasks.get("task-a")!.outcomeScore).toBe(74);
    expect(h.state.predictions.get("pred-p")).toMatchObject({
      status: "disproven",
      outcome: "Auto-graded disproven",
      brierScore: expect.closeTo(0.64, 10),
    });
    for (const id of ["a", "p"]) {
      expect(item(id)).toMatchObject({
        status: "approved",
        reviewedBy: "owner",
        correctionNote: "Bulk auto-approved (low risk)",
        approvedActualOutcome: item(id).proposedActualOutcome,
      });
    }
    expect(item("a").accuracyScore).toBe(4);
    expect(item("far").status).toBe("pending");
    expect(h.state.lessons.map((l) => l.where.category_key.key).sort()).toEqual(["pred-calib-pred-p", "task-roi-task-a"]);
    expect(h.state.lessons.find((l) => l.where.category_key.key === "task-roi-task-a")!.create.content).toContain(
      "Note: Bulk auto-approved (low risk)",
    );
  });
});

describe("runCalibrationAutoResolve", () => {
  it("(1) armed: an in-scope task item resolves with no tap", async () => {
    arm();
    seed(taskItem("a", 70, 74));
    const r = await runCalibrationAutoResolve(T0);
    expect(r).toMatchObject({ armed: true, scanned: 1, resolved: 1, errors: 0 });
    expect(item("a")).toMatchObject({
      status: "approved",
      reviewedBy: AUTO_RESOLVER,
      approvedActualOutcome: { outcomeScore: 74 },
      accuracyScore: 4,
    });
    expect(h.state.tasks.get("task-a")!.outcomeScore).toBe(74);
    expect(decisionOf("a")).toMatchObject({
      decision: "resolve",
      kind: "task_roi_close_match",
      previousStatus: "pending",
      previousSource: { outcomeScore: null },
      applied: true,
      decidedAt: T0.toISOString(),
    });
    expect(h.state.lessons).toHaveLength(1);
  });

  it("(1) armed: an in-scope prediction resolves through the review writer (status, Brier, lesson)", async () => {
    arm();
    seed(predItem("p", "confirmed"));
    const r = await runCalibrationAutoResolve(T0);
    expect(r.resolved).toBe(1);
    const pred = h.state.predictions.get("pred-p")!;
    expect(pred.status).toBe("confirmed");
    expect(pred.brierScore).toBeCloseTo(0.04, 10);
    expect(item("p").accuracyScore).toBeCloseTo(0.04, 10);
    expect(decisionOf("p").previousSource).toEqual({ status: "pending", outcome: null, brierScore: null });
    expect(h.state.lessons[0].where.category_key.key).toBe("pred-calib-pred-p");
  });

  it("(2) an out-of-scope item stays pending with reason out of scope, armed or not", async () => {
    arm();
    seed(taskItem("a", 70, 90));
    const r = await runCalibrationAutoResolve(T0);
    expect(r).toMatchObject({ resolved: 0, held: 1 });
    expect(item("a").status).toBe("pending");
    expect(decisionOf("a")).toMatchObject({ decision: "hold", reason: "out of scope", applied: false });
    expect(h.state.taskUpdates).toBe(0);
  });

  it("(3) two runners racing on the same stale read resolve once", async () => {
    arm();
    seed(predItem("p", "confirmed"));
    h.state.barrier = 2;
    const [a, b] = await Promise.all([runCalibrationAutoResolve(T0), runCalibrationAutoResolve(T0)]);
    expect(a.resolved + b.resolved).toBe(1);
    expect(a.lost + b.lost).toBe(1);
    expect(h.state.predictionUpdates).toBe(1);
    expect(h.state.lessons).toHaveLength(1);
  });

  it("(3) a proposal rewritten between the read and the swap is not applied this tick", async () => {
    arm();
    seed(taskItem("a", 70, 74));
    // The generator re-proposes a far-off score after the resolver read the row.
    h.state.beforeSwap = () => {
      const row = item("a");
      row.proposedActualOutcome = { outcomeScore: 20, classification: "overestimated" };
      bump(row);
    };
    const r = await runCalibrationAutoResolve(T0);
    expect(r).toMatchObject({ resolved: 0, lost: 1 });
    expect(item("a").status).toBe("pending");
    expect(h.state.taskUpdates).toBe(0);
  });

  it("(4) disarmed by default: the decision is recorded and the item is untouched", async () => {
    seed(predItem("p", "confirmed"));
    const r = await runCalibrationAutoResolve(T0);
    expect(r).toMatchObject({ armed: false, resolved: 0, shadowed: 1 });
    expect(item("p")).toMatchObject({ status: "pending", reviewedBy: null, approvedActualOutcome: null });
    expect(decisionOf("p")).toMatchObject({ decision: "resolve", kind: "prediction_graded", applied: false });
    expect(h.state.predictionUpdates).toBe(0);
    expect(h.state.lessons).toHaveLength(0);
  });

  it("(4) only a boolean true arms it; a string or a failed flag read stays disarmed", async () => {
    seed(predItem("p", "confirmed"));
    arm("true", "string");
    expect((await runCalibrationAutoResolve(T0)).armed).toBe(false);
    invalidateSettingsCache();
    arm();
    h.state.prefThrows = true;
    const r = await runCalibrationAutoResolve(T0);
    expect(r.armed).toBe(false);
    expect(item("p").status).toBe("pending");
    expect(h.log.error).toHaveBeenCalled();
  });

  it("(5) a thrown evaluator error leaves the item pending and is logged", async () => {
    arm();
    seed(predItem("p", "confirmed"));
    Object.defineProperty(item("p"), "predictedOutcome", {
      enumerable: true,
      get() {
        throw new Error("malformed json");
      },
    });
    h.state.rawRead = true; // structuredClone would invoke the getter
    const r = await runCalibrationAutoResolve(T0);
    expect(r).toMatchObject({ resolved: 0, errors: 1 });
    expect(h.state.items.get("p")!.status).toBe("pending");
    expect(h.state.predictionUpdates).toBe(0);
    expect(h.log.error).toHaveBeenCalledWith("evaluate_failed", expect.objectContaining({ itemId: "p" }));
  });

  it("(5) a source write that fails after the claim rolls the claim back", async () => {
    arm();
    seed(predItem("p", "confirmed"));
    h.state.predictions.clear(); // the Prediction row is gone
    const r = await runCalibrationAutoResolve(T0);
    expect(r).toMatchObject({ resolved: 0, errors: 1 });
    expect(item("p").status).toBe("pending");
    expect(item("p").reviewedBy).toBeNull();
    expect(h.state.lessons).toHaveLength(0);
  });

  it("(6) armed: a re-run of the tick resolves nothing twice", async () => {
    arm();
    seed(predItem("p", "confirmed"));
    seed(taskItem("a", 70, 72));
    expect((await runCalibrationAutoResolve(T0)).resolved).toBe(2);
    const second = await runCalibrationAutoResolve(new Date(T0.getTime() + 86_400_000));
    expect(second).toMatchObject({ scanned: 0, resolved: 0 });
    expect(h.state.predictionUpdates).toBe(1);
    expect(h.state.taskUpdates).toBe(1);
  });

  it("a backlog of held items older than a new one never starves the new one", async () => {
    for (let i = 0; i < 120; i++) {
      const old = taskItem(`old${i}`, 70, 95);
      old.createdAt = new Date(T0.getTime() - (200 - i) * 60_000);
      seed(old);
    }
    expect((await runCalibrationAutoResolve(T0)).held).toBe(100); // first tick: write budget
    seed(predItem("new", "confirmed"));
    const r = await runCalibrationAutoResolve(new Date(T0.getTime() + 86_400_000));
    expect(decisionOf("new")).toMatchObject({ decision: "resolve", kind: "prediction_graded" });
    expect(r).toMatchObject({ scanned: 121, unchanged: 100, held: 20, shadowed: 1, deferred: 0 });
  });

  it("writes stop at the per-tick budget; the rest are deferred to the next tick", async () => {
    for (let i = 0; i < 101; i++) seed(predItem(`p${i}`, "confirmed"));
    expect(await runCalibrationAutoResolve(T0)).toMatchObject({ scanned: 101, shadowed: 100, deferred: 1 });
    expect(await runCalibrationAutoResolve(T0)).toMatchObject({ unchanged: 100, shadowed: 1, deferred: 0 });
  });

  it("(6) disarmed: a re-run keeps the first decision and writes nothing", async () => {
    seed(predItem("p", "confirmed"));
    seed(taskItem("a", 70, 95));
    expect((await runCalibrationAutoResolve(T0)).shadowed).toBe(1);
    const firstA = clone(item("a"));
    const firstP = clone(item("p"));
    const second = await runCalibrationAutoResolve(new Date(T0.getTime() + 86_400_000));
    expect(second).toMatchObject({ shadowed: 0, held: 0, unchanged: 2 });
    expect(item("a").updatedAt.getTime()).toBe(firstA.updatedAt.getTime());
    expect(item("p").updatedAt.getTime()).toBe(firstP.updatedAt.getTime());
    expect(decisionOf("p").decidedAt).toBe(T0.toISOString());
  });
});
