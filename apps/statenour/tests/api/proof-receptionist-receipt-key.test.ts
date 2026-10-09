/**
 * A refused receptionist receipt must not burn its Idempotency-Key (2026-10-09).
 *
 * The bug (found by the C2_proof review, pre-existing in recordEvidenceBatch):
 * when every event in a keyed batch was refused (wrong door, PII, schema) but
 * its claim passed pre-validation, the batch still claimed the key, then the
 * claim was refused inside the transaction for dangling lineage and the key
 * was settled "none". The corrected resend under the same key came back
 * {duplicate:true, rejected:[]}, which the route answers ok:true, so the
 * corrected receipt was never written. The receptionist type made this path
 * likelier: it is door-scoped (bridge only), and its hex ids can trip the PII
 * phone tripwire, both of which refuse the event and leave the H2 claim
 * dangling.
 *
 * The fix checks lineage BEFORE the key decision. Pinned here with the real
 * recordEvidenceBatch, the real claimReceipt/settleReceipt, and an in-memory
 * bridge_receipts fake that honours the predicates the code sends (the same
 * shape as tests/api/bridge-receipts.test.ts). Positive control first: a valid
 * keyed receipt replayed under its key IS a duplicate, so the fake can see a
 * burned key at all.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = { idempotencyKey: string; route: string; resultRef: string | null; firstSeenAt: Date; lastSeenAt: Date; seenCount: number };
type Where = { idempotencyKey: string; resultRef?: null | { not: null }; lastSeenAt?: Date | { lt: Date } };

const { store, eventCreate, claimCreate, receiptFault } = vi.hoisted(() => ({
  store: new Map<string, Row>(),
  eventCreate: vi.fn(),
  claimCreate: vi.fn(),
  receiptFault: { code: null as string | null },
}));

function matches(row: Row, where: Where): boolean {
  if (row.idempotencyKey !== where.idempotencyKey) return false;
  if (where.resultRef === null && row.resultRef !== null) return false;
  if (where.resultRef && "not" in where.resultRef && row.resultRef === null) return false;
  if (where.lastSeenAt instanceof Date && row.lastSeenAt.getTime() !== where.lastSeenAt.getTime()) return false;
  if (where.lastSeenAt && !(where.lastSeenAt instanceof Date) && !(row.lastSeenAt < where.lastSeenAt.lt)) return false;
  return true;
}
function fault() {
  if (receiptFault.code) throw Object.assign(new Error("The table `public.bridge_receipts` does not exist"), { code: receiptFault.code });
}

const prismaMock = {
  bridgeReceipt: {
    createMany: vi.fn(async ({ data }: { data: Array<Omit<Row, "resultRef" | "seenCount">> }) => {
      fault();
      let count = 0;
      for (const d of data) {
        if (store.has(d.idempotencyKey)) continue; // ON CONFLICT DO NOTHING
        store.set(d.idempotencyKey, { ...d, resultRef: null, seenCount: 1 });
        count++;
      }
      return { count };
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Where; data: { resultRef?: string; lastSeenAt?: Date; seenCount?: { increment: number } } }) => {
      fault();
      const row = store.get(where.idempotencyKey);
      if (!row || !matches(row, where)) return { count: 0 };
      if (data.resultRef !== undefined) row.resultRef = data.resultRef;
      if (data.lastSeenAt) row.lastSeenAt = data.lastSeenAt;
      if (data.seenCount) row.seenCount += data.seenCount.increment;
      return { count: 1 };
    }),
    deleteMany: vi.fn(async ({ where }: { where: Where }) => {
      const row = store.get(where.idempotencyKey);
      if (!row || !matches(row, where)) return { count: 0 };
      store.delete(where.idempotencyKey);
      return { count: 1 };
    }),
    findUnique: vi.fn(async ({ where }: { where: { idempotencyKey: string } }) => {
      fault();
      const row = store.get(where.idempotencyKey);
      return row ? { resultRef: row.resultRef, seenCount: row.seenCount } : null;
    }),
  },
  realityEvent: { create: eventCreate },
  evidenceClaim: { create: claimCreate },
  // evidenceHandler (the real route wrapper) may log the request.
  apiRequestLog: { create: vi.fn().mockResolvedValue({}) },
  errorLog: { create: vi.fn().mockResolvedValue({}) },
  $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock)),
};
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock, resetQueryCount: vi.fn(), getQueryCount: vi.fn().mockReturnValue(0) }));

const K = "v1:receptionist.prompt_experiment:experiment:prompt-evolution:9f2c_4e1ab07d3e55";

/** The producer contract, as nickstire's cron:prompt-evolution-weekly posts it (ids already digit-split). */
const sampleEvent = {
  eventType: "receptionist.prompt_experiment",
  eventVersion: 1,
  occurredAt: "2026-10-12T13:33:00.000Z",
  objects: [{ type: "experiment", id: "prompt-evolution:9f2c4e1ab07d3e55" }],
  source: { system: "nickstire", uri: "cron:prompt-evolution-weekly" },
  quality: "derived",
  payload: {
    outcome: "rejected-holdout",
    promotionStage: "none",
    lanes: { parity: true, differences: [] },
    gates: { holdout: { reason: "not-significant", pValue: 0.344, comparable: 11, improved: 3, worsened: 1 }, success: null, confirmation: null },
  },
};
const sampleClaim = {
  claimText: "Receptionist prompt candidate did not beat the baseline on the holdout cohort (p=0.344, 11 comparable seeds).",
  grade: "H2",
  disposition: "refuted",
  sourceEventIndexes: [0],
};
const receipt = { events: [sampleEvent], claims: [sampleClaim], sender: "nickstire" };
/** The same receipt with a raw 10-digit run in its experiment id: the PII phone tripwire refuses the event. */
const piiTripped = { ...receipt, events: [{ ...sampleEvent, objects: [{ type: "experiment", id: "prompt-evolution:ab1234567890cdef" }] }] };

let nextId = 0;
beforeEach(() => {
  vi.clearAllMocks();
  store.clear();
  receiptFault.code = null;
  nextId = 0;
  eventCreate.mockImplementation(async () => ({ id: `evt_${++nextId}` }));
  claimCreate.mockImplementation(async () => ({ id: `clm_${++nextId}` }));
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock));
});

describe("recordEvidenceBatch: a refused receipt does not burn its Idempotency-Key", () => {
  it("positive control: a valid keyed receipt lands once and its replay under the same key is a duplicate", async () => {
    const { recordEvidenceBatch } = await import("@/lib/services/reality-ledger");
    const first = await recordEvidenceBatch(receipt, { producer: "bridge", idempotencyKey: K });
    const replay = await recordEvidenceBatch(receipt, { producer: "bridge", idempotencyKey: K });
    expect(first).toEqual({ eventsWritten: 1, claimsWritten: 1, rejected: [] });
    expect(replay).toMatchObject({ duplicate: true, resultRef: "evt_1", eventsWritten: 0, claimsWritten: 0 });
    expect(eventCreate).toHaveBeenCalledTimes(1);
  });

  it("break (door): the ledger-door receipt under K claims no key, so the bridge-door resend under K lands", async () => {
    const { recordEvidenceBatch } = await import("@/lib/services/reality-ledger");
    const refused = await recordEvidenceBatch(receipt, { producer: "ledger", idempotencyKey: K });
    expect(refused.rejected.map((x) => `${x.kind}:${x.index}`)).toEqual(["event:0", "claim:0"]);
    expect(refused.rejected[1].error).toMatch(/sourceEventIndexes\[0\] does not name an event written by this batch/);
    expect(store.has(K)).toBe(false);

    const resend = await recordEvidenceBatch(receipt, { producer: "bridge", idempotencyKey: K });
    expect(resend).toEqual({ eventsWritten: 1, claimsWritten: 1, rejected: [] });
    expect(store.get(K)).toMatchObject({ resultRef: "evt_1", seenCount: 1 });
  });

  it("break (PII): a raw-hex receipt refused by the phone tripwire under K does not block the digit-split resend under K", async () => {
    const { recordEvidenceBatch } = await import("@/lib/services/reality-ledger");
    const refused = await recordEvidenceBatch(piiTripped, { producer: "bridge", idempotencyKey: K });
    expect(refused).toMatchObject({ eventsWritten: 0, claimsWritten: 0 });
    expect(refused.rejected[0].error).toMatch(/value looks like phone/);
    expect(refused.duplicate).toBeUndefined();
    expect(store.size).toBe(0);
    expect(claimCreate).not.toHaveBeenCalled();

    const corrected = await recordEvidenceBatch(receipt, { producer: "bridge", idempotencyKey: K });
    expect(corrected).toEqual({ eventsWritten: 1, claimsWritten: 1, rejected: [] });
    expect(eventCreate).toHaveBeenCalledTimes(1);
  });

  it("no over-reach: a claim resting only on external keys still lands (and keys the batch) when the batch's event is refused", async () => {
    const { recordEvidenceBatch } = await import("@/lib/services/reality-ledger");
    const external = { ...sampleClaim, sourceEventIndexes: undefined, sourceEventKeys: ["ext:prompt-evolution-run"] };
    const r = await recordEvidenceBatch({ ...piiTripped, claims: [external] }, { producer: "bridge", idempotencyKey: K });
    expect(r).toEqual({ eventsWritten: 0, claimsWritten: 1, rejected: [expect.objectContaining({ kind: "event", index: 0 })] });
    expect(store.get(K)).toMatchObject({ resultRef: "clm_1" });
  });

  it("a mixed batch keys on what landed: the dangling claim is refused, the lineage-valid claim lands", async () => {
    const { recordEvidenceBatch } = await import("@/lib/services/reality-ledger");
    const r = await recordEvidenceBatch(
      {
        events: [piiTripped.events[0], sampleEvent],
        claims: [{ ...sampleClaim, sourceEventIndexes: [0] }, { ...sampleClaim, sourceEventIndexes: [1] }],
        sender: "nickstire",
      },
      { producer: "bridge", idempotencyKey: K },
    );
    expect(r.eventsWritten).toBe(1);
    expect(r.claimsWritten).toBe(1);
    expect(r.rejected.map((x) => `${x.kind}:${x.index}`)).toEqual(["event:0", "claim:0"]);
    expect(claimCreate.mock.calls[0][0].data.sourceEventKeys).toEqual(["evt_1"]);
    expect(store.get(K)).toMatchObject({ resultRef: "evt_1" });
  });

  it("bridge_receipts not migrated (P2021): the dangling claim is reported exactly once on the un-deduplicated fallback", async () => {
    receiptFault.code = "P2021";
    const { recordEvidenceBatch } = await import("@/lib/services/reality-ledger");
    const r = await recordEvidenceBatch(
      { events: [piiTripped.events[0], sampleEvent], claims: [{ ...sampleClaim, sourceEventIndexes: [0] }], sender: "nickstire" },
      { producer: "bridge", idempotencyKey: K },
    );
    expect(r).toMatchObject({ eventsWritten: 1, claimsWritten: 0, dedupe: "unavailable" });
    expect(r.rejected.map((x) => `${x.kind}:${x.index}`)).toEqual(["event:0", "claim:0"]);
  });
});

describe("POST /api/sync/evidence: the corrected resend under the same Idempotency-Key is written, not answered duplicate", () => {
  it("ledger-key post under K is refused (ok:false); the bridge-key post under K then lands (ok:true, no duplicate)", async () => {
    const prev = { l: process.env.EVIDENCE_LEDGER_KEY, b: process.env.STATENOUR_SYNC_KEY };
    process.env.EVIDENCE_LEDGER_KEY = "ledger-key-for-test";
    process.env.STATENOUR_SYNC_KEY = "bridge-key-for-test";
    try {
      const { POST } = await import("@/app/api/sync/evidence/route");
      const post = async (key: string) =>
        (
          await POST(
            new Request("http://x/api/sync/evidence", {
              method: "POST",
              headers: { "content-type": "application/json", "x-sync-key": key, "idempotency-key": K },
              body: JSON.stringify(receipt),
            }),
            {} as never,
          )
        ).json();

      const refused = await post("ledger-key-for-test");
      expect(refused.data).toMatchObject({ ok: false, producer: "ledger", eventsWritten: 0, claimsWritten: 0 });
      expect(store.has(K)).toBe(false);

      const resend = await post("bridge-key-for-test");
      expect(resend.data).toMatchObject({ ok: true, producer: "bridge", eventsWritten: 1, claimsWritten: 1, rejected: [] });
      expect(resend.data.duplicate).toBeUndefined();
      expect(eventCreate).toHaveBeenCalledTimes(1);
    } finally {
      if (prev.l === undefined) delete process.env.EVIDENCE_LEDGER_KEY;
      else process.env.EVIDENCE_LEDGER_KEY = prev.l;
      if (prev.b === undefined) delete process.env.STATENOUR_SYNC_KEY;
      else process.env.STATENOUR_SYNC_KEY = prev.b;
    }
  });
});
