/**
 * The conversation_digest audit row never carries people (guard, people W0 2026-10-30).
 *
 * v10.0.35 stripped `peopleMentioned` from the AuditEvent payload because that
 * table has no row-level access control. People W0 moved the one reader that
 * still wanted those names (people-intelligence enrich) onto the ledger, so
 * nothing needs the field back. This pins the strip: delete it in
 * conversation-memory.ts and the first case goes red.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  chatFindMany: vi.fn(),
  convFindUnique: vi.fn(),
  convFindMany: vi.fn(),
  auditFindMany: vi.fn(),
  auditCreate: vi.fn(),
  memUpsert: vi.fn(),
  memFindUnique: vi.fn(),
  memFindMany: vi.fn(),
  aiChat: vi.fn(),
  resolve: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    chatMessage: { findMany: h.chatFindMany },
    chatConversation: { findUnique: h.convFindUnique, findMany: h.convFindMany },
    auditEvent: { findMany: h.auditFindMany, create: h.auditCreate },
    brainMemory: { upsert: h.memUpsert, findUnique: h.memFindUnique, findMany: h.memFindMany },
  },
}));
vi.mock("@/lib/ai/traced-aichat", () => ({ makeTracedAiChat: () => h.aiChat }));
vi.mock("@/lib/brain/embedding-utils", () => ({ storeMemoryEmbedding: vi.fn(async () => undefined) }));
vi.mock("@/lib/brain/person-profile-fuzzy", () => ({ resolvePersonByName: h.resolve }));

import { summarizeAndStoreConversation } from "@/lib/brain/conversation-memory";

const NAME = "Zebulon Quartermaine";
const DIGEST = {
  topics: [{ topic: "family dinner", depth: "deep_dive" }],
  decisions: [],
  commitments: [],
  actionItems: [],
  emotionalArc: { start: "tired", end: "calm", trajectory: "improving", triggers: [] },
  peopleMentioned: [
    { name: NAME, context: "talked about his new job", sentiment: "positive", interacted: true, interactionKind: "call", interactionNote: null },
    { name: "Ophelia Brightwater", context: "mentioned only", sentiment: "neutral", interacted: false, interactionKind: null, interactionNote: null },
  ],
  keyInsight: "Family time lowers stress",
  followUpNeeded: null,
  relatedConversations: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  h.chatFindMany.mockResolvedValue(
    Array.from({ length: 6 }, (_, i) => ({
      role: i % 2 ? "assistant" : "user",
      content: `turn ${i} with enough text`,
      createdAt: new Date("2026-10-29T12:00:00Z"),
    })),
  );
  h.convFindUnique.mockResolvedValue({ updatedAt: new Date("2026-10-29T13:00:00Z") });
  h.auditFindMany.mockResolvedValue([]);
  h.auditCreate.mockResolvedValue({ id: 1 });
  h.memUpsert.mockImplementation(async (a: { create: { key: string } }) => ({ id: `mem_${a.create.key}` }));
  h.memFindUnique.mockResolvedValue(null);
  h.aiChat.mockResolvedValue({ content: JSON.stringify(DIGEST), provider: "ollama" });
  h.resolve.mockResolvedValue({ matched: false, person: null, matchTier: "no_match" });
});

describe("conversation_digest audit payload", () => {
  it("has no peopleMentioned and no person name, even when the digest named people", async () => {
    await expect(summarizeAndStoreConversation("conv-audit-1")).resolves.toBe("compiled");

    const digestRows = h.auditCreate.mock.calls
      .map((c) => c[0] as { data: { eventType: string; payload: Record<string, unknown> } })
      .filter((a) => a.data.eventType === "conversation_digest");
    expect(digestRows).toHaveLength(1);
    const payload = digestRows[0].data.payload;
    expect(payload).not.toHaveProperty("peopleMentioned");
    expect(JSON.stringify(digestRows[0].data)).not.toContain("Zebulon");
    expect(JSON.stringify(digestRows[0].data)).not.toContain("Ophelia");
  });

  it("POSITIVE CONTROL: the rest of the digest is still in the payload", async () => {
    await summarizeAndStoreConversation("conv-audit-1");
    const row = h.auditCreate.mock.calls.map((c) => c[0]).find((a) => a.data.eventType === "conversation_digest");
    expect(row.data.payload.keyInsight).toBe("Family time lowers stress");
  });
});
