/**
 * People W4 S2 (2026-10-30, manager-approved contract): Nick's read-only chat
 * tool getRelationshipPicks. Its execute IS pickRelationshipsForToday, so chat
 * and /people can never disagree; it maps the picks to the approved shape and
 * caps them at `limit` (1-5, default 3). Registered as personal_read, battle,
 * free, read-only, routed by people phrasings, and NOT on the agent-bridge
 * (MCP) surface: names stay inside NOUR OS.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ picks: vi.fn() }));
vi.mock("@/lib/ai/relationships-pick-today", () => ({ pickRelationshipsForToday: h.picks }));

import { tasksTools } from "@/lib/ai/tools/tasks";
import { TOOL_CATALOG } from "@/lib/ai/tools/catalog";
import { TOOL_FAMILIES } from "@/lib/ai/tool-families";
import { READ_ONLY_TOOLS } from "@/lib/ai/tools/read-only-tools";

type Exec = { execute: (args: unknown, opts?: unknown) => Promise<unknown>; inputSchema: { safeParse(v: unknown): { success: boolean } } };
const tool = tasksTools.getRelationshipPicks as unknown as Exec;

const pick = (id: string, extra: Record<string, unknown> = {}) => ({
  personId: id,
  personName: `Demo ${id}`,
  rationale: `Demo reason ${id}`,
  ...extra,
});

beforeEach(() => vi.clearAllMocks());

describe("getRelationshipPicks", () => {
  it("returns today's picks in the approved shape, capped at 3 by default", async () => {
    h.picks.mockResolvedValue({
      picks: [
        pick("p1", { daysQuiet: 40, openPromises: 1, seeingOn: "tomorrow", maxim: { text: "Demo maxim", source: "Demo Book" } }),
        pick("p2"),
        pick("p3"),
        pick("p4"),
      ],
      source: "fresh",
      calendar: "ok",
      generatedAt: "2026-10-30T16:00:00Z",
    });
    const out = (await tool.execute({}, {})) as { picks: unknown[]; source: string; calendar: string };
    expect(out.source).toBe("fresh");
    expect(out.calendar).toBe("ok");
    expect(out.picks).toHaveLength(3);
    expect(out.picks[0]).toEqual({
      personId: "p1",
      name: "Demo p1",
      why: "Demo reason p1",
      daysQuiet: 40,
      openPromises: 1,
      seeingOn: "tomorrow",
      maxim: { text: "Demo maxim", source: "Demo Book" },
    });
    expect(out.picks[1]).toEqual({
      personId: "p2",
      name: "Demo p2",
      why: "Demo reason p2",
      daysQuiet: null,
      openPromises: null,
      seeingOn: null,
      maxim: null,
    });
  });

  it("limit is 1 to 5", async () => {
    h.picks.mockResolvedValue({ picks: [pick("p1"), pick("p2")], source: "cache", generatedAt: "x" });
    expect(((await tool.execute({ limit: 1 }, {})) as { picks: unknown[] }).picks).toHaveLength(1);
    expect(tool.inputSchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(tool.inputSchema.safeParse({ limit: 6 }).success).toBe(false);
    expect(tool.inputSchema.safeParse({ limit: 5 }).success).toBe(true);
  });

  it("an older cached row with no calendar field reads as calendar unknown, never ok", async () => {
    h.picks.mockResolvedValue({ picks: [pick("p1")], source: "cache", generatedAt: "x" });
    expect(((await tool.execute({}, {})) as { calendar: string }).calendar).toBe("unknown");
  });

  it("a failed picks read throws, so the chat says it could not read them instead of 'nobody'", async () => {
    h.picks.mockRejectedValue(new Error("db down"));
    await expect(tool.execute({}, {})).rejects.toThrow(/db down/);
  });
});

describe("getRelationshipPicks registration", () => {
  it("is catalogued personal_read, battle, free; in the personal-read family; read-only", () => {
    expect(TOOL_CATALOG.find((t) => t.name === "getRelationshipPicks")).toEqual({
      name: "getRelationshipPicks",
      category: "personal_read",
      battle: true,
      cost: "free",
    });
    expect((TOOL_FAMILIES as Record<string, { family: string }>).getRelationshipPicks?.family).toBe("personal-read");
    expect([...READ_ONLY_TOOLS]).toContain("getRelationshipPicks");
  });
});
