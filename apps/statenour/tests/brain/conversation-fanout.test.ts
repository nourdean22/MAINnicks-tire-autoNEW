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
  convFindUnique: vi.fn(),
  auditFindFirst: vi.fn(),
  auditFindMany: vi.fn(),
  auditCreate: vi.fn(),
  memUpsert: vi.fn(),
  memFindUnique: vi.fn(),
  aiChat: vi.fn(),
  personUpdate: vi.fn(),
  resolve: vi.fn(),
  recordOnce: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    chatMessage: { findMany: h.chatFindMany },
    chatConversation: { findUnique: h.convFindUnique },
    auditEvent: {
      findFirst: h.auditFindFirst,
      findMany: h.auditFindMany,
      create: h.auditCreate,
    },
    brainMemory: { upsert: h.memUpsert, findUnique: h.memFindUnique },
    personProfile: { update: h.personUpdate },
  },
}));

// 2026-09-16 · a MENTION is not a CONTACT. The people fan-out used to bump
// lastInteraction/interactionCount for every extracted name with no ledger
// row behind it; it now resolves the name and writes ONE chat ledger row
// through the seam only when the digest says Nour actually interacted.
vi.mock("@/lib/brain/person-profile-fuzzy", () => ({ resolvePersonByName: h.resolve }));
vi.mock("@/lib/services/people/record-interaction", () => ({
  recordInteractionOnce: h.recordOnce,
  recordInteraction: vi.fn(),
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
  h.convFindUnique.mockResolvedValue({ updatedAt: new Date("2026-08-19T13:00:00Z") });
  h.memFindUnique.mockResolvedValue(null); // no summary row yet → compile
  h.auditFindFirst.mockResolvedValue(null);
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

  // ── 2026-08-19 · memory-loop wave · the freshness guard replaces the
  // one-shot-forever AuditEvent guard (which pinned every conversation to
  // a single digest at message 4-6, and combined with audit-before-memory
  // write order could lose a conversation permanently).

  it("skips when the summary row is NEWER than the conversation's last activity", async () => {
    h.memFindUnique.mockResolvedValue({
      updatedAt: new Date("2026-08-19T14:00:00Z"), // after conv 13:00
      deletedAt: null,
    });
    await summarizeAndStoreConversation(CONV);
    expect(h.aiChat).not.toHaveBeenCalled();
    expect(h.memUpsert).not.toHaveBeenCalled();
  });

  it("debounces per-turn recompiles: stale but written <30min ago → skip", async () => {
    h.memFindUnique.mockResolvedValue({
      updatedAt: new Date(Date.now() - 5 * 60_000), // 5 min ago
      deletedAt: null,
    });
    h.convFindUnique.mockResolvedValue({ updatedAt: new Date() }); // moved since
    await summarizeAndStoreConversation(CONV);
    expect(h.aiChat).not.toHaveBeenCalled();
  });

  it("RECOMPILES when the conversation moved after a >30min-old summary", async () => {
    h.memFindUnique.mockResolvedValue({
      updatedAt: new Date(Date.now() - 2 * 3600_000), // 2h ago
      deletedAt: null,
    });
    h.convFindUnique.mockResolvedValue({ updatedAt: new Date() });
    await summarizeAndStoreConversation(CONV);
    expect(h.memUpsert).toHaveBeenCalled();
  });

  it("a merge-ground (soft-deleted) summary row does NOT count as fresh — recompiling revives it", async () => {
    // The grinder finding: 158 of 173 summaries were soft-deleted by the
    // nightly merge, and the old guard made them unrecoverable forever.
    h.memFindUnique.mockResolvedValue({
      updatedAt: new Date("2026-08-19T14:00:00Z"), // "fresh" — but deleted
      deletedAt: new Date("2026-08-19T15:00:00Z"),
    });
    await summarizeAndStoreConversation(CONV);
    expect(h.memUpsert).toHaveBeenCalled();
    const summaryCall = h.memUpsert.mock.calls
      .map((c) => c[0] as { create: { category: string }; update: { deletedAt?: null } })
      .find((a) => a.create.category === "conversation_summary");
    expect(summaryCall?.update.deletedAt).toBeNull();
  });

  it("a digest-lane failure (budget exhausted) is swallowed loudly AND reported as failed", async () => {
    // Self-audit 2026-08-20: the void-return version let the sweep count
    // this as "compiled" — a budget-exhausted night reported 10/10 green
    // with zero rows written (the repo's all-clear-on-failure trap).
    h.aiChat.mockRejectedValue(new Error("BudgetExceededError: daily cap"));
    await expect(summarizeAndStoreConversation(CONV)).resolves.toBe("failed");
    expect(h.memUpsert).not.toHaveBeenCalled();
  });

  it("statuses are truthful: fresh skip → skipped, real compile → compiled", async () => {
    h.memFindUnique.mockResolvedValue({
      updatedAt: new Date("2026-08-19T14:00:00Z"),
      deletedAt: null,
    });
    await expect(summarizeAndStoreConversation(CONV)).resolves.toBe("skipped");

    h.memFindUnique.mockResolvedValue(null);
    await expect(summarizeAndStoreConversation(CONV)).resolves.toBe("compiled");
  });
});

// ── 2026-09-16 · people: a mention is not a contact ─────────────────────
describe("people fan-out — a mention is not a contact", () => {
  const FIRST = new Date("2026-09-15T12:00:00Z");
  const LAST = new Date("2026-09-15T12:40:00Z");

  beforeEach(() => {
    h.chatFindMany.mockResolvedValue([
      { role: "user", content: "walked the bays with Mash today, we talked staffing", createdAt: FIRST },
      { role: "assistant", content: "noted", createdAt: new Date("2026-09-15T12:10:00Z") },
      { role: "user", content: "should I trust Dania with the books?", createdAt: new Date("2026-09-15T12:20:00Z") },
      { role: "assistant", content: "here is how I would think about it", createdAt: new Date("2026-09-15T12:30:00Z") },
      { role: "user", content: "ok", createdAt: LAST },
    ]);
    h.convFindUnique.mockResolvedValue({ updatedAt: LAST });
    h.resolve.mockResolvedValue({ person: { id: "p2", name: "Mash" }, matched: true, matchTier: "exact" });
    h.recordOnce.mockResolvedValue({ skipped: false, recorded: { ledgerId: "L1" } });
  });

  it("a mere mention writes NOTHING to the profile's interaction fields and no ledger row", async () => {
    h.aiChat.mockResolvedValue({
      content: JSON.stringify({
        ...DIGEST_JSON,
        peopleMentioned: [
          { name: "Dania", context: "asked whether to trust her with the books", sentiment: "neutral", interacted: false, interactionKind: null },
        ],
      }),
    });
    await expect(summarizeAndStoreConversation(CONV)).resolves.toBe("compiled");
    expect(h.personUpdate).not.toHaveBeenCalled();
    expect(h.recordOnce).not.toHaveBeenCalled();
  });

  it("a reported interaction becomes ONE chat ledger row through the seam: dated by the conversation, windowed from its start, no XP", async () => {
    h.aiChat.mockResolvedValue({
      content: JSON.stringify({
        ...DIGEST_JSON,
        peopleMentioned: [
          {
            name: "Mash",
            context: "GM at the shop",
            sentiment: "positive",
            interacted: true,
            interactionKind: "in_person",
            interactionNote: "walked the bays with him, talked staffing",
          },
        ],
      }),
    });
    await summarizeAndStoreConversation(CONV);

    expect(h.resolve).toHaveBeenCalledWith("Mash", expect.objectContaining({ createIfMissing: false }));
    expect(h.recordOnce).toHaveBeenCalledTimes(1);
    expect(h.recordOnce).toHaveBeenCalledWith({
      personId: "p2",
      amount: 1,
      note: "walked the bays with him, talked staffing",
      source: "chat",
      at: LAST,
      noRowSince: FIRST,
      creditXp: false,
      metadata: {
        auto: true,
        via: "conversation_digest",
        conversationId: CONV,
        interactionKind: "in_person",
        sentiment: "positive",
        matchTier: "exact",
      },
    });
    // The old direct bump is gone for good — the seam owns both counters.
    expect(h.personUpdate).not.toHaveBeenCalled();
  });

  it("an unknown name is never created and never logged; a malformed flag is not an interaction", async () => {
    h.resolve.mockResolvedValue({ person: null, matched: false, matchTier: "no_match" });
    h.aiChat.mockResolvedValue({
      content: JSON.stringify({
        ...DIGEST_JSON,
        peopleMentioned: [
          { name: "Zorblax", context: "new guy", sentiment: "neutral", interacted: true, interactionKind: "call" },
          { name: "Mash", context: "GM", sentiment: "positive", interacted: "yes", interactionKind: "call" },
        ],
      }),
    });
    await summarizeAndStoreConversation(CONV);
    expect(h.recordOnce).not.toHaveBeenCalled();
    expect(h.personUpdate).not.toHaveBeenCalled();
  });

  it("the digest prompt asks the model for the interacted flag (the consumer of the schema is the model)", async () => {
    h.aiChat.mockResolvedValue({ content: JSON.stringify(DIGEST_JSON) });
    await summarizeAndStoreConversation(CONV);
    const system = (h.aiChat.mock.calls[0][0] as Array<{ role: string; content: string }>)[0].content;
    expect(system).toContain('"interacted"');
    expect(system).toContain('"interactionNote"');
    expect(system).toMatch(/never for talking ABOUT someone/i);
  });
});
