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
type Where = { idempotencyKey: string; resultRef?: null | string | { not: null }; lastSeenAt?: Date | { lt: Date } };

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
  if (typeof where.resultRef === "string" && row.resultRef !== where.resultRef) return false;
  if (where.resultRef && typeof where.resultRef === "object" && "not" in where.resultRef && row.resultRef === null) return false;
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
  // Fallback dedupe reads: an open task with the same title in the same mission.
  task: {
    findFirst: vi.fn(async ({ where }: { where: { id?: string; missionId?: string; title?: { equals: string }; status?: { in: string[] } } }) =>
      createdTasks.find(
        (t) =>
          (where.id === undefined || t.id === where.id) &&
          (where.status === undefined || where.status.in.includes(t.status)) &&
          (where.missionId === undefined || t.missionId === where.missionId) &&
          (where.title === undefined || t.title.toLowerCase() === where.title.equals.toLowerCase()),
      ) ?? null,
    ),
  },
  $executeRaw: vi.fn(async () => 0),
  $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock)),
};
const createdTasks: Array<{ id: string; title: string; missionId: string; status: string }> = [];
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
  createdTasks.length = 0;
  createTask.mockImplementation(async (d: { title: string; missionId: string }) => {
    const t = { id: `task_${++nextId}`, title: d.title, missionId: d.missionId, status: "INBOX" };
    createdTasks.push(t);
    return { id: t.id };
  });
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

  // Job 2026-10-23 (map F5): prod ran with no bridge_receipts table, and every
  // win-back escalation landed twice (77 open duplicates). With the table
  // missing, the fallback finds the open same-title task in the same mission.
  it("not migrated (P2021): the same escalation twice creates ONE task; the second is a duplicate of the first", async () => {
    receiptFault.code = "P2021";
    const a = await post({ "idempotency-key": OPEN_KEY });
    const b = await post({ "idempotency-key": OPEN_KEY });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(createTask).toHaveBeenCalledTimes(1);
    expect(b.body.data.result).toEqual({ duplicate: true, resultRef: "task_1" });
  });

  it("not migrated (P2021): the first task was re-filed by enrich into a project; the replay still creates nothing", async () => {
    receiptFault.code = "P2021";
    await post({ "idempotency-key": OPEN_KEY });
    createdTasks[0].missionId = "m-some-project"; // enrichTaskLinkage moved it
    const b = await post({ "idempotency-key": OPEN_KEY });
    expect(createTask).toHaveBeenCalledTimes(1);
    expect(b.body.data.result).toEqual({ duplicate: true, resultRef: "task_1" });
  });

  it("not migrated (P2021): the fallback check runs under one lock per key, so two racers cannot both miss", async () => {
    receiptFault.code = "P2021";
    await post({ "idempotency-key": OPEN_KEY });
    expect(prismaMock.$executeRaw).toHaveBeenCalledOnce();
    // tagged template: (strings, ...values); the one value is the lock key
    const [strings, lockKey] = prismaMock.$executeRaw.mock.calls[0] as unknown as [TemplateStringsArray, string];
    expect(strings.join("?")).toMatch(/pg_advisory_xact_lock\(hashtext\(\?\)\)/);
    expect(lockKey).toBe(`sync/nour-os:open_loop|${OPEN_KEY}`);
    // the lock is taken BEFORE the existing-task lookup, or two racers can both miss
    const lockOrder = prismaMock.$executeRaw.mock.invocationCallOrder[0];
    const lookupOrder = prismaMock.task.findFirst.mock.invocationCallOrder[0];
    expect(lockOrder).toBeLessThan(lookupOrder);
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

// Job 2026-10-29: the attribution escalation is keyed by its SET of unruled
// calls, so every new call, ruling or 21-day age-out is a new key, and each new
// key opened another task beside the still-open one (61 open duplicates on prod,
// SELECT 2026-10-29). A STANDING obligation holds one open task per trigger: a
// new set reuses the open task; only after that task is closed does a new set
// open a new one. The same set after a close stays a duplicate (no nag).
describe("POST /api/sync/nour-os open_loop · standing obligation (one open task per trigger)", () => {
  const SLOT = "v1:obligation.standing:attribution_weak_matches";
  const post = async (key: string, standing?: string) => {
    const { POST } = await import("@/app/api/sync/nour-os/route");
    const res = await POST(
      new Request("http://x/api/sync/nour-os", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": key },
        body: JSON.stringify({
          module: "open_loop",
          data: { title: "[Nick's Tire] Rule on ambiguous call-invoice matches", source: "nickstire", ...(standing ? { standing } : {}) },
        }),
      }),
      {} as never,
    );
    return { status: res.status, body: await res.json() };
  };
  const SET_A = "v1:obligation.opened:attribution_weak_matches:aaaaaaaaaaaaaaaa";
  const SET_B = "v1:obligation.opened:attribution_weak_matches:bbbbbbbbbbbbbbbb";
  const SET_C = "v1:obligation.opened:attribution_weak_matches:cccccccccccccccc";

  it("positive control: two different sets WITHOUT standing open two tasks (the pre-fix behaviour)", async () => {
    await post(SET_A);
    await post(SET_B);
    expect(createTask).toHaveBeenCalledTimes(2);
  });

  it("two runs whose ambiguous set changed, while the first task is open, leave ONE task", async () => {
    const a = await post(SET_A, "attribution_weak_matches");
    const b = await post(SET_B, "attribution_weak_matches");
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(createTask).toHaveBeenCalledTimes(1);
    expect(store.get(SET_B)?.resultRef).toBe("task_1");
    expect(store.get(SLOT)).toMatchObject({ resultRef: "task_1" });
  });

  it("the same set twice is still one task (the per-key receipt answers first)", async () => {
    await post(SET_A, "attribution_weak_matches");
    const b = await post(SET_A, "attribution_weak_matches");
    expect(createTask).toHaveBeenCalledTimes(1);
    expect(b.body.data.result).toEqual({ duplicate: true, resultRef: "task_1" });
  });

  it("after the open task is closed, a NEW set opens a new task; the closed set does not reopen", async () => {
    await post(SET_A, "attribution_weak_matches");
    createdTasks[0].status = "DONE";
    const again = await post(SET_A, "attribution_weak_matches");
    expect(again.body.data.result).toEqual({ duplicate: true, resultRef: "task_1" });
    expect(createTask).toHaveBeenCalledTimes(1);
    await post(SET_B, "attribution_weak_matches");
    expect(createTask).toHaveBeenCalledTimes(2);
    expect(store.get(SLOT)).toMatchObject({ resultRef: "task_2" });
    await post(SET_C, "attribution_weak_matches");
    expect(createTask).toHaveBeenCalledTimes(2);
  });

  it("the reopen is a compare-and-swap on the closed task id: a racer that already reopened the slot wins, the loser writes nothing", async () => {
    await post(SET_A, "attribution_weak_matches");
    createdTasks[0].status = "DONE";
    // The racer reopened the slot (and is still creating) between our read and our swap.
    const realUpdate = bridgeReceipt.updateMany.getMockImplementation()!;
    let raced = false;
    bridgeReceipt.updateMany.mockImplementation(async (args) => {
      if (!raced && args.where.idempotencyKey === SLOT && typeof args.where.resultRef === "string") {
        raced = true;
        const row = store.get(SLOT)!;
        row.resultRef = null;
        row.lastSeenAt = new Date();
      }
      return realUpdate(args);
    });
    const b = await post(SET_B, "attribution_weak_matches");
    expect(b.status).toBe(503);
    expect(createTask).toHaveBeenCalledTimes(1);
    expect(store.has(SET_B)).toBe(false); // the per-key receipt was given back, so the retry is first
  });

  it("a failed create after a reopen gives the slot back, so the retry opens the task", async () => {
    await post(SET_A, "attribution_weak_matches");
    createdTasks[0].status = "DONE";
    createTask.mockRejectedValueOnce(new Error("db blip"));
    const b = await post(SET_B, "attribution_weak_matches");
    expect(b.status).toBe(500);
    expect(store.has(SLOT)).toBe(false);
    const c = await post(SET_B, "attribution_weak_matches");
    expect(c.status).toBe(200);
    expect(store.get(SLOT)).toMatchObject({ resultRef: "task_2" });
  });

  it("a slow open() whose slot was taken over meanwhile does not settle the new owner's slot (Codex P2, PR 3356)", async () => {
    await post(SET_A, "attribution_weak_matches");
    createdTasks[0].status = "DONE";
    const realCreate = createTask.getMockImplementation()!;
    createTask.mockImplementationOnce(async (d) => {
      // While this create is in flight past the lease, a racer takes the slot over (fresh lease, still unsettled).
      const row = store.get(SLOT)!;
      row.lastSeenAt = new Date(row.lastSeenAt.getTime() + 5 * 60_000);
      return realCreate(d);
    });
    await post(SET_B, "attribution_weak_matches");
    expect(store.get(SLOT)?.resultRef).toBeNull(); // left for the racer to settle with its own task
  });

  it("a malformed standing value is ignored: the post behaves as an ordinary keyed escalation", async () => {
    await post(SET_A, "Not A Trigger!");
    await post(SET_B, "Not A Trigger!");
    expect(createTask).toHaveBeenCalledTimes(2);
    expect(store.has(SLOT)).toBe(false);
  });
});
