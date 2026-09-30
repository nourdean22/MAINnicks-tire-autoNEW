/**
 * ADR-0019 phase 1d · /api/sync/events dedupes keyed bridge events.
 *
 * Positive control first: the same event twice WITHOUT a key writes two audit
 * rows, raises two coach events and runs the pipeline twice (today's
 * behaviour), which proves these tests can see a duplicate. Then the keyed
 * event writes once and its replay re-fires nothing.
 *
 * The receipt store is an in-memory fake honouring the predicates the code
 * sends (createMany skipDuplicates, conditional updateMany), and `$transaction`
 * rolls the fake back when its callback throws, so "the receipt and the audit
 * row commit together" is observable. Real Postgres rollback is ADR §8 T7,
 * owed to an integration run.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { idempotencyKey: string; route: string; resultRef: string | null; seenCount: number };
type Where = { idempotencyKey: string; resultRef?: null | { not: null } };

const { store, auditCreate, recordCoachEvent, processShopEvent, receiptFault } = vi.hoisted(() => ({
  store: new Map<string, { idempotencyKey: string; route: string; resultRef: string | null; seenCount: number }>(),
  auditCreate: vi.fn(),
  recordCoachEvent: vi.fn(),
  processShopEvent: vi.fn(),
  receiptFault: { code: null as string | null },
}));

function fault() {
  if (receiptFault.code) throw Object.assign(new Error("The table `public.bridge_receipts` does not exist"), { code: receiptFault.code });
}
function matches(row: Row, where: Where): boolean {
  if (row.idempotencyKey !== where.idempotencyKey) return false;
  if (where.resultRef === null && row.resultRef !== null) return false;
  if (where.resultRef && "not" in where.resultRef && row.resultRef === null) return false;
  return true;
}
const bridgeReceipt = {
  createMany: vi.fn(async ({ data }: { data: Array<{ idempotencyKey: string; route: string }> }) => {
    fault();
    let count = 0;
    for (const d of data) {
      if (store.has(d.idempotencyKey)) continue; // ON CONFLICT DO NOTHING
      store.set(d.idempotencyKey, { idempotencyKey: d.idempotencyKey, route: d.route, resultRef: null, seenCount: 1 });
      count++;
    }
    return { count };
  }),
  updateMany: vi.fn(async ({ where, data }: { where: Where; data: { resultRef?: string; seenCount?: { increment: number } } }) => {
    fault();
    const row = store.get(where.idempotencyKey);
    if (!row || !matches(row, where)) return { count: 0 };
    if (data.resultRef !== undefined) row.resultRef = data.resultRef;
    if (data.seenCount) row.seenCount += data.seenCount.increment;
    return { count: 1 };
  }),
  findUnique: vi.fn(async ({ where }: { where: { idempotencyKey: string } }) => {
    fault();
    const row = store.get(where.idempotencyKey);
    return row ? { resultRef: row.resultRef, seenCount: row.seenCount } : null;
  }),
};

const prismaMock = {
  bridgeReceipt,
  auditEvent: { create: auditCreate, findMany: vi.fn().mockResolvedValue([]) },
  socialPublishQueue: { upsert: vi.fn().mockResolvedValue({}) },
  apiRequestLog: { create: vi.fn().mockResolvedValue({}) },
  errorLog: { create: vi.fn().mockResolvedValue({}) },
  // A transaction that throws leaves the receipt store as it found it.
  $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    const snapshot = new Map([...store].map(([k, v]) => [k, { ...v }]));
    try {
      return await fn(prismaMock);
    } catch (err) {
      store.clear();
      for (const [k, v] of snapshot) store.set(k, v);
      throw err;
    }
  }),
};
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock, resetQueryCount: vi.fn(), getQueryCount: vi.fn().mockReturnValue(0) }));
vi.mock("@/lib/auth-guard", () => ({
  requireSyncAuth: vi.fn(),
  requireCronAuth: vi.fn(),
  requireEvidenceAuth: vi.fn(),
  requireSession: vi.fn().mockResolvedValue({ user: "operator" }),
}));
vi.mock("@/lib/services/coach-events", () => ({ recordCoachEvent }));
vi.mock("@/lib/db/brain-bus-emit", () => ({ emitDriftFired: vi.fn() }));
vi.mock("@/lib/brain/pipeline-controller", () => ({ processShopEvent }));

const KEY = "v1:lead.callback_requested:callback:4812";
const callback = { type: "nickstire:callback", timestamp: "2026-09-30T12:00:00.000Z", source: "nickstire", data: { customer: "Pat", callbackId: 4812 } };

async function post(body: unknown, headers: Record<string, string> = {}) {
  const { POST } = await import("@/app/api/sync/events/route");
  const res = await POST(
    new Request("http://x/api/sync/events", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test", ...headers },
      body: JSON.stringify(body),
    }),
    {} as never,
  );
  return { status: res.status, body: await res.json() };
}

let nextId = 0;
beforeEach(() => {
  vi.clearAllMocks();
  store.clear();
  receiptFault.code = null;
  nextId = 0;
  auditCreate.mockImplementation(async () => ({ id: `aud_${++nextId}` }));
  recordCoachEvent.mockResolvedValue({ eventId: "coach_1" });
  processShopEvent.mockResolvedValue({ processed: true, actions: [] });
});

describe("POST /api/sync/events · keyed replay (ADR-0019 phase 1d)", () => {
  it("positive control: the same event twice WITHOUT a key writes, alerts and pipes twice (today's behaviour)", async () => {
    await post({ events: [callback] });
    await post({ events: [callback] });
    expect(auditCreate).toHaveBeenCalledTimes(2);
    expect(recordCoachEvent).toHaveBeenCalledTimes(2);
    expect(processShopEvent).toHaveBeenCalledTimes(2);
    expect(bridgeReceipt.createMany).not.toHaveBeenCalled();
  });

  it("a key on the event: the replay writes no second audit row and re-fires no coach event or pipeline", async () => {
    const a = await post({ events: [{ ...callback, idempotencyKey: KEY }] });
    const b = await post({ events: [{ ...callback, idempotencyKey: KEY }] });
    expect(a.body.data.results).toEqual([{ type: "nickstire:callback", stored: true }]);
    expect(b.body.data).toMatchObject({ ok: true, received: 1, results: [{ type: "nickstire:callback", stored: false, duplicate: true, resultRef: "aud_1" }] });
    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(recordCoachEvent).toHaveBeenCalledTimes(1);
    expect(processShopEvent).toHaveBeenCalledTimes(1);
    expect(store.get(KEY)).toMatchObject({ route: "sync/events", resultRef: "aud_1", seenCount: 2 });
  });

  it("the Idempotency-Key header keys a single-event request the same way", async () => {
    await post({ events: [callback] }, { "idempotency-key": KEY });
    const b = await post(callback, { "Idempotency-Key": KEY });
    expect(b.body.data.results[0]).toMatchObject({ duplicate: true, resultRef: "aud_1" });
    expect(auditCreate).toHaveBeenCalledTimes(1);
  });

  it("different keys are different facts: both land", async () => {
    await post({ events: [{ ...callback, idempotencyKey: KEY }] });
    await post({ events: [{ ...callback, idempotencyKey: "v1:lead.callback_requested:callback:4813" }] });
    expect(auditCreate).toHaveBeenCalledTimes(2);
    expect(processShopEvent).toHaveBeenCalledTimes(2);
  });

  it("a batch dedupes per event: a resend with one new event lands only the new one", async () => {
    const other = { ...callback, idempotencyKey: "v1:lead.callback_requested:callback:4813" };
    await post({ events: [{ ...callback, idempotencyKey: KEY }] });
    const r = await post({ events: [{ ...callback, idempotencyKey: KEY }, other] });
    expect(r.body.data.results).toEqual([
      { type: "nickstire:callback", stored: false, duplicate: true, resultRef: "aud_1" },
      { type: "nickstire:callback", stored: true },
    ]);
    expect(auditCreate).toHaveBeenCalledTimes(2);
  });

  it("a latest-wins draft skips the receipt, so a newer state under the same key still upserts", async () => {
    const draft = (content: string) => ({
      type: "nickstire:social_draft:sync",
      timestamp: "2026-09-30T12:00:00.000Z",
      source: "nickstire",
      data: { id: "d_9", content },
      idempotencyKey: "v1:content.draft.synced:draft:d_9",
    });
    await post({ events: [draft("first")] });
    await post({ events: [draft("second")] });
    expect(bridgeReceipt.createMany).not.toHaveBeenCalled();
    expect(prismaMock.socialPublishQueue.upsert).toHaveBeenCalledTimes(2);
    expect(prismaMock.socialPublishQueue.upsert.mock.calls[1][0].update.content).toBe("second");
  });

  it("a failed audit write gives the key back and answers 503, so the sender's retry lands the event once", async () => {
    auditCreate.mockRejectedValueOnce(new Error("db blip"));
    const a = await post({ events: [{ ...callback, idempotencyKey: KEY }] });
    expect(a.status).toBe(503);
    expect(store.has(KEY)).toBe(false);
    expect(recordCoachEvent).not.toHaveBeenCalled();
    expect(processShopEvent).not.toHaveBeenCalled();
    const b = await post({ events: [{ ...callback, idempotencyKey: KEY }] });
    expect(b.body.data.results).toEqual([{ type: "nickstire:callback", stored: true }]);
    expect(auditCreate).toHaveBeenCalledTimes(2); // the failed attempt + the retry
    expect(store.get(KEY)).toMatchObject({ resultRef: "aud_1", seenCount: 1 });
  });

  it("bridge_receipts not migrated (P2021): the keyed event still lands, flagged dedupe=unavailable — never fails closed", async () => {
    receiptFault.code = "P2021";
    const r = await post({ events: [{ ...callback, idempotencyKey: KEY }] });
    expect(r.status).toBe(200);
    expect(r.body.data.results).toEqual([{ type: "nickstire:callback", stored: true, dedupe: "unavailable" }]);
    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(processShopEvent).toHaveBeenCalledTimes(1);
  });

  it("any other receipt error is a 503, not an un-deduplicated write", async () => {
    receiptFault.code = "P1001";
    const r = await post({ events: [{ ...callback, idempotencyKey: KEY }] });
    expect(r.status).toBe(503);
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it("malformed or conflicting keys are a 400 before anything is written", async () => {
    const bad = await post({ events: [callback, { ...callback, idempotencyKey: "has a space" }] });
    const notString = await post({ events: [{ ...callback, idempotencyKey: 4812 }] });
    const disagree = await post({ events: [{ ...callback, idempotencyKey: KEY }] }, { "idempotency-key": `${KEY}9` });
    const headerOnBatch = await post({ events: [callback, callback] }, { "idempotency-key": KEY });
    expect([bad.status, notString.status, disagree.status, headerOnBatch.status]).toEqual([400, 400, 400, 400]);
    expect(auditCreate).not.toHaveBeenCalled();
    expect(processShopEvent).not.toHaveBeenCalled();
  });
});
