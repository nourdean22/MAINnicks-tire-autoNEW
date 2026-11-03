/**
 * W8b (job 2026-11-02-nour-os-interconnect) · /people tells the truth about what is WAITING and what the engine did.
 *
 * Prod 2026-11-03: 18 of 20 people held a proposal nobody could see from the list; the nightly engine's last run
 * (ok, failed on a read, or nothing to propose) was invisible too, so a dead engine and a quiet day looked the same.
 *
 * Three states, never two: the engine line reads from the newest `people_intelligence_run` audit row; a FAILED read
 * of that row is `unknown`, never `ok`; no row ever is `never`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ people: vi.fn(), raw: vi.fn(), audit: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: { personProfile: { findMany: h.people }, $queryRaw: h.raw, auditEvent: { findFirst: h.audit } },
  resetQueryCount: vi.fn(),
  getQueryCount: vi.fn(() => 0),
}));

import { GET } from "@/app/api/people/route";

const person = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: id,
  role: "friend",
  relationship: "friend",
  trustScore: 0.5,
  leverageNotes: "x",
  lastInteraction: null,
  interactionCount: 0,
  cadenceDays: null,
  pendingClassification: null,
  ledger: [],
  ...over,
});

type Body = {
  data?: {
    people: Array<{ id: string; suggestionWaiting: boolean }>;
    totals: { suggestionsWaiting: number; sparse: number };
    engine: { state: string; at?: string | null; reason?: string | null };
  };
};
async function call() {
  const res = (await GET(new Request("https://x.test/api/people"), undefined as never)) as Response;
  return ((await res.json()) as Body).data!;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.raw.mockResolvedValue([]);
  h.audit.mockResolvedValue(null);
});

describe("GET /api/people · suggestions waiting", () => {
  it("counts every person with a proposal parked in pendingClassification, and marks the row", async () => {
    h.people.mockResolvedValue([
      person("p1", { pendingClassification: { cadenceDays: 14, basis: "default", suggestedAt: "2026-11-02" } }),
      person("p2", { pendingClassification: { role: "mentor", leverageNotes: null, trustAdjustment: 0 } }),
      person("p3"),
    ]);
    const body = await call();
    expect(body.totals.suggestionsWaiting).toBe(2);
    expect(Object.fromEntries(body.people.map((p) => [p.id, p.suggestionWaiting]))).toEqual({ p1: true, p2: true, p3: false });
    // The list query must SELECT the column it counts.
    expect(h.people.mock.calls[0][0].select.pendingClassification).toBe(true);
  });

  it("waiting is not the same as sparse: a person with notes and a role can still hold a proposal", async () => {
    h.people.mockResolvedValue([person("p1", { pendingClassification: { cadenceDays: 7 } })]);
    const body = await call();
    expect(body.totals.sparse).toBe(0);
    expect(body.totals.suggestionsWaiting).toBe(1);
  });
});

describe("GET /api/people · engine line", () => {
  beforeEach(() => h.people.mockResolvedValue([person("p1")]));

  it("reads the newest people_intelligence_run row: ok", async () => {
    h.audit.mockResolvedValue({
      createdAt: new Date("2026-11-03T03:00:00Z"),
      detail: "Updated 2 profiles, 0 alerts",
      payload: { state: "ok", profilesUpdated: 2, cadenceProposed: 0 },
    });
    const body = await call();
    expect(body.engine).toMatchObject({ state: "ok", at: "2026-11-03T03:00:00.000Z" });
    const arg = h.audit.mock.calls[0][0];
    expect(arg.where.eventType).toBe("people_intelligence_run");
    expect(arg.orderBy).toEqual({ createdAt: "desc" });
  });

  it("a run that could not read its context is failed, with the reason", async () => {
    h.audit.mockResolvedValue({
      createdAt: new Date("2026-11-03T03:00:00Z"),
      detail: "Updated 0 profiles, 0 alerts (enrich: chat_read_failed)",
      payload: { state: "failed", reason: "chat_read_failed" },
    });
    expect((await call()).engine).toMatchObject({ state: "failed", reason: "chat_read_failed" });
  });

  it("a run that proposed nothing says so (not ok, not failed)", async () => {
    h.audit.mockResolvedValue({
      createdAt: new Date("2026-11-03T03:00:00Z"),
      detail: "Updated 0 profiles, 0 alerts",
      payload: { state: "nothing_to_propose" },
    });
    expect((await call()).engine.state).toBe("nothing_to_propose");
  });

  it("a legacy row with no payload is read from its detail line", async () => {
    h.audit.mockResolvedValue({ createdAt: new Date("2026-11-01T03:00:00Z"), detail: "Updated 1 profiles, 0 alerts (enrich: ledger_read_failed)", payload: null });
    expect((await call()).engine).toMatchObject({ state: "failed", reason: "ledger_read_failed" });
    h.audit.mockResolvedValue({ createdAt: new Date("2026-11-01T03:00:00Z"), detail: "Updated 1 profiles, 0 alerts", payload: null });
    expect((await call()).engine.state).toBe("ok");
  });

  it("a claim row that never finished: running while young, failed once stale", async () => {
    h.audit.mockResolvedValue({ createdAt: new Date(Date.now() - 60_000), detail: "running", payload: { state: "running" } });
    expect((await call()).engine.state).toBe("running");
    h.audit.mockResolvedValue({ createdAt: new Date(Date.now() - 2 * 3_600_000), detail: "running", payload: { state: "running" } });
    expect((await call()).engine).toMatchObject({ state: "failed", reason: "did not finish" });
  });

  it("no row ever is never; a FAILED read is unknown, never ok", async () => {
    expect((await call()).engine).toEqual({ state: "never", at: null, reason: null });
    h.audit.mockRejectedValue(new Error("relation audit_events does not exist"));
    const body = await call();
    expect(body.engine.state).toBe("unknown");
    expect(body.people).toHaveLength(1);
  });
});
