/**
 * Conversation → knowledge fan-out · 2026-08-19 (memory truth wave).
 *
 * Measured on prod that day: 282 conversations had produced 14
 * conversation_summary rows, only 9.8% of a month's memories could name
 * the conversation that taught them, and the digest's itemized knowledge
 * (decisions, key insight) was extracted by the AI and then never
 * persisted anywhere. These pin the fix:
 *   · every write carries metadata.conversationId (queryable provenance)
 *   · medium/high-stakes decisions fan out as decision_log rows
 *   · the key insight fans out as an insight row
 *   · low-stakes decisions do NOT fan out (noise gate)
 *   · commitments/actionItems do NOT auto-mint rows (the phantom-task
 *     failure mode journal-ingest already had to gate, v10.0.231)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  chatFindMany: vi.fn(),
  auditFindFirst: vi.fn(),
  auditFindMany: vi.fn(),
  auditCreate: vi.fn(),
  memUpsert: vi.fn(),
  aiChat: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    chatMessage: { findMany: h.chatFindMany },
    auditEvent: {
      findFirst: h.auditFindFirst,
      findMany: h.auditFindMany,
      create: h.auditCreate,
    },
    brainMemory: { upsert: h.memUpsert },
  },
}));

vi.mock("@/lib/ai/traced-aichat", () => ({
  makeTracedAiChat: () => h.aiChat,
}));

// Embeddings are fire-and-forget in the module — stub so the dynamic
// import never touches providers.
vi.mock("@/lib/brain/embedding-utils", () => ({
  storeMemoryEmbedding: vi.fn(async () => undefined),
}));

import { summarizeAndStoreConversation } from "@/lib/brain/conversation-memory";

const CONV = "conv-fanout-1";

const DIGEST_JSON = {
  topics: [{ topic: "hiring", depth: "deep_dive" }],
  decisions: [
    { decision: "post the mechanic job ad", stakes: "high", resolved: true },
    { decision: "maybe repaint the bay", stakes: "low", resolved: false },
    { decision: "raise oil-change price $5", stakes: "medium", resolved: false },
  ],
  commitments: [{ what: "post job listing", who: "nour", deadline: "friday" }],
  actionItems: ["ask Mo about referrals"],
  emotionalArc: { start: "tired", end: "focused", trajectory: "improving", triggers: [] },
  peopleMentioned: [],
  keyInsight: "The hiring bottleneck is the real revenue cap",
  followUpNeeded: null,
  relatedConversations: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  h.chatFindMany.mockResolvedValue(
    Array.from({ length: 6 }, (_, i) => ({
      role: i % 2 ? "assistant" : "user",
      content: `turn ${i} — enough text to matter`,
      createdAt: new Date("2026-08-19T12:00:00Z"),
    })),
  );
  h.auditFindFirst.mockResolvedValue(null); // not yet digested
  h.auditFindMany.mockResolvedValue([]);
  h.auditCreate.mockResolvedValue({ id: 1 });
  h.memUpsert.mockImplementation(async (args: { create: { key: string } }) => ({
    id: `mem_${args.create.key}`,
  }));
  h.aiChat.mockResolvedValue({ content: JSON.stringify(DIGEST_JSON) });
});

describe("summarizeAndStoreConversation fan-out", () => {
  it("stamps metadata.conversationId on the summary AND every fanned-out row", async () => {
    await summarizeAndStoreConversation(CONV);

    expect(h.memUpsert).toHaveBeenCalled();
    for (const call of h.memUpsert.mock.calls) {
      const args = call[0] as {
        create: { metadata?: { conversationId?: string } };
        update: { metadata?: { conversationId?: string } };
      };
      expect(args.create.metadata?.conversationId).toBe(CONV);
      expect(args.update.metadata?.conversationId).toBe(CONV);
    }
  });

  it("fans out medium/high-stakes decisions as decision_log and the key insight as insight", async () => {
    await summarizeAndStoreConversation(CONV);

    const rows = h.memUpsert.mock.calls.map(
      (c) => (c[0] as { create: { category: string; key: string; content: string; confidence: number } }).create,
    );
    const decisions = rows.filter((r) => r.category === "decision_log");
    const insights = rows.filter((r) => r.category === "insight");

    expect(decisions.map((d) => d.content)).toEqual([
      expect.stringContaining("post the mechanic job ad"),
      expect.stringContaining("raise oil-change price"),
    ]);
    expect(insights).toHaveLength(1);
    expect(insights[0].content).toContain("hiring bottleneck");

    // Honest confidence: 0.5 IS "seen once" in the 0.5+0.1(n−1) formula.
    // This wave exists because writers stamped 0.9/1.0 on first sight.
    for (const r of [...decisions, ...insights]) {
      expect(r.confidence).toBe(0.5);
      expect(r.key.startsWith(`conv_${CONV}_`)).toBe(true);
    }
  });

  it("does NOT fan out low-stakes decisions, commitments, or action items", async () => {
    await summarizeAndStoreConversation(CONV);

    // Scope to the fanned-out rows: the episode summary blob is ALLOWED
    // to mention everything (it is the evidence); the gate is on what
    // becomes an individually recallable row.
    const contents = h.memUpsert.mock.calls
      .map((c) => (c[0] as { create: { category: string; content: string } }).create)
      .filter((r) => r.category !== "conversation_summary")
      .map((r) => r.content)
      .join(" | ");
    expect(contents).not.toContain("repaint the bay");
    // Commitments/actionItems stay episode-only until a review lane exists.
    expect(contents).not.toContain("post job listing — friday");
    expect(contents).not.toContain("ask Mo about referrals");
  });

  it("writes nothing when the conversation was already digested", async () => {
    h.auditFindFirst.mockResolvedValue({ id: 99 });
    await summarizeAndStoreConversation(CONV);
    expect(h.memUpsert).not.toHaveBeenCalled();
  });
});
