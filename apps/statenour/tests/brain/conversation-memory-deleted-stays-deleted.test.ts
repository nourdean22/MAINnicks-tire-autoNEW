/**
 * A memory the operator deleted stays deleted (audit 2026-10-10, 05-M4).
 *
 * The conversation compiler revived ANY soft-deleted row it re-digested
 * (`deletedAt: null` on every upsert). That was meant to undo the nightly
 * merge grinder, but it could not tell the grinder from the operator: forget
 * a decision_log row, let the conversation move, and the next compile brought
 * it back. Now only a row the grinder stamped (metadata.deletedBy +
 * metadata.deletedAt equal to the row's own deletedAt) is revived.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

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

import {
  findCompileEligibleConversations,
  grinderDeleted,
  stampGrinderDelete,
  summarizeAndStoreConversation,
} from "@/lib/brain/conversation-memory";

const CONV = "conv-del-1";
const SUMMARY_KEY = `conv_${CONV}`;
const DECISION_KEY = `conv_${CONV}_decision_0`;
const FORGOT_AT = new Date("2026-10-09T10:00:00Z");

const DIGEST = {
  topics: [{ topic: "hiring", depth: "deep_dive" }],
  decisions: [{ decision: "post the mechanic job ad", stakes: "high", resolved: true }],
  commitments: [],
  actionItems: [],
  emotionalArc: { start: "tired", end: "focused", trajectory: "improving", triggers: [] },
  peopleMentioned: [],
  keyInsight: "The hiring bottleneck is the real revenue cap",
  followUpNeeded: null,
  relatedConversations: [],
};

type UpsertArgs = {
  where: { category_key: { key: string } };
  create: { key: string };
  update: Record<string, unknown>;
};
const upsertFor = (key: string) =>
  h.memUpsert.mock.calls.map((c) => c[0] as UpsertArgs).find((a) => a.create.key === key);

/** Rows by key for the findUnique reads (summary freshness + fan-out). */
function rows(byKey: Record<string, unknown>) {
  h.memFindUnique.mockImplementation(
    async (args: { where: { category_key: { key: string } } }) => byKey[args.where.category_key.key] ?? null,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.chatFindMany.mockResolvedValue(
    Array.from({ length: 6 }, (_, i) => ({
      role: i % 2 ? "assistant" : "user",
      content: `turn ${i} with enough text`,
      createdAt: new Date("2026-10-09T12:00:00Z"),
    })),
  );
  h.convFindUnique.mockResolvedValue({ updatedAt: new Date("2026-10-09T13:00:00Z") });
  h.auditFindMany.mockResolvedValue([]);
  h.auditCreate.mockResolvedValue({ id: 1 });
  h.memUpsert.mockImplementation(async (a: { create: { key: string } }) => ({ id: `mem_${a.create.key}` }));
  h.aiChat.mockResolvedValue({ content: JSON.stringify(DIGEST), provider: "ollama" });
  rows({});
});

describe("re-digest never resurrects an operator delete", () => {
  it("POSITIVE CONTROL: with no deleted rows the compile writes the summary and the decision", async () => {
    await expect(summarizeAndStoreConversation(CONV)).resolves.toBe("compiled");
    expect(upsertFor(SUMMARY_KEY)).toBeDefined();
    expect(upsertFor(DECISION_KEY)).toBeDefined();
  });

  it("forget a decision_log row, re-digest: the row stays deleted (no upsert touches it)", async () => {
    rows({ [DECISION_KEY]: { deletedAt: FORGOT_AT, metadata: { conversationId: CONV } } });

    await expect(summarizeAndStoreConversation(CONV)).resolves.toBe("compiled");

    expect(upsertFor(DECISION_KEY)).toBeUndefined();
    // The rest of the digest still lands.
    expect(upsertFor(SUMMARY_KEY)).toBeDefined();
  });

  it("an operator-deleted summary is not recompiled at all (no digest call, no write)", async () => {
    rows({ [SUMMARY_KEY]: { updatedAt: FORGOT_AT, deletedAt: FORGOT_AT, metadata: null } });

    await expect(summarizeAndStoreConversation(CONV)).resolves.toBe("skipped");
    expect(h.aiChat).not.toHaveBeenCalled();
    expect(h.memUpsert).not.toHaveBeenCalled();
  });

  it("a merge-grinder delete IS revived (the original purpose of the revive)", async () => {
    const ground = { deletedAt: FORGOT_AT, metadata: stampGrinderDelete({ conversationId: CONV }, FORGOT_AT) };
    rows({ [SUMMARY_KEY]: { updatedAt: FORGOT_AT, ...ground }, [DECISION_KEY]: ground });

    await expect(summarizeAndStoreConversation(CONV)).resolves.toBe("compiled");

    expect(upsertFor(SUMMARY_KEY)?.update.deletedAt).toBeNull();
    expect(upsertFor(DECISION_KEY)?.update.deletedAt).toBeNull();
  });

  it("a stale grinder stamp (restored, then forgotten by the operator) does not revive", async () => {
    // The grinder stamped it on 10-01, the operator restored it, then forgot
    // it on 10-09: the stamp no longer describes THIS deletion.
    const stale = {
      deletedAt: FORGOT_AT,
      metadata: stampGrinderDelete({}, new Date("2026-10-01T03:00:00Z")),
    };
    rows({ [DECISION_KEY]: stale });

    await summarizeAndStoreConversation(CONV);

    expect(grinderDeleted(stale)).toBe(false);
    expect(upsertFor(DECISION_KEY)).toBeUndefined();
  });

  it("a live row's upsert never sets deletedAt (a delete during the digest call stands)", async () => {
    rows({
      [SUMMARY_KEY]: { updatedAt: new Date(Date.now() - 2 * 3600_000), deletedAt: null, metadata: null },
      [DECISION_KEY]: { deletedAt: null, metadata: null },
    });
    h.convFindUnique.mockResolvedValue({ updatedAt: new Date() });

    await summarizeAndStoreConversation(CONV);

    expect(upsertFor(SUMMARY_KEY)?.update).not.toHaveProperty("deletedAt");
    expect(upsertFor(DECISION_KEY)?.update).not.toHaveProperty("deletedAt");
  });
});

describe("findCompileEligibleConversations · an operator-deleted summary is not a backlog item", () => {
  const OLD = new Date("2026-10-08T00:00:00Z");

  it("skips operator-deleted summaries and keeps grinder-ground ones eligible", async () => {
    h.convFindMany.mockResolvedValue([
      { id: "a", updatedAt: OLD },
      { id: "b", updatedAt: OLD },
      { id: "c", updatedAt: OLD },
    ]);
    h.memFindMany.mockResolvedValue([
      { key: "conv_a", updatedAt: OLD, deletedAt: FORGOT_AT, metadata: null },
      { key: "conv_b", updatedAt: OLD, deletedAt: FORGOT_AT, metadata: stampGrinderDelete(null, FORGOT_AT) },
    ]);

    const ids = await findCompileEligibleConversations({ limit: 10 });

    expect(ids).toEqual(["b", "c"]);
    // The read must SEE deleted rows to tell them apart.
    expect(h.memFindMany.mock.calls[0][0].where).not.toHaveProperty("deletedAt");
  });
});
