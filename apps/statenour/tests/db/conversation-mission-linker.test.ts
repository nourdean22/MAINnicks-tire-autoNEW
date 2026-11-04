/**
 * W8c (job 2026-11-02-nour-os-interconnect) · the nightly conversation-mission-link cron linked nothing in 31 runs:
 * only the 39 chats with a pinned summary had an embedding, so 353 of 392 were skipped "no embedding". The linker
 * now embeds, bounded per run, the chats that lack one (title + summary + the first user messages), through the
 * provider's one embedder, and scores only when the chat and EVERY mission share one model: the 26 mission rows
 * were written by the retired venice-bge-m3 lane, and a cosine across two models is a plausible number, not a match.
 *
 * Manager round 1 (2026-11-03): the per-run cap counts embed calls only; a review row Nour decided is never revived
 * or re-queued and its pair never auto-links; queued and resultCount count NEW work only; a linked or re-queued chat
 * closes its other open review rows; embed failures make the run degraded; each write is one transaction.
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
const REVIEW = "conversation_mission_link_review";
const unit = (i: number, dim = 8) => Array.from({ length: dim }, (_, k) => (k === i ? 1 : 0));
/** Cosine 0.5 against unit(0): a review-band match. */
const HALF = [1, 1, 1, 1, 0, 0, 0, 0];

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
type Review = { key: string; deletedAt: Date | null; seenCount: number; metadata: Record<string, unknown> | null };

function store(opts: {
  convs: Conv[];
  rows?: Row[];
  messages?: Record<string, string[]>;
  goals?: Array<{ id: string; title: string; why: string | null }>;
  missions?: Array<{ id: string; title: string }>;
  reviews?: Review[];
  /** Rows the SET mission_id UPDATE reports (0 = the chat was linked by someone else first). */
  linkRowCount?: number;
}) {
  const rows: Row[] = [...(opts.rows ?? [])];
  const reviews: Review[] = (opts.reviews ?? []).map((r) => ({ ...r }));
  const sql: Array<{ q: string; inTx: boolean }> = [];
  let n = 0;
  const missions = (opts.missions ?? [{ id: "m1", title: "Bay two lift install" }]).map((m) => ({
    ...m,
    domain: "BUSINESS",
    successMetric: null,
    weeklyReviewNote: null,
    planData: null,
    taskTitles: [],
  }));
  const make = (inTx: boolean) => ({
    $executeRawUnsafe: vi.fn(async (q: string) => {
      sql.push({ q, inTx });
      return q.includes("SET mission_id") ? (opts.linkRowCount ?? 1) : 1;
    }),
    vectorEmbedding: {
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
  });
  const tx = make(true);
  const top = make(false);
  const prisma = {
    ...top,
    $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
    $queryRawUnsafe: vi.fn(async (q: string) => (q.includes("FROM chat_conversations") ? opts.convs : missions)),
    vectorEmbedding: { ...top.vectorEmbedding, findMany: vi.fn(async () => rows.map((r) => ({ ...r }))) },
    chatMessage: {
      findMany: vi.fn(async ({ where, take }: { where: { conversationId: string }; take: number }) =>
        (opts.messages?.[where.conversationId] ?? []).slice(0, take).map((content) => ({ content })),
      ),
    },
    brainMemory: {
      findMany: vi.fn(async () => reviews.map((r) => ({ ...r }))),
      upsert: vi.fn(async ({ where, create, update }: { where: { category_key: { key: string } }; create: Review; update: Partial<Review> }) => {
        const key = where.category_key.key;
        const r = reviews.find((x) => x.key === key);
        if (r) {
          Object.assign(r, update, { seenCount: r.seenCount + 1 });
          return { seenCount: r.seenCount, deletedAt: r.deletedAt };
        }
        const fresh = { key, deletedAt: null, seenCount: 1, metadata: (create.metadata as Record<string, unknown>) ?? null };
        reviews.push(fresh);
        return { seenCount: 1, deletedAt: null };
      }),
      updateMany: vi.fn(async ({ where }: { where: { key: { startsWith: string; not: string }; deletedAt: null } }) => {
        let count = 0;
        for (const r of reviews) {
          if (r.deletedAt === null && r.key.startsWith(where.key.startsWith) && r.key !== where.key.not) {
            r.deletedAt = new Date();
            count++;
          }
        }
        return { count };
      }),
    },
    lifeGoal: { findMany: vi.fn(async () => opts.goals ?? []) },
  };
  return { prisma, rows, reviews, sql, tx };
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
const conv = (id: string, title: string | null = `chat ${id}`): Conv => ({ id, title, pinnedSummary: null, topicTags: null, mission_id: null });
const run = (prisma: unknown) => runConversationMissionLinkBackfill({ prisma: prisma as never });
const chatCreates = (s: ReturnType<typeof store>) =>
  [...s.tx.vectorEmbedding.create.mock.calls, ...s.prisma.vectorEmbedding.create.mock.calls].filter(
    (c) => (c[0] as { data: Row }).data.sourceType === "chat_conversation",
  );
const chatEmbedCalls = () => h.embed.mock.calls.filter((c) => String(c[0]).startsWith("chat ")).length;
const linkSql = (s: ReturnType<typeof store>) => s.sql.filter((x) => x.q.includes("SET mission_id"));
const rejected = (key: string): Review => ({ key, deletedAt: new Date("2026-11-01"), seenCount: 2, metadata: { decision: "rejected" } });

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
    expect(linkSql(s).some((x) => x.q.includes("SET mission_id = 'm1'") && x.q.includes("id = 'c1'"))).toBe(true);
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

  it("the cap counts embed CALLS: 40 failing embeds use the slots and the 41st chat waits for the next night", async () => {
    const convs = Array.from({ length: LINKER_EMBED_PER_RUN + 1 }, (_, i) => conv(`c${i}`));
    const s = store({ convs, rows: [missionRow(null)] });
    h.embed.mockImplementation(async (text: string) => (text.startsWith("chat ") ? { vec: [], model: null } : { vec: unit(0), model: SPACE }));
    const report = await run(s.prisma);
    expect(chatEmbedCalls()).toBe(LINKER_EMBED_PER_RUN);
    expect(report.embedFailed).toBe(LINKER_EMBED_PER_RUN);
    expect(report.skippedNoEmbedding).toBe(1);
  });

  it("a chat with nothing to embed (no title, no user message) never uses a slot", async () => {
    const empty = Array.from({ length: LINKER_EMBED_PER_RUN }, (_, i) => conv(`e${i}`, null));
    const s = store({ convs: [...empty, conv("fresh")], rows: [missionRow(null)] });
    const report = await run(s.prisma);
    expect(report.embedded).toBe(1);
    expect(s.rows.some((r) => r.sourceType === "chat_conversation" && r.sourceId === "fresh")).toBe(true);
    expect(report.skippedNoEmbedding).toBe(LINKER_EMBED_PER_RUN);
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
    expect(s.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("dry run with same-model vectors at 1.0 and 0.5 counts the link and the review but writes neither", async () => {
    const mk = (id: string, vec: number[]): Row => ({ id: `v${id}`, sourceType: "chat_conversation", sourceId: id, content: "t", embedding: JSON.stringify(vec), model: SPACE, contentFingerprint: "f" });
    const s = store({ convs: [conv("c1"), conv("c2")], rows: [missionRow(contentFingerprintOf("Bay two lift install\nBUSINESS")), mk("c1", unit(0)), mk("c2", HALF)] });
    const report = await runConversationMissionLinkBackfill({ prisma: s.prisma as never, dryRun: true });
    expect(report.autoLinked).toBe(1);
    expect(report.queuedForReview).toBe(1);
    expect(linkSql(s)).toHaveLength(0);
    expect(s.prisma.brainMemory.upsert).not.toHaveBeenCalled();
    expect(s.prisma.brainMemory.updateMany).not.toHaveBeenCalled();
  });
});

describe("conversation-mission linker · never embeds the same text in one model twice (contentFingerprint)", () => {
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

  it("ARM 2: the same text stored in another model (a fallback night) is re-embedded once, in place, in the current model", async () => {
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
    expect(report.embedded).toBe(1);
    expect(s.rows.filter((r) => r.sourceType === "chat_conversation")).toHaveLength(1);
    expect(s.rows.find((r) => r.id === "vc1")!.model).toBe(SPACE);
    expect(report.autoLinked).toBe(1);
  });

  it("the same text already stored in the missions' model is never embedded again, even when its vector is unreadable", async () => {
    const text = conversationEmbedText({ title: "chat c1", pinnedSummary: null }, []);
    const broken: Row = { id: "vc1", sourceType: "chat_conversation", sourceId: "c1", content: text, embedding: "not json", model: SPACE, contentFingerprint: contentFingerprintOf(text) };
    const s = store({ convs: [conv("c1")], rows: [missionRow(contentFingerprintOf("Bay two lift install\nBUSINESS")), broken] });
    const report = await run(s.prisma);
    expect(chatEmbedCalls()).toBe(0);
    expect(report.embedded).toBe(0);
    expect(report.skippedNoEmbedding).toBe(1);
  });

  it("chats with no vector go first: 40 chats stuck in another model never starve a fresh chat of its slot", async () => {
    const stuck: Row[] = Array.from({ length: LINKER_EMBED_PER_RUN }, (_, i) => {
      const text = conversationEmbedText({ title: `chat s${i}`, pinnedSummary: null }, []);
      return { id: `vs${i}`, sourceType: "chat_conversation", sourceId: `s${i}`, content: text, embedding: JSON.stringify(unit(0)), model: "openai:text-embedding-3-small", contentFingerprint: contentFingerprintOf(text) };
    });
    const s = store({ convs: [...stuck.map((r) => conv(r.sourceId)), conv("fresh")], rows: [missionRow(null), ...stuck] });
    const report = await run(s.prisma);
    expect(s.rows.find((r) => r.sourceType === "chat_conversation" && r.sourceId === "fresh")?.model).toBe(SPACE);
    expect(report.embedded).toBe(LINKER_EMBED_PER_RUN);
    expect(report.skippedOtherSpace).toBe(1); // the one stuck chat past the cap
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

  it("each vector write (row + pgvector columns) runs in one transaction", async () => {
    const s = store({ convs: [conv("c1")], rows: [missionRow(null)] });
    await run(s.prisma);
    const vecSql = s.sql.filter((x) => x.q.includes("UPDATE vector_embeddings"));
    expect(vecSql.length).toBe(2); // the mission refresh + the chat
    expect(vecSql.every((x) => x.inTx)).toBe(true);
    expect(s.prisma.vectorEmbedding.create).not.toHaveBeenCalled();
    expect(s.prisma.vectorEmbedding.update).not.toHaveBeenCalled();
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

  it("with missions in two models no chat is scored at all: ranking against SOME missions can link the wrong one", async () => {
    // m1's refresh fails, so it stays in the retired model; m2 is current. The chat matches m2 strongly.
    const m1Old: Row = { ...missionRow(null, "venice-bge-m3"), id: "vm1", sourceId: "m1", embedding: JSON.stringify(unit(0)) };
    const m2Now: Row = { ...missionRow(null), id: "vm2", sourceId: "m2", embedding: JSON.stringify(unit(1)) };
    const s = store({
      convs: [conv("c1")],
      rows: [m1Old, m2Now],
      missions: [
        { id: "m1", title: "Old lift plan" },
        { id: "m2", title: "Tire rack" },
      ],
    });
    h.embed.mockImplementation(async (text: string) => {
      if (text.startsWith("chat c1")) return { vec: unit(1), model: SPACE };
      if (text.startsWith("Tire rack")) return { vec: unit(1), model: SPACE };
      return { vec: [], model: null }; // m1's refresh fails
    });
    const report = await run(s.prisma);
    expect(report.autoLinked).toBe(0);
    expect(report.belowReviewThreshold).toBe(0);
    expect(report.skippedOtherSpace).toBe(1);
    expect(linkSql(s)).toHaveLength(0);
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

describe("conversation-mission linker · review rows Nour decided stay decided", () => {
  it("a pair Nour rejected never auto-links, even when the chat now matches it exactly", async () => {
    const s = store({ convs: [conv("c1")], rows: [missionRow(null)], reviews: [rejected("c1:m1")] });
    const report = await run(s.prisma);
    expect(report.autoLinked).toBe(0);
    expect(linkSql(s)).toHaveLength(0);
  });

  it("a rejected review-band pair is never re-queued and its decision is never overwritten", async () => {
    const s = store({ convs: [conv("c2")], rows: [missionRow(null)], reviews: [rejected("c2:m1")] });
    h.embed.mockImplementation(async (text: string) => (text.startsWith("chat c2") ? { vec: HALF, model: SPACE } : { vec: unit(0), model: SPACE }));
    const report = await run(s.prisma);
    expect(report.queuedForReview).toBe(0);
    expect(s.prisma.brainMemory.upsert).not.toHaveBeenCalled();
    expect(s.reviews[0].metadata).toEqual({ decision: "rejected" });
    expect(s.reviews[0].deletedAt).not.toBeNull();
  });

  it("a second night over an unchanged review-band chat reports no new work (resultCount 0)", async () => {
    const s = store({ convs: [conv("c2")], rows: [missionRow(null)] });
    h.embed.mockImplementation(async (text: string) => (text.startsWith("chat c2") ? { vec: HALF, model: SPACE } : { vec: unit(0), model: SPACE }));
    const first = await run(s.prisma);
    expect(first.queuedForReview).toBe(1);
    const second = await run(s.prisma);
    expect(second.embedded).toBe(0);
    expect(second.queuedForReview).toBe(0);
    expect(second.resultCount).toBe(0);
    expect(s.reviews.filter((r) => r.key === "c2:m1")).toHaveLength(1);
  });

  it("autoLinked counts only an UPDATE that changed a row (the chat may have been linked first)", async () => {
    const s = store({ convs: [conv("c1")], rows: [missionRow(null)], linkRowCount: 0 });
    const report = await run(s.prisma);
    expect(linkSql(s)).toHaveLength(1);
    expect(report.autoLinked).toBe(0);
  });

  it("auto-linking a chat closes its other open review rows; queueing one closes the rest but not its own", async () => {
    const open = (key: string): Review => ({ key, deletedAt: null, seenCount: 1, metadata: {} });
    const s = store({ convs: [conv("c1"), conv("c2")], rows: [missionRow(null)], reviews: [open("c1:m9"), open("c2:m9"), open("c2:m1")] });
    h.embed.mockImplementation(async (text: string) => (text.startsWith("chat c2") ? { vec: HALF, model: SPACE } : { vec: unit(0), model: SPACE }));
    await run(s.prisma);
    const by = (k: string) => s.reviews.find((r) => r.key === k)!;
    expect(by("c1:m9").deletedAt).not.toBeNull();
    expect(by("c2:m9").deletedAt).not.toBeNull();
    expect(by("c2:m1").deletedAt).toBeNull();
  });
});

describe("conversation-mission linker · the cron result tells the truth", () => {
  it("resultCount is chats embedded + links written + review rows newly queued", async () => {
    const s = store({ convs: [conv("c1"), conv("c2")], rows: [missionRow(null)] });
    h.embed.mockImplementation(async (text: string) => (text.startsWith("chat c2") ? { vec: HALF, model: SPACE } : { vec: unit(0), model: SPACE }));
    const report = await run(s.prisma);
    expect(report.embedded).toBe(2);
    expect(report.autoLinked).toBe(1);
    expect(report.queuedForReview).toBe(1);
    expect(report.resultCount).toBe(4);
    expect(report.degraded).toBe(false);
  });

  it("a mission or goal embed that fails is counted and the run is degraded with a reason (never a clean success)", async () => {
    const s = store({ convs: [], rows: [missionRow(null)], goals: [{ id: "g1", title: "Grow the shop", why: null }] });
    h.embed.mockResolvedValue({ vec: [], model: null });
    const report = await run(s.prisma);
    expect(report.missionEmbedFailed).toBe(1);
    expect(report.goalEmbedFailed).toBe(1);
    expect(report.degraded).toBe(true);
    expect(report.degradedReason).toMatch(/embed/i);
  });

  it("an embedder that throws is logged with its message, counted, and the run goes on", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = store({ convs: [conv("c1")], rows: [missionRow(contentFingerprintOf("Bay two lift install\nBUSINESS"))] });
    h.embed.mockRejectedValue(new Error("cohere 503"));
    const report = await run(s.prisma);
    expect(report.embedFailed).toBe(1);
    expect(report.degraded).toBe(true);
    expect(warn.mock.calls.some((c) => c.join(" ").includes("cohere 503"))).toBe(true);
    warn.mockRestore();
  });

  it("keeps the non-finite guard: a NaN in a provider vector never reaches the SQL literal", async () => {
    const s = store({ convs: [conv("c1")], rows: [missionRow(null)] });
    h.embed.mockImplementation(async (text: string) =>
      text.startsWith("chat c1") ? { vec: [Number.NaN, 1, 0, 0, 0, 0, 0, 0], model: SPACE } : { vec: unit(0), model: SPACE },
    );
    const report = await run(s.prisma);
    const vecSql = s.sql.filter((x) => x.q.includes("UPDATE vector_embeddings"));
    expect(vecSql.length).toBeGreaterThan(0);
    expect(vecSql.some((x) => x.q.includes("NaN"))).toBe(false);
    expect(report.autoLinked).toBe(0);
  });

  it("an Infinity in a vector (cosine = NaN) is noise: no review row with NaN confidence, no link", async () => {
    const s = store({ convs: [conv("c1")], rows: [missionRow(null)] });
    h.embed.mockImplementation(async (text: string) =>
      text.startsWith("chat c1") ? { vec: [Number.POSITIVE_INFINITY, 0, 0, 0, 0, 0, 0, 0], model: SPACE } : { vec: unit(0), model: SPACE },
    );
    const report = await run(s.prisma);
    expect(report.embedded).toBe(1);
    expect(report.queuedForReview).toBe(0);
    expect(report.autoLinked).toBe(0);
    expect(report.belowReviewThreshold).toBe(1);
    expect(s.prisma.brainMemory.upsert).not.toHaveBeenCalled();
    expect(s.sql.filter((x) => x.q.includes("UPDATE vector_embeddings")).some((x) => x.q.includes("Infinity"))).toBe(false);
  });

  it("a non-finite score against one mission is skipped in the loop, so a finite best still wins", async () => {
    // Both missions refresh this run; m1's fresh vector carries an Infinity (cosine NaN), m2's matches the chat.
    const s = store({
      convs: [conv("c1")],
      missions: [
        { id: "m1", title: "Broken vector mission" },
        { id: "m2", title: "Tire rack" },
      ],
    });
    h.embed.mockImplementation(async (text: string) => {
      if (text.startsWith("Broken")) return { vec: [Number.POSITIVE_INFINITY, 0, 0, 0, 0, 0, 0, 0], model: SPACE };
      return { vec: unit(1), model: SPACE };
    });
    const report = await run(s.prisma);
    expect(report.autoLinked).toBe(1);
    expect(linkSql(s).some((x) => x.q.includes("SET mission_id = 'm2'"))).toBe(true);
  });
});
