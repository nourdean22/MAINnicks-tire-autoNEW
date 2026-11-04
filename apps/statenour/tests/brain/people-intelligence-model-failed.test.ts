/**
 * W8b manager round 1, items 1, 6, 9 · what a model outage and a stamped person look like to the run.
 *
 * aiChat never throws on a total provider failure: it returns a sentinel (provider none or emergency). The engine
 * read that as "nothing to suggest", stamped enrichTriedAt so the person was skipped for 7 days, and the run row said
 * nothing_to_propose. And proposeCadences wrote the run-start metadata, erasing the stamp from the same run.
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

import { runPeopleIntelligence } from "@/lib/brain/people-intelligence";
import { peopleRunStateOf } from "@/lib/brain/people-intelligence-run";

const person = {
  id: "a",
  name: "Samia",
  role: "friend",
  relationship: "friend",
  trustScore: 0.5,
  lastInteraction: new Date(),
  dossierUpdatedAt: null,
  interactionCount: 3,
  cadenceDays: null,
  leverageNotes: null,
  metadata: { lovemap: "x" },
  pendingClassification: null,
};
type Update = { where: Record<string, unknown>; data: { metadata?: Record<string, unknown>; pendingClassification?: unknown } };
const updates = () => h.personUpdate.mock.calls.map((c) => c[0] as Update);

beforeEach(() => {
  vi.clearAllMocks();
  h.personUpdate.mockResolvedValue({});
  h.chatFindMany.mockResolvedValue([]);
  h.peopleFindMany.mockResolvedValue([person]);
  h.ledgerFindMany.mockResolvedValue(
    [0, 7, 14, 21].map((d) => ({ personId: "a", note: "helped a move", metadata: null, createdAt: new Date(Date.now() - d * 86_400_000), source: "manual", amount: 1 })),
  );
});

describe("a failed model call (item 1)", () => {
  it.each(["none", "emergency"])("provider %s: no stamp, the run is failed with model_failed", async (provider) => {
    h.aiChat.mockResolvedValue({ content: "I'm having trouble connecting", provider });
    const r = await runPeopleIntelligence();
    expect(updates().some((u) => u.data.metadata && "enrichTriedAt" in u.data.metadata)).toBe(false);
    expect(r.enrich).toBe("model_failed");
    expect(peopleRunStateOf(r)).toEqual({ state: "failed", reason: "model_failed" });
  });

  it("an answer that is not JSON is a failed call too: no stamp, model_failed", async () => {
    h.aiChat.mockResolvedValue({ content: "sure, here is what I think", provider: "ollama" });
    const r = await runPeopleIntelligence();
    expect(updates().some((u) => u.data.metadata && "enrichTriedAt" in u.data.metadata)).toBe(false);
    expect(r.enrich).toBe("model_failed");
  });

  it("control: a good answer with nothing new still stamps, and the run is not failed", async () => {
    h.aiChat.mockResolvedValue({ content: JSON.stringify({ role: "friend", leverageNotes: "", trustAdjustment: 0 }), provider: "ollama" });
    const r = await runPeopleIntelligence();
    expect(updates().some((u) => u.data.metadata && "enrichTriedAt" in u.data.metadata)).toBe(true);
    expect(r.enrich).toBeUndefined();
  });
});

// Codex round, finding 1: a suggestion that was never parked must not cost the person 7 days.
describe("a failed proposal write", () => {
  const answer = { content: JSON.stringify({ role: "mentor", leverageNotes: "knows the lease", trustAdjustment: 0 }), provider: "ollama" };

  it("leaves the person eligible next run: no stamp is written, and the run says so", async () => {
    h.aiChat.mockResolvedValue(answer);
    h.personUpdate.mockRejectedValueOnce(new Error("db down"));
    const r = await runPeopleIntelligence();
    expect(updates().slice(1).some((u) => u.data.metadata && "enrichTriedAt" in u.data.metadata)).toBe(false);
    expect(r.enrich).toBe("write_failed");
  });

  it("control: a lost swap (he answered the banner) is an answered call, so it still stamps", async () => {
    h.aiChat.mockResolvedValue(answer);
    h.personUpdate.mockRejectedValueOnce(Object.assign(new Error("no match"), { code: "P2025" }));
    const r = await runPeopleIntelligence();
    expect(updates().slice(1).some((u) => u.data.metadata && "enrichTriedAt" in u.data.metadata)).toBe(true);
    expect(r.enrich).toBeUndefined();
  });
});

// Codex round, finding 2: deferred means not reached by the cap, and the run names how many it checked.
describe("checked and deferred counts", () => {
  it("a person with nothing to ground a call in is not deferred: the run reached them", async () => {
    h.peopleFindMany.mockResolvedValue([person, { ...person, id: "b", name: "Bassem" }]);
    h.aiChat.mockResolvedValue({ content: JSON.stringify({ role: "friend", leverageNotes: "", trustAdjustment: 0 }), provider: "ollama" });
    const r = await runPeopleIntelligence();
    expect(r).toMatchObject({ enrichChecked: 1, enrichDeferred: 0 });
  });

  it("past the call cap, the rest are deferred", async () => {
    const seven = ["a", "b", "c", "d", "e", "f", "g"].map((id) => ({ ...person, id, name: `Person ${id}` }));
    h.peopleFindMany.mockResolvedValue(seven);
    h.ledgerFindMany.mockResolvedValue(seven.map((p) => ({ personId: p.id, note: "helped a move", metadata: null, createdAt: new Date(), source: "manual", amount: 1 })));
    h.aiChat.mockResolvedValue({ content: JSON.stringify({ role: "friend", leverageNotes: "", trustAdjustment: 0 }), provider: "ollama" });
    const r = await runPeopleIntelligence();
    expect(r).toMatchObject({ enrichChecked: 5, enrichDeferred: 2 });
  });
});

describe("the cadence write keeps the run's stamp (items 6, 9)", () => {
  it("a person stamped then proposed keeps enrichTriedAt, and the swap pins the metadata it builds on", async () => {
    h.aiChat.mockResolvedValue({ content: JSON.stringify({ role: "friend", leverageNotes: "", trustAdjustment: 0 }), provider: "ollama" });
    await runPeopleIntelligence();
    const withMeta = updates().filter((u) => u.data.metadata);
    const last = withMeta.at(-1)!;
    expect(last.data.pendingClassification).toBeTruthy();
    expect(last.data.metadata).toHaveProperty("enrichTriedAt");
    expect(last.data.metadata).toHaveProperty("cadenceProposedAt");
    expect(last.data.metadata).toHaveProperty("lovemap", "x");
    // The swap names the metadata the stamp wrote, not the run-start read.
    expect(last.where.metadata).toEqual({ equals: withMeta[0].data.metadata });
  });

  it("a failed stamp write is not carried: the cadence swap pins what the row still holds", async () => {
    h.aiChat.mockResolvedValue({ content: JSON.stringify({ role: "friend", leverageNotes: "", trustAdjustment: 0 }), provider: "ollama" });
    h.personUpdate.mockRejectedValueOnce(new Error("db down"));
    await runPeopleIntelligence();
    const last = updates().at(-1)!;
    expect(last.where.metadata).toEqual({ equals: { lovemap: "x" } });
    expect(last.data.metadata).not.toHaveProperty("enrichTriedAt");
  });
});
