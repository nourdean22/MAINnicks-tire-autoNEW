/**
 * W7 (job 2026-11-02-nour-os-interconnect, map gap 8) · the conversation-mission-link cron writes
 * chat_conversations.mission_id; the missions page is its first reader. One query for every mission on the
 * board, newest three titles each, archived chats left out. A failed read says so on the card, never "no chats".
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const h = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { chatConversation: { findMany: h.findMany } } }));

import { MISSION_CHATS_PER_MISSION, MISSION_CHATS_READ_CAP, missionChats } from "@/lib/missions/mission-chats";
import { MissionChatsLine } from "@/components/missions/mission-chats-line";

const chat = (id: string, missionId: string, at: string, title: string | null = `chat ${id}`) => ({
  id,
  missionId,
  title,
  updatedAt: new Date(at),
});

beforeEach(() => {
  h.findMany.mockReset();
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
    expect(await missionChats([])).toEqual({ byMission: {}, truncated: false });
    expect(h.findMany).not.toHaveBeenCalled();
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
});

describe("MissionChatsLine", () => {
  it("links each chat to /chat?cid= (the param the chat page reads)", () => {
    const html = renderToStaticMarkup(
      <MissionChatsLine read={{ chats: [{ id: "c1", title: "Bay two plan", updatedAt: "2026-11-02T10:00:00.000Z" }], truncated: false }} />,
    );
    expect(html).toContain('href="/chat?cid=c1"');
    expect(html).toContain("Bay two plan");
  });

  it("a failed read says couldn't load; loading and no chats render nothing", () => {
    expect(renderToStaticMarkup(<MissionChatsLine read="failed" />)).toContain("couldn&#x27;t load");
    expect(renderToStaticMarkup(<MissionChatsLine read="loading" />)).toBe("");
    expect(renderToStaticMarkup(<MissionChatsLine read={{ chats: [], truncated: false }} />)).toBe("");
  });

  it("a capped read and a mission past the read limit never render as 'no chats'", () => {
    expect(renderToStaticMarkup(<MissionChatsLine read={{ chats: [], truncated: true }} />)).toContain("Older linked chats not read");
    expect(renderToStaticMarkup(<MissionChatsLine read="unread" />)).toContain("Linked chats not read");
  });
});
