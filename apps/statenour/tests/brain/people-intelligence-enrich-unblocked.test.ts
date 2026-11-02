/**
 * "Needs info" never shrank (Nour, 2026-11-02: "the count is the same as it was before").
 *
 * Prod read that day: 10 sparse people, 9 of them holding a cadence-only proposal parked by
 * W2 on 2026-10-30, and one people-intelligence model call in 10 days. The enrich pass skipped
 * ANY pending suggestion, so a cadence proposal blocked the role and notes proposal for good.
 * Its context was also empty for all 10: their only ledger notes are the generic
 * "interaction reported in chat (...)" line the backfill writes, which says nothing about
 * the person. His own chat messages naming the person are the context that exists.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  peopleFindMany: vi.fn(),
  personUpdate: vi.fn(),
  ledgerFindMany: vi.fn(),
  chatFindMany: vi.fn(),
  aiChat: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    personProfile: { findMany: h.peopleFindMany, update: h.personUpdate },
    relationshipLedger: { findMany: h.ledgerFindMany },
    chatMessage: { findMany: h.chatFindMany },
  },
}));
vi.mock("@/lib/ai/traced-aichat", () => ({ makeTracedAiChat: () => h.aiChat }));
vi.mock("@/lib/utils/error-log", () => ({ logError: h.logError }));

import { Prisma } from "@prisma/client";
import { runPeopleIntelligence } from "@/lib/brain/people-intelligence";

const person = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: `Sami${id}`,
  role: "friend",
  relationship: "friend",
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

const CADENCE_ONLY = { cadenceDays: 14, basis: "default for friend", suggestedAt: "2026-10-30" };

const userTurn = () =>
  (h.aiChat.mock.calls[0][0] as Array<{ role: string; content: string }>).find((m) => m.role === "user")?.content ?? "";
const enrichWrites = () =>
  h.personUpdate.mock.calls
    .map((c) => (c[0] as { where: Record<string, unknown> & { id: string }; data: { pendingClassification?: Record<string, unknown> } }))
    .filter((a) => a.data.pendingClassification && "leverageNotes" in a.data.pendingClassification);

beforeEach(() => {
  vi.clearAllMocks();
  h.personUpdate.mockResolvedValue({});
  h.ledgerFindMany.mockResolvedValue([]);
  h.chatFindMany.mockResolvedValue([]);
  h.aiChat.mockResolvedValue({
    content: JSON.stringify({ role: "close_friend", leverageNotes: "Call on Sundays", trustAdjustment: 0 }),
    provider: "ollama",
  });
});

describe("enrich pass after the backfill", () => {
  it("a cadence-only proposal does not block it, and the cadence survives in the merged suggestion", async () => {
    h.peopleFindMany.mockResolvedValue([person("a", { pendingClassification: CADENCE_ONLY })]);
    h.ledgerFindMany.mockResolvedValue([{ personId: "a", note: "helped move the couch" }]);

    await runPeopleIntelligence();

    expect(h.aiChat).toHaveBeenCalledTimes(1);
    const [w] = enrichWrites();
    expect(w.data.pendingClassification).toMatchObject({ cadenceDays: 14, role: "close_friend", leverageNotes: "Call on Sundays" });
  });

  it("a waiting role or notes suggestion is left for his answer: no call", async () => {
    h.peopleFindMany.mockResolvedValue([
      person("a", { pendingClassification: { role: "mentor", leverageNotes: null, trustAdjustment: 0 } }),
    ]);
    h.ledgerFindMany.mockResolvedValue([{ personId: "a", note: "helped move the couch" }]);

    await runPeopleIntelligence();

    expect(h.aiChat).not.toHaveBeenCalled();
  });

  it("the generic backfill note is not context; his own chat words naming the person are", async () => {
    h.peopleFindMany.mockResolvedValue([person("a")]);
    h.ledgerFindMany.mockResolvedValue([{ personId: "a", note: "interaction reported in chat (call)" }]);
    h.chatFindMany.mockResolvedValue([
      { content: "Samiah texted me about the wedding plans" }, // a longer name containing it: not a match
      { content: "Saw Samia yesterday, she starts the nursing job Monday" },
    ]);

    await runPeopleIntelligence();

    expect(h.aiChat).toHaveBeenCalledTimes(1);
    expect(userTurn()).toContain("starts the nursing job Monday");
    expect(userTurn()).not.toContain("interaction reported in chat");
    expect(userTurn()).not.toContain("wedding plans");
    const where = h.chatFindMany.mock.calls[0][0].where;
    expect(where.role).toBe("user"); // his words only, never the assistant's
  });

  it("only generic notes and no chat mention: no call", async () => {
    h.peopleFindMany.mockResolvedValue([person("a")]);
    h.ledgerFindMany.mockResolvedValue([{ personId: "a", note: "interaction reported in chat (other)" }]);

    await runPeopleIntelligence();

    expect(h.aiChat).not.toHaveBeenCalled();
  });

  it("a never-logged person his chats name gets a suggestion too", async () => {
    h.peopleFindMany.mockResolvedValue([person("a", { interactionCount: 0, lastInteraction: null })]);
    h.chatFindMany.mockResolvedValue([{ content: "Samia is the one who referred the Camry customer" }]);

    await runPeopleIntelligence();

    expect(h.aiChat).toHaveBeenCalledTimes(1);
    expect(enrichWrites()).toHaveLength(1);
  });

  it("the write is pinned to the suggestion slot it read (second reader on 3519)", async () => {
    h.peopleFindMany.mockResolvedValue([
      person("a", { pendingClassification: CADENCE_ONLY }),
      person("b"),
    ]);
    h.ledgerFindMany.mockResolvedValue([
      { personId: "a", note: "helped move the couch" },
      { personId: "b", note: "dinner at his place" },
    ]);

    await runPeopleIntelligence();

    const [a, b] = enrichWrites();
    expect(a.where).toEqual({ id: "a", pendingClassification: { equals: CADENCE_ONLY } });
    expect(b.where).toEqual({ id: "b", pendingClassification: { equals: Prisma.AnyNull } });
  });

  it("he answered the banner mid-run: the stale write matches nothing and is skipped, not a failure", async () => {
    h.peopleFindMany.mockResolvedValue([person("a", { pendingClassification: CADENCE_ONLY })]);
    h.ledgerFindMany.mockResolvedValue([{ personId: "a", note: "helped move the couch" }]);
    h.personUpdate.mockRejectedValueOnce(Object.assign(new Error("No record found"), { code: "P2025" }));

    const out = await runPeopleIntelligence();

    expect(out.profilesUpdated).toBe(0);
    expect(h.logError).not.toHaveBeenCalled();
  });

  it("a dismissed suggestion stays away 30 days, like a dismissed cadence", async () => {
    const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
    const old40 = daysAgo(40);
    h.peopleFindMany.mockResolvedValue([
      person("recent", { metadata: { enrichProposedAt: daysAgo(5) } }),
      person("old", { metadata: { enrichProposedAt: old40, cadenceProposedAt: old40 } }),
    ]);
    h.ledgerFindMany.mockResolvedValue([
      { personId: "recent", note: "helped move the couch" },
      { personId: "old", note: "dinner at his place" },
    ]);

    await runPeopleIntelligence();

    expect(h.aiChat).toHaveBeenCalledTimes(1);
    const [w] = enrichWrites();
    expect(w.where.id).toBe("old");
    // The stamp that starts the next 30 days, other metadata kept.
    const meta = (w.data as { metadata?: Record<string, string> }).metadata ?? {};
    expect(Date.parse(meta.enrichProposedAt)).toBeGreaterThan(Date.now() - 60_000);
    expect(meta.cadenceProposedAt).toBe(old40);
  });

  it("a failed chat read is flagged, never a quiet night", async () => {
    h.peopleFindMany.mockResolvedValue([person("a")]);
    h.chatFindMany.mockRejectedValue(new Error("db down"));

    const out = await runPeopleIntelligence();

    expect(h.aiChat).not.toHaveBeenCalled();
    expect(out.enrich).toBe("chat_read_failed");
  });
});
