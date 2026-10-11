/**
 * A failed signal read must not reach the journal brief as "(none)"
 * (audit 02-F4b, 2026-10-10).
 *
 * journal-brief caught a failed goals / missions / entries read into [] and
 * rendered "(none)", which the model reads as "no active goals" and the day's
 * cached brief then repeats. Drift already said "(unavailable)"; these now do too.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  composeBrief: vi.fn(),
  lifeGoals: vi.fn(),
  missions: vi.fn(),
  dumps: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    journalThread: { findMany: vi.fn().mockResolvedValue([]) },
    reflection: { count: vi.fn().mockResolvedValue(0) },
    brainDump: { count: vi.fn().mockResolvedValue(0), findMany: h.dumps },
    lifeGoal: { findMany: h.lifeGoals },
    mission: { findMany: h.missions },
  },
}));
vi.mock("@/lib/brain/drift-detector", () => ({ computeDriftScore: vi.fn().mockRejectedValue(new Error("x")) }));
vi.mock("@/lib/ai/brief-composer", () => ({ composeBrief: h.composeBrief }));

import { POST } from "@/app/api/ai/journal-brief/route";

async function signalBlock(): Promise<string> {
  await POST(new NextRequest("https://x.test/api/ai/journal-brief", { method: "POST" }));
  return (h.composeBrief.mock.calls[0][0] as { signalBlock: string }).signalBlock;
}

/** The lines under a heading, up to the next blank line. */
const section = (block: string, heading: string) => block.split(heading)[1]?.split("\n\n")[0] ?? "";

beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset();
  h.composeBrief.mockResolvedValue("brief");
  h.lifeGoals.mockResolvedValue([]);
  h.missions.mockResolvedValue([]);
  h.dumps.mockResolvedValue([]);
});

describe("journal-brief signal block", () => {
  it("a failed goals read says (unavailable), never (none)", async () => {
    h.lifeGoals.mockRejectedValue(new Error("connection reset"));
    const goals = section(await signalBlock(), "Active goals");
    expect(goals).toContain("(unavailable)");
    expect(goals).not.toContain("(none)");
  });

  it("failed missions and entry reads say (unavailable) too", async () => {
    h.missions.mockRejectedValue(new Error("x"));
    h.dumps.mockRejectedValue(new Error("x"));
    const block = await signalBlock();
    expect(section(block, "Active missions")).toContain("(unavailable)");
    expect(section(block, "Recent entry summaries")).toContain("(unavailable)");
  });

  // R3-15 (review finding 6): the cache key is the ET day, so a brief built on
  // a failed read was served until midnight.
  it.each([
    ["goals", () => h.lifeGoals.mockRejectedValue(new Error("x"))],
    ["missions", () => h.missions.mockRejectedValue(new Error("x"))],
    ["entries", () => h.dumps.mockRejectedValue(new Error("x"))],
  ])("a failed %s read is never cached for the day", async (_name, fail) => {
    fail();
    await signalBlock();
    expect(h.composeBrief.mock.calls[0][0]).toMatchObject({ bypassCache: true });
  });

  it("CONTROL: a clean read uses the day cache", async () => {
    await signalBlock();
    expect((h.composeBrief.mock.calls[0][0] as { bypassCache?: boolean }).bypassCache).toBeFalsy();
  });

  it("CONTROL: a successful empty read is a measured (none)", async () => {
    const block = await signalBlock();
    expect(section(block, "Active goals")).toContain("(none)");
    expect(section(block, "Active goals")).not.toContain("(unavailable)");
  });
});
