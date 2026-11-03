/**
 * W7 (job 2026-11-02-nour-os-interconnect, map gap 8) · the conversation-mission-link cron writes
 * chat_conversations.mission_id; the missions page is its first reader. One query for every mission on the
 * board, newest three titles each, archived chats left out. A failed read says so on the card, never "no chats".
 *
 * W8c · the same read carries each mission's queued review rows (the linker's medium matches), and a board where
 * no mission has a linked chat says so once, with what the nightly linker does about it, instead of an empty list.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const h = vi.hoisted(() => ({ findMany: vi.fn(), reviews: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { chatConversation: { findMany: h.findMany }, brainMemory: { findMany: h.reviews } } }));

import { MISSION_CHATS_PER_MISSION, MISSION_CHATS_READ_CAP, LINKER_EMBED_PER_RUN, missionChats } from "@/lib/missions/mission-chats";
import { MissionChatsLine, MissionChatsEmptyLine, boardChatsEmpty } from "@/components/missions/mission-chats-line";

const chat = (id: string, missionId: string, at: string, title: string | null = `chat ${id}`) => ({
  id,
  missionId,
  title,
  updatedAt: new Date(at),
});
const review = (missionId: unknown) => ({ metadata: { missionId, conversationId: "c" } });

beforeEach(() => {
  h.findMany.mockReset();
  h.findMany.mockResolvedValue([]);
  h.reviews.mockReset();
  h.reviews.mockResolvedValue([]);
});

describe("missionChats", () => {
  it("reads every mission in one query, live chats only, newest first, capped per mission", async () => {
    h.findMany.mockResolvedValue([
      chat("c1", "m1", "2026-11-02T10:00:00Z"),
      chat("c2", "m1", "2026-11-02T09:00:00Z"),
      chat("c3", "m2", "2026-11-02T08:00:00Z"),
      chat("c4", "m1", "2026-11-01T09:00:00Z"),
      chat("c5", "m1", "2026-10-30T09:00:00Z"),
    ]);
    const { byMission: read, truncated } = await missionChats(["m1", "m2", "m1"]);
    expect(h.findMany).toHaveBeenCalledTimes(1);
    const args = h.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ missionId: { in: ["m1", "m2"] }, archivedAt: null });
    expect(args.orderBy).toEqual({ updatedAt: "desc" });
    expect(read.m1.map((c) => c.id)).toEqual(["c1", "c2", "c4"]);
    expect(read.m1).toHaveLength(MISSION_CHATS_PER_MISSION);
    expect(read.m2.map((c) => c.id)).toEqual(["c3"]);
    expect(truncated).toBe(false);
  });

  it("no missions reads nothing", async () => {
    expect(await missionChats([])).toEqual({ byMission: {}, truncated: false, reviewByMission: {} });
    expect(h.findMany).not.toHaveBeenCalled();
    expect(h.reviews).not.toHaveBeenCalled();
  });

  it("an untitled chat gets a label, not an empty link", async () => {
    h.findMany.mockResolvedValue([chat("c1", "m1", "2026-11-02T10:00:00Z", null)]);
    expect((await missionChats(["m1"])).byMission.m1[0].title).toBe("Untitled chat");
  });

  it("a read that fills its cap says so (older chats may be missing)", async () => {
    h.findMany.mockResolvedValue(Array.from({ length: MISSION_CHATS_READ_CAP }, (_, i) => chat(`c${i}`, "m1", "2026-11-02T10:00:00Z")));
    expect((await missionChats(["m1", "m2"])).truncated).toBe(true);
  });

  it("a failed read throws to the caller (the query's isError), never returns {}", async () => {
    h.findMany.mockRejectedValue(new Error("db down"));
    await expect(missionChats(["m1"])).rejects.toThrow("db down");
  });

  it("counts each mission's open review rows (the linker's medium matches), live rows only, by mission id", async () => {
    h.reviews.mockResolvedValue([review("m1"), review("m1"), review("m2"), review("m9"), review(42), { metadata: null }]);
    const { reviewByMission } = await missionChats(["m1", "m2"]);
    expect(reviewByMission).toEqual({ m1: 2, m2: 1 });
    const args = h.reviews.mock.calls[0][0];
    expect(args.where).toEqual({ category: "conversation_mission_link_review", deletedAt: null });
  });

  it("a failed review read fails the one read (couldn't load), never reads as no reviews", async () => {
    h.reviews.mockRejectedValue(new Error("db down"));
    await expect(missionChats(["m1"])).rejects.toThrow("db down");
  });
});

describe("MissionChatsLine", () => {
  it("links each chat to /chat?cid= (the param the chat page reads)", () => {
    const html = renderToStaticMarkup(
      <MissionChatsLine read={{ chats: [{ id: "c1", title: "Bay two plan", updatedAt: "2026-11-02T10:00:00.000Z" }], truncated: false, reviews: 0 }} />,
    );
    expect(html).toContain('href="/chat?cid=c1"');
    expect(html).toContain("Bay two plan");
  });

  it("a failed read says couldn't load; loading and no chats render nothing", () => {
    expect(renderToStaticMarkup(<MissionChatsLine read="failed" />)).toContain("couldn&#x27;t load");
    expect(renderToStaticMarkup(<MissionChatsLine read="loading" />)).toBe("");
    expect(renderToStaticMarkup(<MissionChatsLine read={{ chats: [], truncated: false, reviews: 0 }} />)).toBe("");
  });

  it("a capped read and a mission past the read limit never render as 'no chats'", () => {
    expect(renderToStaticMarkup(<MissionChatsLine read={{ chats: [], truncated: true, reviews: 0 }} />)).toContain("Older linked chats not read");
    expect(renderToStaticMarkup(<MissionChatsLine read="unread" />)).toContain("Linked chats not read");
  });

  it("a mission with queued review rows says how many chats need a yes and links to the review inbox", () => {
    const html = renderToStaticMarkup(<MissionChatsLine read={{ chats: [], truncated: false, reviews: 2 }} />);
    expect(html).toContain("2 chats need a yes");
    expect(html).toContain('href="/brain?tab=memory"');
    expect(renderToStaticMarkup(<MissionChatsLine read={{ chats: [], truncated: false, reviews: 1 }} />)).toContain("1 chat needs a yes");
  });
});

describe("the board-level empty state (no mission has a linked chat)", () => {
  const empty = { byMission: {}, truncated: false, reviewByMission: {} };
  it("is on only for a measured empty read: never while loading, failed or truncated, never when one chat is linked", () => {
    expect(boardChatsEmpty({ data: empty, isError: false })).toBe(true);
    expect(boardChatsEmpty({ data: undefined, isError: false })).toBe(false);
    expect(boardChatsEmpty({ data: undefined, isError: true })).toBe(false);
    expect(boardChatsEmpty({ data: { ...empty, truncated: true }, isError: false })).toBe(false);
    expect(
      boardChatsEmpty({ data: { ...empty, byMission: { m1: [{ id: "c1", title: "t", updatedAt: "2026-11-02" }] } }, isError: false }),
    ).toBe(false);
  });

  it("says no chats are linked yet and what the nightly linker does, with the real per-night number", () => {
    const html = renderToStaticMarkup(<MissionChatsEmptyLine />);
    expect(html).toContain("No chats linked yet");
    expect(html).toContain(`up to ${LINKER_EMBED_PER_RUN} chats a night`);
  });
});

describe("missionChatsReadFor (the feed's per-card state)", () => {
  const data = { byMission: { m1: [{ id: "c1", title: "t", updatedAt: new Date() }] }, truncated: false, reviewByMission: { m2: 3 } };
  it("maps a failed query to 'failed', a pending one to 'loading', and a mission past the id limit to 'unread'", async () => {
    const { missionChatsReadFor } = await import("@/components/missions/mission-chats-line");
    expect(missionChatsReadFor("m1", ["m1"], { data: undefined, isError: true })).toBe("failed");
    expect(missionChatsReadFor("m1", ["m1"], { data: undefined, isError: false })).toBe("loading");
    expect(missionChatsReadFor("m9", ["m1"], { data, isError: false })).toBe("unread");
    expect(missionChatsReadFor("m2", ["m1", "m2"], { data, isError: false })).toEqual({ chats: [], truncated: false, reviews: 3 });
  });
});
