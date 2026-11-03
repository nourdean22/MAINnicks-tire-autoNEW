/**
 * W8b · the engine is honest about its budget and claims its writes (audit B5, B6, B13 on the merged interconnect diff).
 *
 *  · the per-run call cap is one named constant, not a bare 5;
 *  · every person it CALLS for gets `metadata.enrichTriedAt`, even when the model returned nothing worth parking,
 *    and is not called again within ENRICH_RETRY_DAYS, so one silent person no longer eats a slot every night;
 *  · the people the cap left for tomorrow are counted (`enrichDeferred`), not forgotten;
 *  · a merged suggestion keeps the cadence's own basis as `cadenceBasis`;
 *  · the cadence write is a compare-and-swap on the empty slot (Prisma.AnyNull), and losing it is not a failure.
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
import { ENRICH_CALLS_PER_RUN, ENRICH_RETRY_DAYS, runPeopleIntelligence } from "@/lib/brain/people-intelligence";

const person = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: `Sami${id}`,
  role: "friend",
  relationship: "friend",
  trustScore: 0.5,
  lastInteraction: new Date(),
  dossierUpdatedAt: null,
  interactionCount: 1,
  cadenceDays: 14,
  leverageNotes: null,
  metadata: null,
  pendingClassification: null,
  ...over,
});
const noteFor = (ids: string[]) => ids.map((id) => ({ personId: id, note: `helped ${id} move`, metadata: null }));
const updatesFor = (id: string) => h.personUpdate.mock.calls.map((c) => c[0] as { where: { id: string }; data: Record<string, unknown> }).filter((u) => u.where.id === id);
const daysAgoIso = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  h.personUpdate.mockResolvedValue({});
  h.ledgerFindMany.mockResolvedValue([]);
  h.chatFindMany.mockResolvedValue([]);
  h.aiChat.mockResolvedValue({ content: JSON.stringify({ role: "close_friend", leverageNotes: "Call on Sundays", trustAdjustment: 0 }), provider: "ollama" });
});

describe("enrich budget", () => {
  it("the cap is a named constant and the people past it are counted as deferred", async () => {
    expect(ENRICH_CALLS_PER_RUN).toBe(5);
    const ids = ["a", "b", "c", "d", "e", "f", "g"];
    h.peopleFindMany.mockResolvedValue(ids.map((id) => person(id)));
    h.ledgerFindMany.mockResolvedValue(noteFor(ids));
    const r = await runPeopleIntelligence();
    expect(h.aiChat).toHaveBeenCalledTimes(ENRICH_CALLS_PER_RUN);
    expect(r.enrichDeferred).toBe(2);
  });

  it("every call stamps enrichTriedAt, even when the model gave nothing worth parking", async () => {
    h.peopleFindMany.mockResolvedValue([person("a"), person("b")]);
    h.ledgerFindMany.mockResolvedValue(noteFor(["a", "b"]));
    // b: the model proposes exactly what is already there -> nothing to park.
    h.aiChat
      .mockResolvedValueOnce({ content: JSON.stringify({ role: "close_friend", leverageNotes: "Call on Sundays", trustAdjustment: 0 }), provider: "ollama" })
      .mockResolvedValueOnce({ content: JSON.stringify({ role: "friend", leverageNotes: "", trustAdjustment: 0 }), provider: "ollama" });
    await runPeopleIntelligence();
    const a = updatesFor("a");
    expect(a).toHaveLength(1);
    expect((a[0].data.metadata as Record<string, unknown>).enrichTriedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const b = updatesFor("b");
    expect(b).toHaveLength(1);
    expect((b[0].data.metadata as Record<string, unknown>).enrichTriedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(b[0].data.pendingClassification).toBeUndefined();
  });

  it("a person tried within ENRICH_RETRY_DAYS is skipped and not counted as deferred; past it, called again", async () => {
    expect(ENRICH_RETRY_DAYS).toBe(7);
    h.peopleFindMany.mockResolvedValue([
      person("fresh", { metadata: { enrichTriedAt: daysAgoIso(1) } }),
      person("old", { metadata: { enrichTriedAt: daysAgoIso(ENRICH_RETRY_DAYS + 1) } }),
    ]);
    h.ledgerFindMany.mockResolvedValue(noteFor(["fresh", "old"]));
    const r = await runPeopleIntelligence();
    expect(h.aiChat).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(h.aiChat.mock.calls[0][0])).toContain("Samiold");
    expect(r.enrichDeferred).toBe(0);
  });

  it("merging onto a cadence proposal keeps the cadence's own basis as cadenceBasis", async () => {
    h.peopleFindMany.mockResolvedValue([
      person("a", { cadenceDays: null, pendingClassification: { cadenceDays: 14, basis: "default for friend", suggestedAt: "2026-10-30" } }),
    ]);
    h.ledgerFindMany.mockResolvedValue(noteFor(["a"]));
    await runPeopleIntelligence();
    const pc = updatesFor("a")[0].data.pendingClassification as Record<string, unknown>;
    expect(pc).toMatchObject({ cadenceDays: 14, cadenceBasis: "default for friend", role: "close_friend" });
    expect(pc.basis).toContain("helped a move");
  });
});

describe("cadence proposal claim", () => {
  it("the write is pinned to the EMPTY slot it read; losing the swap (P2025) is not an error", async () => {
    // leverageNotes set so the enrich pass skips; cadenceDays null so the cadence pass proposes.
    h.peopleFindMany.mockResolvedValue([person("a", { cadenceDays: null, leverageNotes: "has notes" })]);
    await runPeopleIntelligence();
    const [u] = updatesFor("a");
    expect(u.where).toEqual({ id: "a", pendingClassification: { equals: Prisma.AnyNull } });
    expect(h.logError).not.toHaveBeenCalled();

    h.personUpdate.mockRejectedValueOnce(Object.assign(new Error("no match"), { code: "P2025" }));
    const r = await runPeopleIntelligence();
    expect(r.cadenceProposed).toBe(0);
    expect(h.logError).not.toHaveBeenCalled();
  });
});
