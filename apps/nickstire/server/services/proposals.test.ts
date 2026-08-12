/**
 * Approval-queue mechanisms (0111).
 *
 * The safety property under test is BACKEND-ENFORCED APPROVAL:
 *   1. the transition matrix makes execution unreachable except through
 *      approved → executing (a rejected/executed row has no path back);
 *   2. payloads are validated against the executor registry at INTAKE, so a
 *      malformed draft can never sit in the queue looking approvable;
 *   3. approveAndExecute runs the executor exactly once, only after the CAS
 *      claim succeeds — a lost claim means the executor is never invoked;
 *   4. an unreadable queue reports readable:false, never a confident zero.
 *
 * db-helper, ../db and the activity ledger are mocked with COMPLETE factories
 * (singleFork hygiene: no partial mocks, no env/global mutation).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const dbState: {
  /** scripted affectedRows for successive update() calls */
  updateResults: number[];
  /** row returned by select().from().where().limit() */
  selectRows: unknown[];
  updates: Array<Record<string, unknown>>;
  inserts: Array<Record<string, unknown>>;
} = { updateResults: [], selectRows: [], updates: [], inserts: [] };

vi.mock("../lib/db-helper", () => ({
  db: vi.fn(async () => ({
    update: () => ({
      set: (s: Record<string, unknown>) => ({
        where: async () => {
          dbState.updates.push(s);
          return [{ affectedRows: dbState.updateResults.shift() ?? 0 }, []];
        },
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => {
          const rows = dbState.selectRows;
          // getProposal uses .limit(); listProposals uses .orderBy().limit().
          return {
            limit: async () => rows,
            orderBy: () => ({ limit: async () => rows }),
          };
        },
      }),
    }),
    insert: () => ({
      values: async (v: Record<string, unknown>) => {
        dbState.inserts.push(v);
      },
    }),
  })),
}));

const recordActivity = vi.fn(async (_input: unknown) => {});
vi.mock("./activityLedger", () => ({
  recordActivity: (input: unknown) => recordActivity(input),
}));

const createCallbackRequest = vi.fn(async (_input: unknown) => ({ success: true, id: 77 }));
const createBooking = vi.fn(async (_input: unknown) => ({ success: true, id: 88 }));
vi.mock("../db", () => ({
  createCallbackRequest: (input: unknown) => createCallbackRequest(input),
  createBooking: (input: unknown) => createBooking(input),
}));

import {
  approveAndExecute,
  canTransition,
  createBookingRequestPayload,
  createCallbackPayload,
  createProposal,
  getExecutor,
  listExecutors,
  PROPOSAL_STATUSES,
  PROPOSAL_TRANSITIONS,
  rejectProposal,
} from "./proposals";

const REVIEWER = { actor: "owner@nickstire.org", actorType: "human_user" as const };

beforeEach(() => {
  dbState.updateResults = [];
  dbState.selectRows = [];
  dbState.updates = [];
  dbState.inserts = [];
  recordActivity.mockClear();
  createCallbackRequest.mockClear();
  createBooking.mockClear();
});

describe("transition matrix — execution is structurally unreachable from terminal states", () => {
  it("only approved reaches executing", () => {
    for (const from of PROPOSAL_STATUSES) {
      expect(canTransition(from, "executing"), `${from} → executing`).toBe(from === "approved");
    }
  });

  it("rejected and executed are terminal", () => {
    for (const to of PROPOSAL_STATUSES) {
      expect(canTransition("rejected", to), `rejected → ${to}`).toBe(false);
      expect(canTransition("executed", to), `executed → ${to}`).toBe(false);
    }
  });

  it("failed can only be re-approved (the operator retry door)", () => {
    expect(PROPOSAL_TRANSITIONS.failed).toEqual(["approved"]);
  });
});

describe("executor registry — intake validation", () => {
  it("exposes exactly the internal-record executors", () => {
    expect(listExecutors().map((e) => e.actionType).sort()).toEqual([
      "create_booking_request",
      "create_callback",
    ]);
    expect(getExecutor("send_sms")).toBeUndefined();
  });

  it("callback payload requires name, phone and reason", () => {
    expect(createCallbackPayload.safeParse({ name: "Jane", phone: "2168620005", reason: "wants tires" }).success).toBe(true);
    expect(createCallbackPayload.safeParse({ name: "Jane", reason: "wants tires" }).success).toBe(false);
    expect(createCallbackPayload.safeParse({ name: "Jane", phone: "2168620005", reason: "" }).success).toBe(false);
  });

  it("booking payload enforces the YYYY-MM-DD date shape", () => {
    const base = { name: "Jane", phone: "2168620005", service: "brakes" };
    expect(createBookingRequestPayload.safeParse(base).success).toBe(true);
    expect(createBookingRequestPayload.safeParse({ ...base, preferredDate: "2026-08-15" }).success).toBe(true);
    expect(createBookingRequestPayload.safeParse({ ...base, preferredDate: "next tuesday" }).success).toBe(false);
  });

  it("createProposal refuses unknown action types and malformed payloads before touching the db", async () => {
    const unknown = await createProposal({
      source: "ai_agent",
      actor: "test",
      actionType: "delete_everything",
      title: "nope",
      payload: {},
    });
    expect(unknown).toMatchObject({ created: false, deduped: false });

    const malformed = await createProposal({
      source: "ai_agent",
      actor: "test",
      actionType: "create_callback",
      title: "missing phone",
      payload: { name: "Jane", reason: "call me" },
    });
    expect(malformed).toMatchObject({ created: false, deduped: false });
    expect(dbState.inserts).toHaveLength(0);
  });

  it("createProposal inserts a draft and writes a 'proposed' ledger row", async () => {
    const result = await createProposal({
      source: "nick_receptionist",
      actor: "nick-receptionist",
      actionType: "create_callback",
      title: "Callback: Jane Driver",
      payload: { name: "Jane Driver", phone: "2168620005", reason: "quote follow-up" },
      confidence: 82,
    });
    expect(result.created).toBe(true);
    expect(dbState.inserts).toHaveLength(1);
    expect(dbState.inserts[0]).toMatchObject({ status: "draft", actionType: "create_callback", confidence: 82 });
    expect(recordActivity).toHaveBeenCalledTimes(1);
    expect(recordActivity.mock.calls[0]?.[0]).toMatchObject({ action: "proposal.created", status: "proposed" });
  });
});

describe("approveAndExecute — the one execution path", () => {
  const row = {
    id: "11111111-1111-4111-8111-111111111111",
    actionType: "create_callback",
    payloadJson: { name: "Jane", phone: "2168620005", reason: "quote follow-up" },
    status: "executing",
  };

  it("runs the executor exactly once after both CAS claims succeed", async () => {
    dbState.updateResults = [1, 1, 1]; // approve, claim executing, mark executed
    dbState.selectRows = [row];
    const outcome = await approveAndExecute(row.id, REVIEWER);
    expect(outcome).toMatchObject({ ok: true, status: "executed", result: { callbackId: 77 } });
    expect(createCallbackRequest).toHaveBeenCalledTimes(1);
    // Terminal write carries the execution result.
    expect(dbState.updates.at(-1)).toMatchObject({ status: "executed" });
  });

  it("never invokes the executor when the approve CAS loses (already decided)", async () => {
    dbState.updateResults = [0]; // approve claim fails
    dbState.selectRows = [{ ...row, status: "rejected" }];
    const outcome = await approveAndExecute(row.id, REVIEWER);
    expect(outcome.ok).toBe(false);
    expect(outcome.status).toBe("rejected");
    expect(createCallbackRequest).not.toHaveBeenCalled();
    expect(createBooking).not.toHaveBeenCalled();
  });

  it("marks the row failed (and audits it) when the executor throws", async () => {
    createCallbackRequest.mockRejectedValueOnce(new Error("db down"));
    dbState.updateResults = [1, 1, 1]; // approve, claim, mark failed
    dbState.selectRows = [row];
    const outcome = await approveAndExecute(row.id, REVIEWER);
    expect(outcome).toMatchObject({ ok: false, status: "failed" });
    expect(dbState.updates.at(-1)).toMatchObject({ status: "failed" });
    const actions = recordActivity.mock.calls.map((c) => (c[0] as { action: string }).action);
    expect(actions).toContain("proposal.execution_failed");
  });
});

describe("retryExecution — crash-orphan semantics", () => {
  const row = {
    id: "22222222-2222-4222-8222-222222222222",
    actionType: "create_callback",
    payloadJson: { name: "Jane", phone: "2168620005", reason: "retry me" },
    status: "executing",
  };

  it("RESUMES an approved crash orphan (execution claim never landed — provably never ran)", async () => {
    const { retryExecution } = await import("./proposals");
    dbState.updateResults = [0, 1, 1]; // failed→approved loses, claim wins, terminal write
    dbState.selectRows = [{ ...row, status: "approved" }];
    const outcome = await retryExecution(row.id, REVIEWER);
    expect(outcome).toMatchObject({ ok: true, status: "executed" });
    expect(createCallbackRequest).toHaveBeenCalledTimes(1);
  });

  it("REFUSES a row stuck at executing — the action may already exist", async () => {
    const { retryExecution } = await import("./proposals");
    dbState.updateResults = [0]; // failed→approved loses
    dbState.selectRows = [{ ...row, status: "executing" }];
    const outcome = await retryExecution(row.id, REVIEWER);
    expect(outcome.ok).toBe(false);
    expect(outcome.status).toBe("executing");
    expect(createCallbackRequest).not.toHaveBeenCalled();
  });
});

describe("stale-executing sweep — parks, never retries", () => {
  const stale = {
    id: "33333333-3333-4333-8333-333333333333",
    title: "Callback: Jane",
    actionType: "create_callback",
  };

  it("parks an abandoned executing row as execution_ambiguous and runs NO executor", async () => {
    const { sweepStaleExecuting } = await import("./proposals");
    dbState.selectRows = [stale];
    dbState.updateResults = [1];
    const { parked } = await sweepStaleExecuting(15);
    expect(parked).toEqual([stale.id]);
    expect(dbState.updates[0]).toMatchObject({ status: "execution_ambiguous" });
    // The whole point: the action may already exist, so nothing re-runs.
    expect(createCallbackRequest).not.toHaveBeenCalled();
    expect(createBooking).not.toHaveBeenCalled();
  });

  it("skips a row that finished between the read and the CAS", async () => {
    const { sweepStaleExecuting } = await import("./proposals");
    dbState.selectRows = [stale];
    dbState.updateResults = [0]; // it reached a terminal state first
    const { parked } = await sweepStaleExecuting(15);
    expect(parked).toEqual([]);
  });

  it("reports nothing on a healthy queue", async () => {
    const { sweepStaleExecuting } = await import("./proposals");
    dbState.selectRows = [];
    const { parked } = await sweepStaleExecuting(15);
    expect(parked).toEqual([]);
    expect(dbState.updates).toHaveLength(0);
  });
});

describe("resolveAmbiguous — the human decides, the system never guesses", () => {
  const id = "44444444-4444-4444-8444-444444444444";

  it("'it DID happen' closes the row as executed WITHOUT running the executor", async () => {
    const { resolveAmbiguous } = await import("./proposals");
    dbState.updateResults = [1];
    const out = await resolveAmbiguous(id, REVIEWER, "executed", "found the callback row");
    expect(out).toMatchObject({ ok: true, status: "executed" });
    expect(dbState.updates[0]).toMatchObject({ status: "executed", reviewedBy: REVIEWER.actor });
    expect(createCallbackRequest).not.toHaveBeenCalled();
  });

  it("'it never happened' lands on failed, reopening the ordinary retry door", async () => {
    const { resolveAmbiguous, canTransition } = await import("./proposals");
    dbState.updateResults = [1];
    const out = await resolveAmbiguous(id, REVIEWER, "failed");
    expect(out).toMatchObject({ ok: true, status: "failed" });
    expect(canTransition("failed", "approved")).toBe(true);
  });

  it("refuses a row that is not ambiguous", async () => {
    const { resolveAmbiguous } = await import("./proposals");
    dbState.updateResults = [0];
    dbState.selectRows = [{ status: "executed" }];
    const out = await resolveAmbiguous(id, REVIEWER, "executed");
    expect(out.ok).toBe(false);
    expect(out.status).toBe("executed");
  });

  it("ambiguous is reachable ONLY from executing, and is not a dead end", async () => {
    const { canTransition, PROPOSAL_STATUSES } = await import("./proposals");
    for (const from of PROPOSAL_STATUSES) {
      expect(canTransition(from, "execution_ambiguous"), `${from} → ambiguous`).toBe(from === "executing");
    }
    expect(canTransition("execution_ambiguous", "executed")).toBe(true);
    expect(canTransition("execution_ambiguous", "failed")).toBe(true);
    // It must never re-enter execution on its own.
    expect(canTransition("execution_ambiguous", "executing")).toBe(false);
    expect(canTransition("execution_ambiguous", "approved")).toBe(false);
  });
});

describe("rejectProposal", () => {
  it("rejects a reviewable row and never touches an executor", async () => {
    dbState.updateResults = [1];
    const outcome = await rejectProposal("11111111-1111-4111-8111-111111111111", REVIEWER, "not a real request");
    expect(outcome).toMatchObject({ ok: true, status: "rejected" });
    expect(createCallbackRequest).not.toHaveBeenCalled();
    expect(dbState.updates[0]).toMatchObject({ status: "rejected", reviewNote: "not a real request" });
  });

  it("reports a conflict when the row was already decided", async () => {
    dbState.updateResults = [0];
    dbState.selectRows = [{ status: "executed" }];
    const outcome = await rejectProposal("11111111-1111-4111-8111-111111111111", REVIEWER);
    expect(outcome.ok).toBe(false);
    expect(outcome.status).toBe("executed");
  });
});
