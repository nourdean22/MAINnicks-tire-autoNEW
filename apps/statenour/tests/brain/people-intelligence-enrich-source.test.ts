/**
 * The enrich pass reads context that exists (people W0, 2026-10-30).
 *
 * It used to read `payload.peopleMentioned` off conversation_digest audit
 * rows, but the digest strips that field before the insert (the v10.0.35 PII
 * fix, conversation-memory.ts): AuditEvent has no row-level access control,
 * so names stay out of it. The reader therefore always saw nothing, and on
 * prod it also never ran at all, because 12 sparse profiles failed its
 * `sparse.length <= 10` gate. It now reads the person's own ledger notes, an
 * access-scoped store, and makes no call for a person with nothing on record.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  peopleFindMany: vi.fn(),
  personUpdate: vi.fn(),
  ledgerFindMany: vi.fn(),
  auditFindMany: vi.fn(),
  aiChat: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    personProfile: { findMany: h.peopleFindMany, update: h.personUpdate },
    relationshipLedger: { findMany: h.ledgerFindMany },
    auditEvent: { findMany: h.auditFindMany },
  },
}));
vi.mock("@/lib/ai/traced-aichat", () => ({ makeTracedAiChat: () => h.aiChat }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));

import { runPeopleIntelligence } from "@/lib/brain/people-intelligence";

const person = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: `Person ${id}`,
  role: "friend",
  relationship: "friend from school",
  trustScore: 0.5,
  lastInteraction: new Date(),
  dossierUpdatedAt: null,
  interactionCount: 1,
  cadenceDays: null,
  leverageNotes: null,
  metadata: null,
  pendingClassification: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.personUpdate.mockResolvedValue({});
  h.auditFindMany.mockResolvedValue([{ payload: { topics: [] } }]); // what prod digests look like now
  h.aiChat.mockResolvedValue({
    content: JSON.stringify({ role: "close_friend", leverageNotes: "Call on Sundays", trustAdjustment: 0.05 }),
    provider: "ollama",
  });
});

describe("runPeopleIntelligence enrich", () => {
  it("sends the person's own ledger notes as the context and parks a suggestion", async () => {
    h.peopleFindMany.mockResolvedValue([person("a")]);
    h.ledgerFindMany.mockResolvedValue([
      { personId: "a", note: "helped move the couch" },
      { personId: "a", note: "dinner at his place" },
    ]);

    const out = await runPeopleIntelligence();

    expect(h.aiChat).toHaveBeenCalledTimes(1);
    const userTurn = (h.aiChat.mock.calls[0][0] as Array<{ role: string; content: string }>).find((m) => m.role === "user");
    expect(userTurn?.content).toContain("helped move the couch");
    expect(userTurn?.content).not.toContain("no recent mentions");
    const data = h.personUpdate.mock.calls[0][0].data.pendingClassification;
    expect(data.basis).toContain("helped move the couch");
    expect(out.profilesUpdated).toBe(1);
    expect(out.enrich).toBeUndefined(); // a good read carries no failure flag
  });

  it("only CONTACT rows are context: a status-flip or synthetic row is never sent", async () => {
    h.peopleFindMany.mockResolvedValue([person("a")]);
    h.ledgerFindMany.mockResolvedValue([
      { personId: "a", note: "status set to cooling", metadata: { kind: "status_flip" } },
      { personId: "a", note: "mentioned in chat", metadata: { synthetic: true } },
    ]);

    await runPeopleIntelligence();

    expect(h.aiChat).not.toHaveBeenCalled();
  });

  it("makes no model call for a sparse person with nothing on record", async () => {
    h.peopleFindMany.mockResolvedValue([person("b", { interactionCount: 0, lastInteraction: null })]);
    h.ledgerFindMany.mockResolvedValue([]);

    await runPeopleIntelligence();

    expect(h.aiChat).not.toHaveBeenCalled();
    // No enrich suggestion. (Since W2 a cadence PROPOSAL may still be parked; that has its own test.)
    const enrichWrites = h.personUpdate.mock.calls.filter(
      (c) => (c[0] as { data: { pendingClassification?: { cadenceDays?: number } } }).data.pendingClassification?.cadenceDays === undefined,
    );
    expect(enrichWrites).toHaveLength(0);
  });

  it("still runs when more than 10 profiles are sparse (prod has 12), capped at 5 calls", async () => {
    const people = Array.from({ length: 12 }, (_, i) => person(`p${i}`));
    h.peopleFindMany.mockResolvedValue(people);
    h.ledgerFindMany.mockResolvedValue(people.map((p) => ({ personId: p.id, note: `note for ${p.id}` })));

    await runPeopleIntelligence();

    expect(h.aiChat).toHaveBeenCalledTimes(5);
  });

  it("a failed ledger read makes no calls and no suggestions", async () => {
    h.peopleFindMany.mockResolvedValue([person("a")]);
    h.ledgerFindMany.mockRejectedValue(new Error("db down"));

    const out = await runPeopleIntelligence();

    expect(h.aiChat).not.toHaveBeenCalled();
    // A dead ledger read must not look like a quiet day to the cron.
    expect(out.enrich).toBe("ledger_read_failed");
  });
});
