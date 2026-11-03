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
  linkJournalPeople: h.link,
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
  h.link.mockImplementation(async (a: { people: Array<{ name: string }> }) => ({
    personIds: a.people.map((p) => `p_${p.name.toLowerCase()}`),
    recorded: 0,
    skipped: 0,
    failed: 0,
    rejected: 0,
    linkedNames: a.people.map((p) => p.name),
    rejectedNames: [],
  }));
});

describe("createReflection · people at save", () => {
  it("links every live person named whole-word in the text, as a mention (not a contact), with the toggle OFF", async () => {
    const r = await createReflection(input);
    expect(h.link).toHaveBeenCalledTimes(1);
    const call = h.link.mock.calls[0][0];
    expect(call).toMatchObject({ silo: "reflection", dumpId: "r1", createdAt });
    // "mo" matches Mo whole-word and case-insensitively; "Mohammed" is not in the text.
    expect(call.people).toEqual([
      { name: "Dania", interacted: false },
      { name: "Mo", interacted: false },
    ]);
    expect(r.peopleLinked).toEqual({ names: ["Dania", "Mo"] });
    expect(h.peopleFindMany.mock.calls[0][0].where).toEqual({ deletedAt: null });
  });

  it("no name in the text: no link call, peopleLinked names empty", async () => {
    const r = await createReflection({ ...input, fields: { what: "Quiet day, nothing about anyone." } });
    expect(h.link).not.toHaveBeenCalled();
    expect(r.peopleLinked).toEqual({ names: [] });
  });

  it("a failed people read or link never fails the save: peopleLinked is null (unknown), the reflection is returned", async () => {
    h.peopleFindMany.mockRejectedValue(new Error("down"));
    const r = await createReflection(input);
    expect(r.reflection.id).toBe("r1");
    expect(r.peopleLinked).toBeNull();
  });
});
