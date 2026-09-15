/**
 * /api/sync/evidence + the reality-ledger service.
 *
 * Positive control first: a valid batch writes both tables. Then the
 * refusals that matter — a PII-shaped payload key is rejected while the rest
 * of the batch still lands, an unknown grade is rejected, and an unauthenticated
 * caller never reaches the writer.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { eventsCreateMany, claimsCreateMany, tasteCreate, brainCreate, requireSyncAuth } = vi.hoisted(() => ({
  eventsCreateMany: vi.fn(),
  claimsCreateMany: vi.fn(),
  tasteCreate: vi.fn(),
  brainCreate: vi.fn(),
  requireSyncAuth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    realityEvent: { createMany: eventsCreateMany, findMany: vi.fn().mockResolvedValue([]) },
    evidenceClaim: { createMany: claimsCreateMany, findMany: vi.fn().mockResolvedValue([]), groupBy: vi.fn().mockResolvedValue([]) },
    tasteJudgment: { create: tasteCreate, findMany: vi.fn().mockResolvedValue([]) },
    brainMemory: { create: brainCreate },
    workItem: { findMany: vi.fn().mockResolvedValue([]) },
    apiRequestLog: { create: vi.fn().mockResolvedValue({}) },
    errorLog: { create: vi.fn().mockResolvedValue({}) },
  },
  resetQueryCount: vi.fn(),
  getQueryCount: vi.fn().mockReturnValue(0),
}));

vi.mock("@/lib/auth-guard", () => ({
  requireSyncAuth: (req: Request) => requireSyncAuth(req),
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

beforeEach(() => {
  vi.clearAllMocks();
  eventsCreateMany.mockImplementation(async ({ data }: { data: unknown[] }) => ({ count: data.length }));
  claimsCreateMany.mockImplementation(async ({ data }: { data: unknown[] }) => ({ count: data.length }));
});

describe("recordEvidenceBatch", () => {
  it("writes a valid batch (positive control)", async () => {
    const { recordEvidenceBatch } = await import("@/lib/services/reality-ledger");
    const r = await recordEvidenceBatch({ events: [validEvent], claims: [validClaim], sender: "nickstire" });
    expect(r).toEqual({ eventsWritten: 1, claimsWritten: 1, rejected: [] });
    expect(eventsCreateMany.mock.calls[0][0].data[0]).toMatchObject({ eventType: "experiment.verdict", sender: "nickstire", experimentId: "home-hero-subline-2026-09" });
    expect(claimsCreateMany.mock.calls[0][0].data[0]).toMatchObject({ grade: "H4", disposition: "SUPPORTED", createdBy: "CRON" });
  });

  it("rejects a PII-shaped payload key and still lands the rest", async () => {
    const { recordEvidenceBatch } = await import("@/lib/services/reality-ledger");
    const r = await recordEvidenceBatch({
      events: [validEvent, { ...validEvent, payload: { plateText: "ABC123" } }],
      claims: [{ ...validClaim, grade: "H9" }],
      sender: "nickstire",
    });
    expect(r.eventsWritten).toBe(1);
    expect(r.claimsWritten).toBe(0);
    expect(r.rejected).toEqual([
      expect.objectContaining({ kind: "event", index: 1, error: expect.stringMatching(/PII/) }),
      expect.objectContaining({ kind: "claim", index: 0 }),
    ]);
  });

  it("an empty batch writes nothing and says so", async () => {
    const { recordEvidenceBatch } = await import("@/lib/services/reality-ledger");
    expect(await recordEvidenceBatch({ sender: "x" })).toEqual({ eventsWritten: 0, claimsWritten: 0, rejected: [] });
    expect(eventsCreateMany).not.toHaveBeenCalled();
  });
});

describe("POST /api/sync/evidence", () => {
  it("runs the sync auth guard before touching the ledger", async () => {
    const { ServiceError } = await import("@/lib/utils/service-error");
    requireSyncAuth.mockImplementationOnce(() => {
      throw new ServiceError("Unauthorized", 401);
    });
    const { POST } = await import("@/app/api/sync/evidence/route");
    const res = await POST(new Request("http://x/api/sync/evidence", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ events: [validEvent] }) }), {} as never);
    expect(res.status).toBe(401);
    expect(eventsCreateMany).not.toHaveBeenCalled();
  });

  it("returns the receipt for an authenticated batch", async () => {
    const { POST } = await import("@/app/api/sync/evidence/route");
    const res = await POST(new Request("http://x/api/sync/evidence", { method: "POST", headers: { "content-type": "application/json", "x-sync-key": "k" }, body: JSON.stringify({ events: [validEvent], claims: [validClaim], sender: "nickstire" }) }), {} as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    // apiHandler envelope: { ok, data, meta }
    expect(json.ok).toBe(true);
    expect(json.data).toMatchObject({ ok: true, eventsWritten: 1, claimsWritten: 1, rejected: [] });
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
