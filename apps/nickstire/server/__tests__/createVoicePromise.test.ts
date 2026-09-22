/**
 * `createVoicePromise` — a shop COMMITMENT becomes a promise; a customer
 * REQUEST does not, and a promise never invents its own deadline.
 *
 * The Promise Ledger existed, was wired to a router, a UI panel and the
 * morning brief — and had no voice writer at all. Every promise in it had to be
 * typed by hand by the operator, while the highest-volume source of promises in
 * the business (Nick offering a callback on a live call) recorded nothing.
 *
 * The two refusals below are the load-bearing behaviour, not edge cases:
 *
 *   - NO DERIVABLE DUE TIME → NO PROMISE. `due_at` is what kept-vs-missed is
 *     scored against, so a fabricated deadline manufactures a breach the shop
 *     never agreed to.
 *   - IDEMPOTENT ON THE CALL ID. VAPI redelivers webhooks; without a guard one
 *     promise becomes three and the kept-rate denominator silently inflates.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.fn();
const getDb = vi.fn(async () => ({ execute }));

vi.mock("../db", () => ({ getDb: () => getDb() }));

/** Rows come back from mysql2 as [rows, fields]. */
const asRows = (rows: unknown[]) => [rows, []];

beforeEach(() => {
  execute.mockReset();
  getDb.mockClear();
  getDb.mockImplementation(async () => ({ execute }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

const DUE = new Date("2026-09-23T12:00:00Z");

async function subject() {
  return (await import("../services/promiseLedger")).createVoicePromise;
}

describe("it refuses to invent a deadline", () => {
  it("a null dueAt is SKIPPED, not defaulted to some arbitrary time", async () => {
    const createVoicePromise = await subject();
    const res = await createVoicePromise({
      promiseType: "callback",
      promisedAction: "Call Jane back",
      vapiCallId: "call_1",
      dueAt: null,
    });
    expect(res).toEqual({ ok: false, skipped: true, reason: "no_due_time" });
    // The critical assertion: it must not have touched the database at all.
    expect(execute).not.toHaveBeenCalled();
  });

  it("a missing call id is SKIPPED — no idempotency key means no safe write", async () => {
    const createVoicePromise = await subject();
    const res = await createVoicePromise({
      promiseType: "callback",
      promisedAction: "Call Jane back",
      vapiCallId: "",
      dueAt: DUE,
    });
    expect(res).toEqual({ ok: false, skipped: true, reason: "no_call_id" });
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("it is idempotent on the call", () => {
  it("a second delivery of the same call returns the EXISTING id and inserts nothing", async () => {
    const createVoicePromise = await subject();
    // First execute() is the dedupe SELECT, and it finds a row.
    execute.mockResolvedValueOnce(asRows([{ id: "existing-uuid" }]));

    const res = await createVoicePromise({
      promiseType: "callback",
      promisedAction: "Call Jane back",
      vapiCallId: "call_dup",
      dueAt: DUE,
    });

    expect(res).toEqual({ ok: true, id: "existing-uuid", created: false, reason: "duplicate" });
    // Exactly one statement ran — the SELECT. No INSERT followed.
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("a first delivery DOES insert", async () => {
    const createVoicePromise = await subject();
    execute
      .mockResolvedValueOnce(asRows([]))   // dedupe SELECT → nothing
      .mockResolvedValueOnce(asRows([]));  // INSERT

    const res = await createVoicePromise({
      promiseType: "callback",
      promisedAction: "Call Jane back",
      vapiCallId: "call_new",
      dueAt: DUE,
    });

    expect(res).toMatchObject({ ok: true, created: true });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("POSITIVE CONTROL: duplicate and first-delivery take DIFFERENT paths", async () => {
    // Without this, a function that always returned `duplicate` would satisfy
    // the dedupe test, and one that always inserted would satisfy the other.
    const createVoicePromise = await subject();

    execute.mockResolvedValueOnce(asRows([{ id: "x" }]));
    const dup = await createVoicePromise({
      promiseType: "callback", promisedAction: "a", vapiCallId: "c1", dueAt: DUE,
    });

    execute.mockReset();
    execute.mockResolvedValueOnce(asRows([])).mockResolvedValueOnce(asRows([]));
    const fresh = await createVoicePromise({
      promiseType: "callback", promisedAction: "a", vapiCallId: "c2", dueAt: DUE,
    });

    expect((dup as { created: boolean }).created).toBe(false);
    expect((fresh as { created: boolean }).created).toBe(true);
  });
});

describe("it degrades rather than breaking the call", () => {
  it("an unavailable DB returns an error object, never throws", async () => {
    const createVoicePromise = await subject();
    getDb.mockImplementation(async () => null as unknown as { execute: typeof execute });
    const res = await createVoicePromise({
      promiseType: "callback",
      promisedAction: "Call Jane back",
      vapiCallId: "call_nodb",
      dueAt: DUE,
    });
    expect(res).toEqual({ ok: false, error: "DB unavailable" });
  });

  it("the un-applied 0102 table is reported, not thrown", async () => {
    const createVoicePromise = await subject();
    const missing = Object.assign(new Error("Table 'customer_promises' doesn't exist"), {
      code: "ER_NO_SUCH_TABLE",
    });
    execute.mockRejectedValueOnce(missing);
    const res = await createVoicePromise({
      promiseType: "callback",
      promisedAction: "Call Jane back",
      vapiCallId: "call_notable",
      dueAt: DUE,
    });
    expect(res).toMatchObject({ ok: false });
    expect((res as { error: string }).error).toContain("0102");
  });
});

/**
 * The race the read-then-write CANNOT close, now that 0125 is live in production.
 *
 * Applying uq_promise_source did not delete a failure mode, it moved one. Before
 * the index, two concurrent VAPI deliveries both read "absent" and both inserted:
 * two rows, no error, silent denominator inflation. After the index, the second
 * INSERT is rejected — so the same race that used to corrupt data now throws
 * ER_DUP_ENTRY straight out into the webhook path unless the caller interprets it.
 *
 * It is not a failed write. It is someone else's successful one, which is exactly
 * what the pre-check would have reported a millisecond earlier. These tests pin
 * that interpretation, and pin its LIMITS: the catch reads one specific signal and
 * must not become a place where writes quietly disappear.
 */
const dupErr = () =>
  Object.assign(
    new Error("Duplicate entry 'voice-call_race-callback' for key 'customer_promises.uq_promise_source'"),
    { code: "ER_DUP_ENTRY" },
  );

describe("the uq_promise_source race (migration 0125)", () => {
  it("a unique-key rejection resolves to the row that won, not an error", async () => {
    const createVoicePromise = await subject();
    execute
      .mockResolvedValueOnce(asRows([]))        // dedupe SELECT → nothing yet
      .mockRejectedValueOnce(dupErr())          // INSERT → the index rejects us
      .mockResolvedValueOnce(asRows([{ id: "winner-uuid" }])); // re-read → they won

    const res = await createVoicePromise({
      promiseType: "callback",
      promisedAction: "Call Jane back",
      vapiCallId: "call_race",
      dueAt: DUE,
    });

    expect(res).toEqual({ ok: true, id: "winner-uuid", created: false, reason: "duplicate" });
    // Three statements prove the RACE path ran, not the pre-check shortcut:
    // SELECT (empty) → INSERT (rejected) → SELECT (found).
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("a duplicate-key error with NO matching row still THROWS — the catch is scoped", async () => {
    // If this swallowed, the catch would become a silent write-loss for any
    // future constraint on this table. A guard that turns unknown failures into
    // success is worse than no guard.
    const createVoicePromise = await subject();
    execute
      .mockResolvedValueOnce(asRows([]))   // dedupe SELECT
      .mockRejectedValueOnce(dupErr())     // INSERT rejected
      .mockResolvedValueOnce(asRows([]));  // re-read finds nothing → not our index

    await expect(
      createVoicePromise({
        promiseType: "callback",
        promisedAction: "Call Jane back",
        vapiCallId: "call_other_constraint",
        dueAt: DUE,
      }),
    ).rejects.toThrow(/Duplicate entry/);
  });

  it("a non-duplicate insert failure is NOT reinterpreted as a duplicate", async () => {
    const createVoicePromise = await subject();
    execute
      .mockResolvedValueOnce(asRows([]))
      .mockRejectedValueOnce(Object.assign(new Error("ER_LOCK_DEADLOCK: deadlock found"), { code: "ER_LOCK_DEADLOCK" }));

    await expect(
      createVoicePromise({
        promiseType: "callback",
        promisedAction: "Call Jane back",
        vapiCallId: "call_deadlock",
        dueAt: DUE,
      }),
    ).rejects.toThrow(/deadlock/);
  });

  it("POSITIVE CONTROL: the race path and the pre-check path are distinguishable", async () => {
    // Both return created:false, so without counting statements a function that
    // never reached the INSERT would satisfy the race test by accident.
    const createVoicePromise = await subject();

    execute.mockResolvedValueOnce(asRows([{ id: "pre" }]));
    const precheck = await createVoicePromise({
      promiseType: "callback", promisedAction: "a", vapiCallId: "c1", dueAt: DUE,
    });
    const precheckCalls = execute.mock.calls.length;

    execute.mockReset();
    execute
      .mockResolvedValueOnce(asRows([]))
      .mockRejectedValueOnce(dupErr())
      .mockResolvedValueOnce(asRows([{ id: "raced" }]));
    const raced = await createVoicePromise({
      promiseType: "callback", promisedAction: "a", vapiCallId: "c2", dueAt: DUE,
    });

    expect((precheck as { created: boolean }).created).toBe(false);
    expect((raced as { created: boolean }).created).toBe(false);
    expect(precheckCalls).toBe(1);
    expect(execute.mock.calls.length).toBe(3);
    expect((precheck as { id: string }).id).not.toBe((raced as { id: string }).id);
  });
});
