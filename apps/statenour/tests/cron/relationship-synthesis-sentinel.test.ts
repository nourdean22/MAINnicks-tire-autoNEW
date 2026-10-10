/**
 * Audit 2026-10-10 08-F5: the aiChat outage sentinel became the week's
 * relationship synthesis, and the idempotency check (a row for this ISO
 * week) then locked the week so the real synthesis never ran. On a sentinel
 * the cron reports ok:false, writes nothing, and leaves the week open.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/utils/http", () => ({
  cronHandler: (fn: (req: Request, ctx: unknown) => Promise<unknown>) => fn,
}));

const mockChat = vi.fn();
vi.mock("@/lib/ai/traced-aichat", () => ({
  tracedAiChat: (...a: unknown[]) => mockChat(...a),
}));

const db = vi.hoisted(() => ({
  memFindFirst: vi.fn(),
  memFindMany: vi.fn(),
  memCreate: vi.fn(),
  ledgerFindMany: vi.fn(),
  personFindMany: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: { findFirst: db.memFindFirst, findMany: db.memFindMany, create: db.memCreate },
    relationshipLedger: { findMany: db.ledgerFindMany },
    personProfile: { findMany: db.personFindMany },
    aiGeneration: { groupBy: vi.fn().mockResolvedValue([]) },
  },
}));
vi.mock("@/lib/services/people/contact-rows", () => ({
  contactRowsOnly: (rows: unknown[]) => rows,
}));

import { GET } from "@/app/api/cron/relationship-weekly-synthesis/route";

const SENTINEL = {
  content: "I'm having trouble connecting to my AI providers right now. try again in a moment.",
  provider: "emergency",
  model: "none",
};

const run = () => (GET as unknown as (req: Request, ctx: unknown) => Promise<Record<string, unknown>>)(
  new Request("http://localhost/api/cron/relationship-weekly-synthesis"),
  {},
);

beforeEach(() => {
  mockChat.mockReset();
  db.memFindFirst.mockReset().mockResolvedValue(null);
  db.memFindMany.mockReset().mockResolvedValue([]);
  db.memCreate.mockReset().mockResolvedValue({});
  db.ledgerFindMany.mockReset().mockResolvedValue([
    {
      amount: 2,
      note: "coffee with Sam",
      source: "manual",
      createdAt: new Date(),
      metadata: null,
      person: { id: "p1", name: "Sam", role: "mentor" },
    },
  ]);
  db.personFindMany.mockReset().mockResolvedValue([{ id: "p1", name: "Sam", role: "mentor", lastInteraction: null }]);
});

describe("relationship-weekly-synthesis - provider sentinel", () => {
  it("reports ok:false and writes nothing (the week stays open)", async () => {
    mockChat.mockResolvedValue(SENTINEL);
    const res = await run();
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("provider_unavailable");
    expect(db.memCreate).not.toHaveBeenCalled();
  });

  it("control: a real synthesis is written", async () => {
    mockChat.mockResolvedValue({ content: "Sam showed up twice.\n\nPattern.\n\nFocus on Sam.", provider: "ollama", model: "m" });
    const res = await run();
    expect(res.sent).toBe(true);
    expect(db.memCreate).toHaveBeenCalledTimes(1);
  });
});
