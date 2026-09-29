/**
 * ADR-0019 phase 0b · the receiver dedupes keyed nickstire writes.
 *
 * Positive control first, in every block: the same request WITHOUT an
 * Idempotency-Key writes twice (today's behaviour), which proves the test can
 * see a duplicate. Then the keyed request writes once and the replay answers
 * `duplicate`. ADR §8 T6 (evidence batch replay) and T9 (open_loop replay).
 *
 * The receipt store is an in-memory fake that honours the exact predicates the
 * code sends (createMany skipDuplicates, conditional updateMany/deleteMany), so
 * a regression that drops a predicate — settle by key alone, release without the
 * lease, takeover without the staleness check — changes what these tests see.
 * What it cannot show is Postgres transaction rollback; that is ADR §8 T7,
 * owed to an integration run against a real database.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = { idempotencyKey: string; route: string; resultRef: string | null; firstSeenAt: Date; lastSeenAt: Date; seenCount: number };
type Where = { idempotencyKey: string; resultRef?: null | { not: null }; lastSeenAt?: Date | { lt: Date } };

const { store, eventCreate, claimCreate, createTask, requireSyncAuth, requireEvidenceAuth, receiptFault } = vi.hoisted(() => ({
  store: new Map<string, Row>(),
  eventCreate: vi.fn(),
  claimCreate: vi.fn(),
  createTask: vi.fn(),
  requireSyncAuth: vi.fn(),
  requireEvidenceAuth: vi.fn(),
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
const bridgeReceipt = {
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
};

const prismaMock = {
  bridgeReceipt,
  realityEvent: { create: eventCreate, findMany: vi.fn().mockResolvedValue([]) },
  evidenceClaim: { create: claimCreate, findMany: vi.fn().mockResolvedValue([]) },
  localSyncLog: { create: vi.fn().mockResolvedValue({}) },
  runnerNode: { upsert: vi.fn().mockResolvedValue({}) },
  apiRequestLog: { create: vi.fn().mockResolvedValue({}) },
  errorLog: { create: vi.fn().mockResolvedValue({}) },
  $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock)),
};
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock, resetQueryCount: vi.fn(), getQueryCount: vi.fn().mockReturnValue(0) }));
vi.mock("@/lib/auth-guard", () => ({
  requireSyncAuth: (req: Request) => requireSyncAuth(req),
  requireEvidenceAuth: (req: Request) => requireEvidenceAuth(req),
  requireCronAuth: vi.fn(),
  requireSession: vi.fn().mockResolvedValue({ user: "operator" }),
}));
vi.mock("@/lib/services/tasks", () => ({ createTask: (...a: unknown[]) => createTask(...a) }));
vi.mock("@/lib/services/missions", () => ({ resolveInboxMissionId: vi.fn().mockResolvedValue("m-inbox") }));
vi.mock("@/lib/integrations/gmail-sync", () => ({ processGmailItems: vi.fn() }));

const KEY = "v1:experiment.verdict:experiment:home-hero-2026-09:abc123:keep_running";
const validEvent = {
  eventType: "experiment.verdict",
  objects: [{ type: "experiment", id: "home-hero-2026-09" }],
  source: { system: "nickstire", uri: "cron:web-experiment-resolve" },
  quality: "derived",
  payload: { status: "keep_running" },
};
const validClaim = { claimText: "variant leads on page_cta_primary_clicked", grade: "H4", disposition: "supported", sourceEventIndexes: [0] };
const batch = { events: [validEvent], claims: [validClaim], sender: "nickstire" };

let nextId = 0;
beforeEach(() => {
  vi.clearAllMocks();
  store.clear();
  receiptFault.code = null;
  nextId = 0;
  eventCreate.mockImplementation(async () => ({ id: `evt_${++nextId}` }));
  claimCreate.mockImplementation(async () => ({ id: `clm_${++nextId}` }));
  createTask.mockImplementation(async () => ({ id: `task_${++nextId}` }));
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock));
});

describe("recordEvidenceBatch · keyed replay (ADR-0019 T6)", () => {
  it("positive control: the same batch twice WITHOUT a key writes two events and two claims (today's behaviour)", async () => {
    const { recordEvidenceBatch } = await import("@/lib/services/reality-ledger");
    await recordEvidenceBatch(batch, { producer: "bridge" });
    await recordEvidenceBatch(batch, { producer: "bridge" });
    expect(eventCreate).toHaveBeenCalledTimes(2);
    expect(claimCreate).toHaveBeenCalledTimes(2);
    expect(bridgeReceipt.createMany).not.toHaveBeenCalled();
  });

  it("the same batch twice under one key writes once; the replay is a duplicate carrying the first row's id", async () => {
    const { recordEvidenceBatch } = await import("@/lib/services/reality-ledger");
    const first = await recordEvidenceBatch(batch, { producer: "bridge", idempotencyKey: KEY });
    const second = await recordEvidenceBatch(batch, { producer: "bridge", idempotencyKey: KEY });
    expect(first).toEqual({ eventsWritten: 1, claimsWritten: 1, rejected: [] });
    expect(second).toMatchObject({ duplicate: true, resultRef: "evt_1", eventsWritten: 0, claimsWritten: 0, rejected: [] });
    expect(eventCreate).toHaveBeenCalledTimes(1);
    expect(claimCreate).toHaveBeenCalledTimes(1);
    expect(store.get(KEY)).toMatchObject({ route: "sync/evidence", resultRef: "evt_1", seenCount: 2 });
  });

  it("different keys are different facts: both land", async () => {
    const { recordEvidenceBatch } = await import("@/lib/services/reality-ledger");
    await recordEvidenceBatch(batch, { producer: "bridge", idempotencyKey: KEY });
    await recordEvidenceBatch(batch, { producer: "bridge", idempotencyKey: `${KEY}:changed` });
    expect(eventCreate).toHaveBeenCalledTimes(2);
  });

  it("a keyed batch with nothing valid records no receipt, so the corrected resend under the same key still lands", async () => {
    const { recordEvidenceBatch } = await import("@/lib/services/reality-ledger");
    const bad = await recordEvidenceBatch({ events: [{ ...validEvent, payload: { phone: "x" } }], sender: "nickstire" }, { producer: "bridge", idempotencyKey: KEY });
    expect(bad.rejected).toHaveLength(1);
    expect(store.size).toBe(0);
    const fixed = await recordEvidenceBatch(batch, { producer: "bridge", idempotencyKey: KEY });
    expect(fixed).toEqual({ eventsWritten: 1, claimsWritten: 1, rejected: [] });
  });

  it("bridge_receipts not migrated (P2021): the keyed batch still lands once, flagged dedupe=unavailable — never fails closed", async () => {
    receiptFault.code = "P2021";
    const { recordEvidenceBatch } = await import("@/lib/services/reality-ledger");
    const r = await recordEvidenceBatch(batch, { producer: "bridge", idempotencyKey: KEY });
    expect(r).toEqual({ eventsWritten: 1, claimsWritten: 1, rejected: [], dedupe: "unavailable" });
    expect(eventCreate).toHaveBeenCalledTimes(1);
  });

  it("any other receipt error is NOT swallowed into an un-deduplicated write", async () => {
    receiptFault.code = "P1001";
    const { recordEvidenceBatch } = await import("@/lib/services/reality-ledger");
    await expect(recordEvidenceBatch(batch, { producer: "bridge", idempotencyKey: KEY })).rejects.toMatchObject({ code: "P1001" });
    expect(eventCreate).not.toHaveBeenCalled();
  });
});

describe("POST /api/sync/evidence · Idempotency-Key header", () => {
  const post = async (headers: Record<string, string>) => {
    const { POST } = await import("@/app/api/sync/evidence/route");
    const prev = process.env.STATENOUR_SYNC_KEY;
    process.env.STATENOUR_SYNC_KEY = "bridge-key-for-test";
    try {
      const res = await POST(
        new Request("http://x/api/sync/evidence", { method: "POST", headers: { "content-type": "application/json", "x-sync-key": "bridge-key-for-test", ...headers }, body: JSON.stringify(batch) }),
        {} as never,
      );
      return { status: res.status, body: await res.json() };
    } finally {
      if (prev === undefined) delete process.env.STATENOUR_SYNC_KEY; else process.env.STATENOUR_SYNC_KEY = prev;
    }
  };

  it("reads the header: a replay answers ok + duplicate and writes nothing", async () => {
    const a = await post({ "idempotency-key": KEY });
    const b = await post({ "Idempotency-Key": KEY });
    expect(a.body.data).toMatchObject({ ok: true, eventsWritten: 1 });
    expect(b.body.data).toMatchObject({ ok: true, duplicate: true, resultRef: "evt_1", eventsWritten: 0 });
    expect(eventCreate).toHaveBeenCalledTimes(1);
  });

  it("a malformed key is a 400 — a sender bug is surfaced, not written un-deduplicated", async () => {
    const r = await post({ "idempotency-key": "has a space" });
    expect(r.status).toBe(400);
    const long = await post({ "idempotency-key": "k".repeat(191) });
    expect(long.status).toBe(400);
    expect(eventCreate).not.toHaveBeenCalled();
  });
});

describe("POST /api/sync/nour-os open_loop · keyed replay (ADR-0019 T9)", () => {
  const OPEN_KEY = "v1:obligation.opened:draft_blocked:draft_42";
  const post = async (headers: Record<string, string> = {}) => {
    const { POST } = await import("@/app/api/sync/nour-os/route");
    const res = await POST(
      new Request("http://x/api/sync/nour-os", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ module: "open_loop", data: { title: "Draft blocked: review it", source: "nickstire" } }),
      }),
      {} as never,
    );
    return { status: res.status, body: await res.json() };
  };

  it("positive control: two open_loop posts WITHOUT a key create two tasks (today's behaviour)", async () => {
    await post();
    await post();
    expect(createTask).toHaveBeenCalledTimes(2);
    expect(bridgeReceipt.createMany).not.toHaveBeenCalled();
  });

  it("the escalation sent twice under one key creates ONE task; the replay returns the first task's id", async () => {
    const a = await post({ "idempotency-key": OPEN_KEY });
    const b = await post({ "idempotency-key": OPEN_KEY });
    expect(a.status).toBe(200);
    expect(a.body.data.result).toMatchObject({ id: "task_1" });
    expect(b.body.data.result).toEqual({ duplicate: true, resultRef: "task_1" });
    expect(createTask).toHaveBeenCalledTimes(1);
    expect(store.get(OPEN_KEY)).toMatchObject({ route: "sync/nour-os:open_loop", resultRef: "task_1", seenCount: 2 });
  });

  it("a failed createTask gives the key back, so the sender's retry creates the task", async () => {
    createTask.mockRejectedValueOnce(new Error("db blip"));
    const a = await post({ "idempotency-key": OPEN_KEY });
    expect(a.status).toBe(500);
    expect(store.has(OPEN_KEY)).toBe(false);
    const b = await post({ "idempotency-key": OPEN_KEY });
    expect(b.body.data.result).toMatchObject({ id: "task_1" });
    expect(createTask).toHaveBeenCalledTimes(2);
  });

  it("not migrated (P2021): the keyed escalation still creates its task", async () => {
    receiptFault.code = "P2021";
    const a = await post({ "idempotency-key": OPEN_KEY });
    expect(a.status).toBe(200);
    expect(createTask).toHaveBeenCalledTimes(1);
  });
});

describe("runOnceByKey · the unsettled window (claim -> act -> settle)", () => {
  const ROUTE = "sync/nour-os:open_loop";
  const K = "v1:obligation.opened:reconciliation:window_7";
  const t0 = new Date("2026-09-29T09:00:00.000Z");

  it("a replay while the first delivery is still unsettled gets a retryable 503, not a second write", async () => {
    const { claimReceipt, runOnceByKey } = await import("@/lib/services/bridge-receipts");
    await claimReceipt(prismaMock as never, K, ROUTE, { staleMs: 120_000 }); // first delivery in flight, now
    const act = vi.fn(async () => ({ id: "task_x" }));
    await expect(runOnceByKey(prismaMock as never, K, ROUTE, act, (v) => v.id, { staleMs: 120_000 })).rejects.toMatchObject({ status: 503 });
    expect(act).not.toHaveBeenCalled();
  });

  it("an unsettled row older than the lease is taken over exactly once — a second concurrent replay sees the fresh lease", async () => {
    const { claimReceipt } = await import("@/lib/services/bridge-receipts");
    await claimReceipt(prismaMock as never, K, ROUTE, { staleMs: 120_000, now: t0 }); // first delivery died unsettled
    const later = new Date(t0.getTime() + 180_000);
    const a = await claimReceipt(prismaMock as never, K, ROUTE, { staleMs: 120_000, now: later });
    const b = await claimReceipt(prismaMock as never, K, ROUTE, { staleMs: 120_000, now: new Date(later.getTime() + 1) });
    expect(a).toMatchObject({ first: true, takeover: true });
    expect(b).toMatchObject({ first: false, resultRef: null });
  });

  it("replays of an unsettled row do not refresh the lease (a dead owner cannot be kept alive by retries)", async () => {
    const { claimReceipt } = await import("@/lib/services/bridge-receipts");
    await claimReceipt(prismaMock as never, K, ROUTE, { staleMs: 120_000, now: t0 });
    await claimReceipt(prismaMock as never, K, ROUTE, { staleMs: 120_000, now: new Date(t0.getTime() + 60_000) });
    expect(store.get(K)!.lastSeenAt).toEqual(t0);
    const c = await claimReceipt(prismaMock as never, K, ROUTE, { staleMs: 120_000, now: new Date(t0.getTime() + 121_000) });
    expect(c).toMatchObject({ first: true, takeover: true });
  });

  it("a slow first delivery that fails AFTER a takeover cannot release the new owner's row", async () => {
    const { claimReceipt, releaseReceipt } = await import("@/lib/services/bridge-receipts");
    const first = await claimReceipt(prismaMock as never, K, ROUTE, { staleMs: 120_000, now: t0 });
    await claimReceipt(prismaMock as never, K, ROUTE, { staleMs: 120_000, now: new Date(t0.getTime() + 180_000) });
    if (!first.first) throw new Error("expected the first claim to own the key");
    await releaseReceipt(prismaMock as never, K, first.leaseAt);
    expect(store.has(K)).toBe(true);
  });

  it("a settled receipt is never overwritten by a second settle", async () => {
    const { claimReceipt, settleReceipt } = await import("@/lib/services/bridge-receipts");
    await claimReceipt(prismaMock as never, K, ROUTE, { now: t0 });
    expect(await settleReceipt(prismaMock as never, K, "task_a")).toBe(true);
    expect(await settleReceipt(prismaMock as never, K, "task_b")).toBe(false);
    expect(store.get(K)!.resultRef).toBe("task_a");
  });
});
