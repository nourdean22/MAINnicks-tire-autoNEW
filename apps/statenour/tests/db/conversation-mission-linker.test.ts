/**
 * W8c (job 2026-11-02-nour-os-interconnect) · the nightly conversation-mission-link cron linked nothing in 31 runs:
 * only the 39 chats with a pinned summary had an embedding, so 353 of 392 were skipped "no embedding". The linker
 * now embeds, bounded per run, the chats that lack one (title + summary + the first user messages), through the
 * provider's one embedder, and scores a pair only when both vectors come from the same model: the 26 mission rows
 * were written by the retired venice-bge-m3 lane, and a cosine across two models is a plausible number, not a match.
 *
 * Every test drives runConversationMissionLinkBackfill against an in-memory store (the function takes `prisma`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ embed: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/ai/provider", () => ({ getEmbeddingWithModel: h.embed }));

import {
  LINKER_EMBED_PER_RUN,
  LINKER_FIRST_USER_MESSAGES,
  conversationEmbedText,
  contentFingerprintOf,
  runConversationMissionLinkBackfill,
} from "@/lib/db/conversation-mission-linker";

const SPACE = "cohere:embed-v4.0";
const unit = (i: number, dim = 8) => Array.from({ length: dim }, (_, k) => (k === i ? 1 : 0));

type Row = {
  id: string;
  sourceType: string;
  sourceId: string;
  content: string;
  embedding: string;
  model: string | null;
  contentFingerprint: string | null;
};
type Conv = { id: string; title: string | null; pinnedSummary: string | null; topicTags: unknown; mission_id: string | null };

function store(opts: {
  convs: Conv[];
  rows?: Row[];
  messages?: Record<string, string[]>;
  goals?: Array<{ id: string; title: string; why: string | null }>;
}) {
  const rows: Row[] = [...(opts.rows ?? [])];
  const sql: string[] = [];
  let n = 0;
  const missions = [
    { id: "m1", title: "Bay two lift install", domain: "BUSINESS", successMetric: null, weeklyReviewNote: null, planData: null, taskTitles: [] },
  ];
  const prisma = {
    $executeRawUnsafe: vi.fn(async (q: string) => {
      sql.push(q);
      return 1;
    }),
    $queryRawUnsafe: vi.fn(async (q: string) => (q.includes("FROM chat_conversations") ? opts.convs : missions)),
    vectorEmbedding: {
      findMany: vi.fn(async () => rows.map((r) => ({ ...r }))),
      create: vi.fn(async ({ data }: { data: Omit<Row, "id"> }) => {
        const row = { id: `ve${++n}`, ...data } as Row;
        rows.push(row);
        return { id: row.id };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        const r = rows.find((x) => x.id === where.id)!;
        Object.assign(r, data);
        return { id: r.id };
      }),
    },
    chatMessage: {
      findMany: vi.fn(async ({ where, take }: { where: { conversationId: string }; take: number }) =>
        (opts.messages?.[where.conversationId] ?? []).slice(0, take).map((content) => ({ content })),
      ),
    },
    brainMemory: { upsert: vi.fn(async () => ({})) },
    lifeGoal: { findMany: vi.fn(async () => opts.goals ?? []) },
  };
  return { prisma, rows, sql };
}

const missionRow = (fp: string | null, model = SPACE): Row => ({
  id: "vm1",
  sourceType: "mission",
  sourceId: "m1",
  content: "x",
  embedding: JSON.stringify(unit(0)),
  model,
  contentFingerprint: fp,
});
const conv = (id: string, title = `chat ${id}`): Conv => ({ id, title, pinnedSummary: null, topicTags: null, mission_id: null });
const run = (prisma: unknown) => runConversationMissionLinkBackfill({ prisma: prisma as never });
const chatCreates = (s: ReturnType<typeof store>) =>
  s.prisma.vectorEmbedding.create.mock.calls.filter((c) => (c[0] as { data: Row }).data.sourceType === "chat_conversation");

beforeEach(() => {
  h.embed.mockReset();
  h.embed.mockResolvedValue({ vec: unit(0), model: SPACE });
});

describe("conversation-mission linker · embeds the chats that have no vector", () => {
  it("embeds a chat with no row from its title and first user messages, stores model + fingerprint, then links it", async () => {
    const s = store({ convs: [conv("c1", "Lift quote")], rows: [missionRow(null)], messages: { c1: ["call the lift vendor", "bay two needs the lift"] } });
    const report = await run(s.prisma);
    const chatRow = s.rows.find((r) => r.sourceType === "chat_conversation" && r.sourceId === "c1");
    expect(chatRow).toBeDefined();
    expect(chatRow!.model).toBe(SPACE);
    const text = conversationEmbedText({ title: "Lift quote", pinnedSummary: null }, ["call the lift vendor", "bay two needs the lift"]);
    expect(chatRow!.content).toBe(text);
    expect(chatRow!.contentFingerprint).toBe(contentFingerprintOf(text));
    expect(report.embedded).toBe(1);
    expect(report.skippedNoEmbedding).toBe(0);
    expect(report.autoLinked).toBe(1);
    expect(s.sql.some((q) => q.includes("SET mission_id = 'm1'") && q.includes("id = 'c1'"))).toBe(true);
  });

  it("reads at most LINKER_FIRST_USER_MESSAGES user messages, oldest first", async () => {
    const s = store({ convs: [conv("c1")], rows: [missionRow(null)] });
    await run(s.prisma);
    const args = s.prisma.chatMessage.findMany.mock.calls[0][0] as { where: unknown; orderBy: unknown; take: number };
    expect(args.where).toEqual({ conversationId: "c1", role: "user" });
    expect(args.orderBy).toEqual({ createdAt: "asc" });
    expect(args.take).toBe(LINKER_FIRST_USER_MESSAGES);
  });

  it("embeds at most LINKER_EMBED_PER_RUN chats a run; the rest stay skippedNoEmbedding for the next night", async () => {
    const extra = 3;
    const convs = Array.from({ length: LINKER_EMBED_PER_RUN + extra }, (_, i) => conv(`c${i}`));
    const s = store({ convs, rows: [missionRow(null)] });
    const report = await run(s.prisma);
    expect(chatCreates(s)).toHaveLength(LINKER_EMBED_PER_RUN);
    expect(report.embedded).toBe(LINKER_EMBED_PER_RUN);
    expect(report.skippedNoEmbedding).toBe(extra);
  });

  it("an embed that fails stores nothing and is counted, never thrown", async () => {
    const s = store({ convs: [conv("c1")], rows: [missionRow(null)] });
    h.embed.mockImplementation(async (text: string) => (text.startsWith("chat c1") ? { vec: [], model: null } : { vec: unit(0), model: SPACE }));
    const report = await run(s.prisma);
    expect(s.rows.some((r) => r.sourceType === "chat_conversation")).toBe(false);
    expect(report.embedFailed).toBe(1);
    expect(report.autoLinked).toBe(0);
  });

  it("dry run embeds nothing and writes nothing", async () => {
    const s = store({ convs: [conv("c1")], rows: [missionRow(null)] });
    await runConversationMissionLinkBackfill({ prisma: s.prisma as never, dryRun: true });
    expect(h.embed).not.toHaveBeenCalled();
    expect(s.prisma.vectorEmbedding.create).not.toHaveBeenCalled();
    expect(s.prisma.vectorEmbedding.update).not.toHaveBeenCalled();
  });
});

describe("conversation-mission linker · never embeds the same chat twice (contentFingerprint)", () => {
  it("ARM 1: a second run over the same chats makes no embed call and writes no second row", async () => {
    const s = store({ convs: [conv("c1"), conv("c2")], messages: { c1: ["lift"], c2: ["tires"] } });
    await run(s.prisma);
    const callsAfterFirst = h.embed.mock.calls.length;
    expect(callsAfterFirst).toBe(3); // the mission + two chats
    const second = await run(s.prisma);
    expect(h.embed.mock.calls.length).toBe(callsAfterFirst);
    expect(second.embedded).toBe(0);
    expect(s.rows.filter((r) => r.sourceType === "chat_conversation" && r.sourceId === "c1")).toHaveLength(1);
  });

  it("ARM 2: a chat whose row holds the same text in another model is not re-embedded; it is counted, not scored", async () => {
    const text = conversationEmbedText({ title: "chat c1", pinnedSummary: null }, []);
    const other: Row = {
      id: "vc1",
      sourceType: "chat_conversation",
      sourceId: "c1",
      content: text,
      embedding: JSON.stringify(unit(0)),
      model: "openai:text-embedding-3-small",
      contentFingerprint: contentFingerprintOf(text),
    };
    const s = store({ convs: [conv("c1")], rows: [missionRow(null), other] });
    const report = await run(s.prisma);
    expect(h.embed.mock.calls.some((c) => String(c[0]).startsWith("chat c1"))).toBe(false);
    expect(report.skippedOtherSpace).toBe(1);
    expect(report.autoLinked).toBe(0);
  });

  it("CONTROL: a chat whose row holds DIFFERENT text (a legacy summary vector) is re-embedded once, in place", async () => {
    const legacy: Row = {
      id: "vc1",
      sourceType: "chat_conversation",
      sourceId: "c1",
      content: "old summary",
      embedding: JSON.stringify(unit(3)),
      model: "venice-bge-m3",
      contentFingerprint: null,
    };
    const s = store({ convs: [conv("c1")], rows: [missionRow(null), legacy] });
    const report = await run(s.prisma);
    expect(report.embedded).toBe(1);
    expect(s.rows.filter((r) => r.sourceType === "chat_conversation")).toHaveLength(1);
    expect(s.rows.find((r) => r.id === "vc1")!.model).toBe(SPACE);
    expect(report.autoLinked).toBe(1);
  });
});

describe("conversation-mission linker · one embedding space", () => {
  it("never scores a chat vector against a mission vector from another model", async () => {
    // The mission refresh fails, so its row stays in the retired space; the chat embeds in the current one.
    const s = store({ convs: [conv("c1")], rows: [missionRow(null, "venice-bge-m3")] });
    h.embed.mockImplementation(async (text: string) => (text.startsWith("chat c1") ? { vec: unit(0), model: SPACE } : { vec: [], model: null }));
    const report = await run(s.prisma);
    expect(report.autoLinked).toBe(0);
    expect(report.queuedForReview).toBe(0);
    expect(report.skippedOtherSpace).toBe(1);
  });

  it("a mission row from the retired lane (no fingerprint) is re-embedded in place, once", async () => {
    const s = store({ convs: [], rows: [missionRow(null, "venice-bge-m3")] });
    const first = await run(s.prisma);
    expect(first.missionEmbeddingsCreated).toBe(1);
    expect(s.rows.filter((r) => r.sourceType === "mission")).toHaveLength(1);
    expect(s.rows[0].model).toBe(SPACE);
    const second = await run(s.prisma);
    expect(second.missionEmbeddingsCreated).toBe(0);
  });
});

describe("conversation-mission linker · embeds the active goals for the mission goal suggestion", () => {
  it("embeds each active goal (title + why) once as sourceType life_goal; a second run with the same text embeds none", async () => {
    const s = store({ convs: [], rows: [missionRow(null)], goals: [{ id: "g1", title: "Grow the shop", why: "a second bay" }] });
    const first = await run(s.prisma);
    const goalRow = s.rows.find((r) => r.sourceType === "life_goal" && r.sourceId === "g1");
    expect(goalRow).toMatchObject({ model: SPACE, content: "Grow the shop\na second bay" });
    expect(first.goalEmbeddingsCreated).toBe(1);
    expect(s.prisma.lifeGoal.findMany.mock.calls[0][0].where).toEqual({ status: "active", deletedAt: null });
    const calls = h.embed.mock.calls.length;
    const second = await run(s.prisma);
    expect(second.goalEmbeddingsCreated).toBe(0);
    expect(h.embed.mock.calls.length).toBe(calls);
    expect(s.rows.filter((r) => r.sourceType === "life_goal")).toHaveLength(1);
  });

  it("goal embeds never count against the chat embed cap", async () => {
    const convs = Array.from({ length: LINKER_EMBED_PER_RUN }, (_, i) => conv(`c${i}`));
    const s = store({ convs, rows: [missionRow(null)], goals: [{ id: "g1", title: "Grow the shop", why: null }] });
    const report = await run(s.prisma);
    expect(report.embedded).toBe(LINKER_EMBED_PER_RUN);
    expect(report.goalEmbeddingsCreated).toBe(1);
  });
});

describe("conversation-mission linker · the cron result tells the truth", () => {
  it("resultCount is chats embedded + links written + review rows queued", async () => {
    const s = store({ convs: [conv("c1"), conv("c2")], rows: [missionRow(null)] });
    // c2 scores ~0.5 against the mission: a review row, not a link.
    h.embed.mockImplementation(async (text: string) =>
      text.startsWith("chat c2") ? { vec: [1, 1, 1, 1, 0, 0, 0, 0], model: SPACE } : { vec: unit(0), model: SPACE },
    );
    const report = await run(s.prisma);
    expect(report.embedded).toBe(2);
    expect(report.autoLinked).toBe(1);
    expect(report.queuedForReview).toBe(1);
    expect(report.resultCount).toBe(4);
  });

  it("keeps the non-finite guard: a NaN in a provider vector never reaches the SQL literal", async () => {
    const s = store({ convs: [conv("c1")], rows: [missionRow(null)] });
    h.embed.mockImplementation(async (text: string) =>
      text.startsWith("chat c1") ? { vec: [Number.NaN, 1, 0, 0, 0, 0, 0, 0], model: SPACE } : { vec: unit(0), model: SPACE },
    );
    await run(s.prisma);
    const vecSql = s.sql.filter((q) => q.includes("UPDATE vector_embeddings"));
    expect(vecSql.length).toBeGreaterThan(0);
    expect(vecSql.some((q) => q.includes("NaN"))).toBe(false);
  });
});
