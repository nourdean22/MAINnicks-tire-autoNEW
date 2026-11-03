/**
 * W8b (audit B2) · the /journal composer's reflection reaches People at SAVE time, with no toggle and no model:
 * every live person whose name appears whole-word in the text is linked (ids on reflections.person_ids) through
 * the same gate the journal uses, and the result names them so the composer toast can say "People: Dania".
 * The model pass (enrichJournalEntry) adds contact rows and refused names later; it never un-links these.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ create: vi.fn(), peopleFindMany: vi.fn(), link: vi.fn(), enrich: vi.fn(), ai: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: { reflection: { create: h.create }, personProfile: { findMany: h.peopleFindMany } },
}));
vi.mock("@/lib/ai/traced-aichat", () => ({ tracedAiChat: h.ai, makeTracedAiChat: () => h.ai }));
vi.mock("@/lib/ai/provider", () => ({ isAiSentinel: () => true }));
vi.mock("@/lib/ai/style-adapter", () => ({ applyOperatorStyle: async (s: string) => s }));
vi.mock("@/lib/db/brain-bus-emit", () => ({ emitReflectionCreated: vi.fn(async () => undefined) }));
vi.mock("@/lib/mastery/credit-signal", () => ({ creditFromSignal: vi.fn(async () => undefined) }));
vi.mock("@/lib/brain/journal-ingest", () => ({ ingestJournal: vi.fn(async () => ({})) }));
vi.mock("@/lib/brain/journal-brain", () => ({ enrichJournalEntry: h.enrich }));
vi.mock("@/lib/services/people/journal-link", async (orig) => ({
  ...(await orig<typeof import("@/lib/services/people/journal-link")>()),
  linkNamedPeople: h.link,
}));

import { createReflection } from "@/lib/services/journal-reflect";

const createdAt = new Date("2026-11-03T14:00:00Z");
const input = { template: "driscoll" as const, fields: { what: "Talked to Dania and mo about the lease." }, askPushback: false, extractIntelligence: false };

beforeEach(() => {
  vi.clearAllMocks();
  h.create.mockResolvedValue({ id: "r1", category: "reflection", insight: "x", date: "2026-11-03", scope: "triggered", actionable: false, createdAt });
  h.enrich.mockResolvedValue(undefined);
  h.ai.mockResolvedValue({ content: "", provider: "none" });
  h.peopleFindMany.mockResolvedValue([
    { id: "p_dania", name: "Dania" },
    { id: "p_mo", name: "Mo" },
    { id: "p_moh", name: "Mohammed" },
  ]);
  // The real linkNamedPeople is pinned in tests/services/people-journal-link.test.ts; here it is the seam.
  h.link.mockImplementation(async (a: { rawText: string }) => ({
    names: ["Dania", "Mo"].filter((n) => a.rawText.toLowerCase().includes(n.toLowerCase())),
  }));
});

describe("createReflection · people at save", () => {
  it("runs the save-time name link on the reflection (silo, id, createdAt, his text) with the toggle OFF, and names the people", async () => {
    const r = await createReflection(input);
    expect(h.link).toHaveBeenCalledTimes(1);
    expect(h.link.mock.calls[0][0]).toMatchObject({ silo: "reflection", dumpId: "r1", createdAt });
    expect(h.link.mock.calls[0][0].rawText).toContain("Talked to Dania and mo about the lease.");
    expect(r.peopleLinked).toEqual({ names: ["Dania", "Mo"] });
  });

  it("no name in the text: peopleLinked names empty, never null", async () => {
    const r = await createReflection({ ...input, fields: { what: "Quiet day, nothing about anyone." } });
    expect(r.peopleLinked).toEqual({ names: [] });
  });

  it("a failed people read or link never fails the save: peopleLinked is null (unknown), the reflection is returned", async () => {
    h.link.mockRejectedValue(new Error("down"));
    const r = await createReflection(input);
    expect(r.reflection.id).toBe("r1");
    expect(r.peopleLinked).toBeNull();
  });
});
