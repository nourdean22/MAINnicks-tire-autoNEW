/**
 * /api/sync/evidence + the reality-ledger service.
 *
 * Positive control first: a valid batch writes both tables. Then the refusals
 * that matter — a PII-shaped key or value ANYWHERE in the payload is rejected
 * while the rest of the batch still lands, an unknown grade is rejected, and
 * an unauthenticated caller never reaches the writer.
 *
 * 2026-09-15 · authority: the grade a producer ASKS for is capped by the door
 * it came through (ledger key ≤ H2, bridge key ≤ H4, owner ≤ H5); "operator"
 * provenance cannot be minted through a key; and a claim can rest on events
 * of the same batch by index, which the ledger resolves to real ids.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { eventCreate, claimCreate, tasteCreate, brainCreate, requireSyncAuth, requireEvidenceAuth } = vi.hoisted(() => ({
  eventCreate: vi.fn(),
  claimCreate: vi.fn(),
  tasteCreate: vi.fn(),
  brainCreate: vi.fn(),
  requireSyncAuth: vi.fn(),
  requireEvidenceAuth: vi.fn(),
}));

const prismaMock = {
  realityEvent: { create: eventCreate, findMany: vi.fn().mockResolvedValue([]) },
  evidenceClaim: { create: claimCreate, findMany: vi.fn().mockResolvedValue([]), groupBy: vi.fn().mockResolvedValue([]) },
  tasteJudgment: { create: tasteCreate, findMany: vi.fn().mockResolvedValue([]) },
  brainMemory: { create: brainCreate },
  workItem: { findMany: vi.fn().mockResolvedValue([]) },
  apiRequestLog: { create: vi.fn().mockResolvedValue({}) },
  errorLog: { create: vi.fn().mockResolvedValue({}) },
  // The writer inserts inside one transaction; the mock hands the same client back.
  $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock)),
};
vi.mock("@/lib/prisma", () => ({
  prisma: prismaMock,
  resetQueryCount: vi.fn(),
  getQueryCount: vi.fn().mockReturnValue(0),
}));

vi.mock("@/lib/auth-guard", () => ({
  requireSyncAuth: (req: Request) => requireSyncAuth(req),
  requireEvidenceAuth: (req: Request) => requireEvidenceAuth(req),
  requireCronAuth: vi.fn(),
  requireSession: vi.fn().mockResolvedValue({ user: "operator" }),
}));

const validEvent = {
  eventType: "experiment.verdict",
  objects: [{ type: "experiment", id: "home-hero-subline-2026-09" }],
  source: { system: "nickstire", uri: "cron:web-experiment-resolve" },
  experiment: { experimentId: "home-hero-subline-2026-09" },
  quality: "derived",
  payload: { status: "keep_running" },
};
const validClaim = { claimText: "variant leads on page_cta_primary_clicked", grade: "H4", hypothesisId: "home-hero-subline-2026-09", disposition: "supported", createdBy: "cron" };

let nextId = 0;
beforeEach(() => {
  vi.clearAllMocks();
  nextId = 0;
  eventCreate.mockImplementation(async () => ({ id: `evt_${++nextId}` }));
  claimCreate.mockImplementation(async () => ({ id: `clm_${++nextId}` }));
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock));
});

describe("recordEvidenceBatch", () => {
  it("writes a valid batch (positive control) — the bridge key may post an H4 verdict, recorded as CRON", async () => {
    const { recordEvidenceBatch } = await import("@/lib/services/reality-ledger");
    const r = await recordEvidenceBatch({ events: [validEvent], claims: [validClaim], sender: "nickstire" }, { producer: "bridge" });
    expect(r).toEqual({ eventsWritten: 1, claimsWritten: 1, rejected: [] });
    expect(eventCreate.mock.calls[0][0].data).toMatchObject({ eventType: "experiment.verdict", sender: "nickstire", experimentId: "home-hero-subline-2026-09" });
    expect(claimCreate.mock.calls[0][0].data).toMatchObject({ grade: "H4", disposition: "SUPPORTED", createdBy: "CRON" });
    expect(prismaMock.$transaction).toHaveBeenCalledOnce();
  });

  it("rejects a PII-shaped payload key and still lands the rest", async () => {
    const { recordEvidenceBatch } = await import("@/lib/services/reality-ledger");
    const r = await recordEvidenceBatch(
      {
        events: [validEvent, { ...validEvent, payload: { plateText: "ABC123" } }],
        claims: [{ ...validClaim, grade: "H9" }],
        sender: "nickstire",
      },
      { producer: "bridge" },
    );
    expect(r.eventsWritten).toBe(1);
    expect(r.claimsWritten).toBe(0);
    expect(r.rejected).toEqual([
      expect.objectContaining({ kind: "event", index: 1, error: expect.stringMatching(/PII/) }),
      expect.objectContaining({ kind: "claim", index: 0 }),
    ]);
  });

  it("PII is caught NESTED and in VALUES, not only at the top-level key (the 2026-09-15 hole)", async () => {
    const { recordEvidenceBatch } = await import("@/lib/services/reality-ledger");
    const r = await recordEvidenceBatch(
      {
        events: [
          { ...validEvent, payload: { customer: { phone: "2165551234" } } },
          { ...validEvent, payload: { note: "reach me at nour@example.com" } },
          { ...validEvent, objects: [{ type: "session", id: "someone@example.com" }] },
          { ...validEvent, payload: { vehicles: [{ id: "1HGCM82633A004352" }] } },
          validEvent,
        ],
        claims: [{ ...validClaim, claimText: "call 216-555-1234 for the winner" }],
        sender: "nickstire",
      },
      { producer: "bridge" },
    );
    expect(r.eventsWritten).toBe(1);
    expect(r.claimsWritten).toBe(0);
    expect(r.rejected.map((x) => `${x.kind}:${x.index}`)).toEqual(["event:0", "event:1", "event:2", "event:3", "claim:0"]);
    expect(r.rejected[0].error).toMatch(/payload\.customer\.phone: key looks like PII/);
    expect(r.rejected[1].error).toMatch(/looks like email/);
    expect(r.rejected[2].error).toMatch(/objects\[0\]\.id: value looks like email/);
    expect(r.rejected[3].error).toMatch(/looks like vin/);
    expect(r.rejected[4].error).toMatch(/looks like phone/);
  });

  it("an empty batch writes nothing and says so", async () => {
    const { recordEvidenceBatch } = await import("@/lib/services/reality-ledger");
    expect(await recordEvidenceBatch({ sender: "x" }, { producer: "ledger" })).toEqual({ eventsWritten: 0, claimsWritten: 0, rejected: [] });
    expect(eventCreate).not.toHaveBeenCalled();
  });
});

describe("authority: producers submit observations, the ledger computes authority", () => {
  it("the scoped ledger key (proof workflow, Night Shift) is capped at H2 — an H4 ask is refused by index, the H2 one lands as AGENT", async () => {
    const { recordEvidenceBatch } = await import("@/lib/services/reality-ledger");
    const r = await recordEvidenceBatch(
      { events: [], claims: [{ ...validClaim, grade: "H4" }, { ...validClaim, grade: "H2", createdBy: "agent" }], sender: "night-shift" },
      { producer: "ledger" },
    );
    expect(r.claimsWritten).toBe(1);
    expect(r.rejected).toEqual([expect.objectContaining({ kind: "claim", index: 0, error: expect.stringMatching(/exceeds this producer's ceiling H2/) })]);
    expect(claimCreate.mock.calls[0][0].data).toMatchObject({ grade: "H2", createdBy: "AGENT" });
  });

  it("the bridge key is capped at H4 — H5 is refused; only an owner surface may assert H5", async () => {
    const { recordEvidenceBatch } = await import("@/lib/services/reality-ledger");
    const bridge = await recordEvidenceBatch({ claims: [{ ...validClaim, grade: "H5" }], sender: "nickstire" }, { producer: "bridge" });
    expect(bridge.claimsWritten).toBe(0);
    expect(bridge.rejected[0].error).toMatch(/ceiling H4/);
    const owner = await recordEvidenceBatch({ claims: [{ ...validClaim, grade: "H5", createdBy: "operator" }], sender: "proof-ui" }, { producer: "operator" });
    expect(owner).toEqual({ eventsWritten: 0, claimsWritten: 1, rejected: [] });
    expect(claimCreate.mock.calls[0][0].data).toMatchObject({ grade: "H5", createdBy: "OPERATOR" });
  });

  it("OPERATOR provenance cannot be minted through a keyed door, and the payload's createdBy never wins", async () => {
    const { recordEvidenceBatch } = await import("@/lib/services/reality-ledger");
    const r = await recordEvidenceBatch(
      { claims: [{ ...validClaim, grade: "H2", createdBy: "operator" }, { ...validClaim, grade: "H2", createdBy: "cron" }], sender: "night-shift" },
      { producer: "ledger" },
    );
    expect(r.rejected).toEqual([expect.objectContaining({ kind: "claim", index: 0, error: expect.stringMatching(/"operator" is not available through a keyed door/) })]);
    // index 1 asked for "cron"; the ledger key is recorded as AGENT regardless
    expect(claimCreate.mock.calls[0][0].data).toMatchObject({ createdBy: "AGENT" });
  });
});

describe("lineage: a claim rests on the events of its own batch", () => {
  it("sourceEventIndexes resolve to the created event ids (plus any external keys)", async () => {
    const { recordEvidenceBatch } = await import("@/lib/services/reality-ledger");
    const r = await recordEvidenceBatch(
      {
        events: [validEvent, { ...validEvent, eventType: "proof.run" }],
        claims: [{ ...validClaim, sourceEventIndexes: [1, 0], sourceEventKeys: ["ext:run-42"] }],
        sender: "nickstire",
      },
      { producer: "bridge" },
    );
    expect(r).toEqual({ eventsWritten: 2, claimsWritten: 1, rejected: [] });
    expect(claimCreate.mock.calls[0][0].data.sourceEventKeys).toEqual(["ext:run-42", "evt_2", "evt_1"]);
  });

  it("a claim pointing at an event this batch did not land (rejected or out of range) is refused — no dangling lineage", async () => {
    const { recordEvidenceBatch } = await import("@/lib/services/reality-ledger");
    const r = await recordEvidenceBatch(
      {
        events: [{ ...validEvent, payload: { phone: "x" } }, validEvent],
        claims: [{ ...validClaim, sourceEventIndexes: [0] }, { ...validClaim, sourceEventIndexes: [5] }, { ...validClaim, sourceEventIndexes: [1] }],
        sender: "nickstire",
      },
      { producer: "bridge" },
    );
    expect(r.eventsWritten).toBe(1);
    expect(r.claimsWritten).toBe(1);
    expect(r.rejected.map((x) => `${x.kind}:${x.index}`)).toEqual(["event:0", "claim:0", "claim:1"]);
    expect(r.rejected[1].error).toMatch(/sourceEventIndexes\[0\] does not name an event written by this batch/);
    expect(claimCreate.mock.calls[0][0].data.sourceEventKeys).toEqual(["evt_1"]);
  });
});

describe("POST /api/sync/evidence", () => {
  it("runs the EVIDENCE auth guard (scoped key or bridge key) before touching the ledger — never the bridge-only guard", async () => {
    const { ServiceError } = await import("@/lib/utils/service-error");
    requireEvidenceAuth.mockImplementationOnce(() => {
      throw new ServiceError("Unauthorized", 401);
    });
    const { POST } = await import("@/app/api/sync/evidence/route");
    const res = await POST(new Request("http://x/api/sync/evidence", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ events: [validEvent] }) }), {} as never);
    expect(res.status).toBe(401);
    expect(eventCreate).not.toHaveBeenCalled();
    expect(requireEvidenceAuth).toHaveBeenCalledTimes(1);
    // The door must be the scoped guard: if the route were still on syncHandler,
    // EVIDENCE_LEDGER_KEY would open nothing and Night Shift would need the bridge key.
    expect(requireSyncAuth).not.toHaveBeenCalled();
  });

  it("derives the producer from the credential that opened the door and returns it in the receipt", async () => {
    const prev = { l: process.env.EVIDENCE_LEDGER_KEY, b: process.env.STATENOUR_SYNC_KEY };
    process.env.EVIDENCE_LEDGER_KEY = "ledger-key-for-test";
    process.env.STATENOUR_SYNC_KEY = "bridge-key-for-test";
    try {
      const { POST } = await import("@/app/api/sync/evidence/route");
      const post = (key: string, body: unknown) =>
        POST(new Request("http://x/api/sync/evidence", { method: "POST", headers: { "content-type": "application/json", "x-sync-key": key }, body: JSON.stringify(body) }), {} as never);

      const ledger = await (await post("ledger-key-for-test", { claims: [{ ...validClaim, grade: "H4" }], sender: "night-shift" })).json();
      expect(ledger.data).toMatchObject({ ok: false, producer: "ledger", claimsWritten: 0 });
      expect(ledger.data.rejected[0].error).toMatch(/ceiling H2/);

      const bridge = await (await post("bridge-key-for-test", { events: [validEvent], claims: [{ ...validClaim, sourceEventIndexes: [0] }], sender: "nickstire" })).json();
      expect(bridge.data).toMatchObject({ ok: true, producer: "bridge", eventsWritten: 1, claimsWritten: 1, rejected: [] });
    } finally {
      if (prev.l === undefined) delete process.env.EVIDENCE_LEDGER_KEY; else process.env.EVIDENCE_LEDGER_KEY = prev.l;
      if (prev.b === undefined) delete process.env.STATENOUR_SYNC_KEY; else process.env.STATENOUR_SYNC_KEY = prev.b;
    }
  });
});

describe("recordTasteJudgment", () => {
  it("writes the judgment and mirrors an OPERATOR-tier brain memory", async () => {
    tasteCreate.mockResolvedValueOnce({ id: "tj1", decidedAt: new Date() });
    brainCreate.mockResolvedValueOnce({});
    const { recordTasteJudgment } = await import("@/lib/services/reality-ledger");
    await recordTasteJudgment({
      surface: "nickstire",
      context: "hero subline, two candidates",
      candidateA: { subline: "a" },
      candidateB: { subline: "b" },
      winner: "B",
      reasonCodes: ["clearer_primary_action", "more_physical"],
    });
    expect(tasteCreate.mock.calls[0][0].data).toMatchObject({ winner: "B", decidedBy: "operator" });
    expect(brainCreate.mock.calls[0][0].data).toMatchObject({ category: "design_decision", trustTier: "OPERATOR", createdBy: "user", key: "taste:tj1" });
  });
});
