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
