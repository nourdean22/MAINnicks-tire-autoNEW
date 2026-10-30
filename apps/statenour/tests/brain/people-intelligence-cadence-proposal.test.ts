/**
 * The engine PROPOSES a cadence; it never sets one (people W2, 2026-10-30).
 *
 * The proposal lands in pendingClassification for Nour's accept or dismiss.
 * It is never written to cadenceDays directly, never over a cadence he set,
 * never over a suggestion already waiting, and not again within 30 days of
 * the last proposal (so a dismissed one does not come back every morning).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  peopleFindMany: vi.fn(),
  personUpdate: vi.fn(),
  ledgerFindMany: vi.fn(),
  aiChat: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    personProfile: { findMany: h.peopleFindMany, update: h.personUpdate },
    relationshipLedger: { findMany: h.ledgerFindMany },
  },
}));
vi.mock("@/lib/ai/traced-aichat", () => ({ makeTracedAiChat: () => h.aiChat }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));

import { runPeopleIntelligence } from "@/lib/brain/people-intelligence";

const person = (over: Record<string, unknown> = {}) => ({
  id: "a",
  name: "Person A",
  role: "close_friend",
  relationship: "friend",
  trustScore: 0.5,
  lastInteraction: new Date("2026-10-20T12:00:00Z"),
  dossierUpdatedAt: null,
  interactionCount: 1,
  cadenceDays: null,
  leverageNotes: "has notes, so the enrich pass skips this person",
  metadata: null,
  pendingClassification: null,
  ...over,
});

const proposals = () =>
  h.personUpdate.mock.calls
    .map((c) => c[0] as { data: { pendingClassification?: { cadenceDays?: number; basis?: string }; cadenceDays?: unknown } })
    .filter((a) => a.data.pendingClassification?.cadenceDays !== undefined);

beforeEach(() => {
  vi.clearAllMocks();
  h.personUpdate.mockResolvedValue({});
  h.ledgerFindMany.mockResolvedValue([]);
});

describe("runPeopleIntelligence cadence proposal", () => {
  it("parks a role-default proposal for a person with no cadence, and never writes cadenceDays itself", async () => {
    h.peopleFindMany.mockResolvedValue([person()]);
    await runPeopleIntelligence();
    const p = proposals();
    expect(p).toHaveLength(1);
    expect(p[0].data.pendingClassification).toMatchObject({ cadenceDays: 14, basis: "default for close friend" });
    expect(p[0].data.cadenceDays).toBeUndefined();
  });

  it("uses his own rhythm from contact rows, and ignores status-flip rows", async () => {
    h.peopleFindMany.mockResolvedValue([person()]);
    h.ledgerFindMany.mockResolvedValue([
      { personId: "a", createdAt: new Date("2026-07-01"), metadata: null },
      { personId: "a", createdAt: new Date("2026-07-06"), metadata: null },
      { personId: "a", createdAt: new Date("2026-07-11"), metadata: null },
      { personId: "a", createdAt: new Date("2026-07-12"), metadata: { kind: "status_flip" } },
    ]);
    await runPeopleIntelligence();
    expect(proposals()[0].data.pendingClassification).toMatchObject({ cadenceDays: 5 });
  });

  it("no proposal over a cadence he set, a waiting suggestion, or one made in the last 30 days", async () => {
    h.peopleFindMany.mockResolvedValue([
      person({ id: "set", cadenceDays: 21 }),
      person({ id: "pending", pendingClassification: { role: "friend" } }),
      person({ id: "recent", metadata: { cadenceProposedAt: new Date(Date.now() - 5 * 86_400_000).toISOString() } }),
    ]);
    await runPeopleIntelligence();
    expect(proposals()).toHaveLength(0);
  });

  it("stamps metadata.cadenceProposedAt next to the proposal, keeping other metadata", async () => {
    h.peopleFindMany.mockResolvedValue([person({ metadata: { firstMentioned: "2026-05-01" } })]);
    await runPeopleIntelligence();
    const data = h.personUpdate.mock.calls[0][0].data as { metadata: Record<string, unknown> };
    expect(data.metadata.firstMentioned).toBe("2026-05-01");
    expect(typeof data.metadata.cadenceProposedAt).toBe("string");
  });

  it("a failed ledger read makes no proposal from a guess", async () => {
    h.peopleFindMany.mockResolvedValue([person()]);
    h.ledgerFindMany.mockRejectedValue(new Error("db down"));
    const out = await runPeopleIntelligence();
    expect(proposals()).toHaveLength(0);
    expect(out.cadence).toBe("ledger_read_failed");
  });
});
