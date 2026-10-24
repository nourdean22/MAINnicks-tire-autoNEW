/**
 * Wave C functions cleanup (2026-10-24): the catalog describes what runs.
 *
 * Removed: runPython (E2B_API_KEY unset in prod, runCode covers the job),
 * queryData (superseded by searchTools + invokeTool), searchSkills (merged into
 * suggestSkills). getRecentReflections left the always-on core (0 of 152 turns
 * chose it) but stays a tool. The two external-worker tools were registered with
 * no family, so no phrasing reached them.
 *
 * These checks run against the REAL registries and the REAL pruner. A removed
 * name must be gone from all three registries at once, and an old habit
 * ("use searchSkills") must still land on the tool that replaced it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const recallSkills = vi.hoisted(() => vi.fn());
vi.mock("@/lib/skills/skill-recall", () => ({ recallSkills }));

import { pruneTools } from "@/lib/ai/chat-mode";
import { TOOL_CATALOG } from "@/lib/ai/tools/catalog";
import { TOOL_FAMILIES } from "@/lib/ai/tool-families";
import { nourTools } from "@/lib/ai/tools";

const REMOVED = ["runPython", "queryData", "searchSkills"] as const;

/** The same name-keyed shape prepareTools hands the pruner. */
function catalogTools(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const t of TOOL_CATALOG) out[t.name] = {};
  return out;
}
async function offeredFor(prompt: string): Promise<string[]> {
  return Object.keys((await pruneTools("standard" as never, catalogTools(), prompt)) as Record<string, unknown>);
}

describe("removed tools leave all three registries together", () => {
  it.each(REMOVED)("%s is gone from the catalog, TOOL_FAMILIES and nourTools", (name) => {
    expect(TOOL_CATALOG.map((t) => t.name)).not.toContain(name);
    expect(Object.keys(TOOL_FAMILIES)).not.toContain(name);
    expect(Object.keys(nourTools)).not.toContain(name);
  });

  it("POSITIVE CONTROL: the kept replacements are present in all three", () => {
    for (const name of ["runCode", "suggestSkills", "searchTools", "invokeTool", "getRecentReflections"]) {
      expect(TOOL_CATALOG.map((t) => t.name)).toContain(name);
      expect(Object.keys(TOOL_FAMILIES)).toContain(name);
      expect(Object.keys(nourTools)).toContain(name);
    }
  });
});

describe("an old habit still lands on the tool that replaced the name", () => {
  it.each([
    ["searchSkills mobile ux audit", "suggestSkills"],
    ["call runPython on this list of numbers", "runCode"],
  ])("%s -> %s", async (prompt, kept) => {
    expect(await offeredFor(prompt)).toContain(kept);
  });

  it("CONTROL: an unrelated sentence does not drag the replacement in through the alias", async () => {
    expect(await offeredFor("what time does the shop open")).not.toContain("suggestSkills");
  });
});

describe("getRecentReflections left the always-on core and is still reachable", () => {
  it("is not offered on a turn that has nothing to do with reflections", async () => {
    expect(await offeredFor("what time does the shop open")).not.toContain("getRecentReflections");
  });
  it.each(["show me my recent reflections", "what have I been reflecting on lately"])("is offered for %s", async (prompt) => {
    expect(await offeredFor(prompt)).toContain("getRecentReflections");
  });
});

describe("suggestSkills answers the inputs searchSkills documented", () => {
  beforeEach(() => {
    recallSkills.mockReset();
    recallSkills.mockImplementation(async (_q: string, k: number) =>
      Array.from({ length: k }, (_, i) => ({ name: `skill-${i}`, description: "d", category: "c", similarity: 0.5 })),
    );
  });
  const suggest = nourTools.suggestSkills as unknown as {
    inputSchema: { parse: (v: unknown) => unknown };
    execute: (a: unknown, o?: unknown) => Promise<{ count: number }>;
  };

  it("topK (the old name for the count) is honoured", async () => {
    const res = await suggest.execute(suggest.inputSchema.parse({ query: "mobile ux audit", topK: 5 }), {});
    expect(res.count).toBe(5);
    expect(recallSkills).toHaveBeenCalledWith("mobile ux audit", 5);
  });
  it("CONTROL: limit still works and the default stays 3", async () => {
    expect((await suggest.execute(suggest.inputSchema.parse({ query: "mobile ux audit", limit: 7 }), {})).count).toBe(7);
    expect((await suggest.execute(suggest.inputSchema.parse({ query: "mobile ux audit" }), {})).count).toBe(3);
  });
});

describe("the external-worker tools are reachable (registration is not reachability)", () => {
  it.each([
    "what is the render worker doing",
    "show me the external worker lanes",
    "is the worker busy right now",
  ])("%s surfaces both worker tools", async (prompt) => {
    const offered = await offeredFor(prompt);
    expect(offered).toContain("getExternalWorkerLanes");
    expect(offered).toContain("getExternalWorkerJob");
  });

  it("CONTROL: a cron question still reaches getCronStatus and does not pull the worker tools", async () => {
    const offered = await offeredFor("which cron jobs failed");
    expect(offered).toContain("getCronStatus");
    expect(offered).not.toContain("getExternalWorkerLanes");
  });
});
