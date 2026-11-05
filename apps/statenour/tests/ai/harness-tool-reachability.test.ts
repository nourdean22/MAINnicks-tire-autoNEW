/**
 * getHarnessStatus must be reachable from the words Nour really types, asserted against the real
 * pruner (assert-the-consumer: registration is not reachability). Written red first.
 */
import { describe, it, expect, vi } from "vitest";
import { pruneTools } from "@/lib/ai/chat-mode";
import { TOOL_CATALOG } from "@/lib/ai/tools/catalog";
import { TOOL_FAMILIES } from "@/lib/ai/tool-families";
import { READ_ONLY_TOOLS } from "@/lib/ai/tools/read-only-tools";

const readHarnessStatus = vi.hoisted(() => vi.fn());
vi.mock("@/lib/services/harness-status", () => ({ readHarnessStatus }));

function allTools(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const t of TOOL_CATALOG) out[(t as { name: string }).name] = {};
  return out;
}
const offeredFor = async (prompt: string) =>
  Object.keys(((await pruneTools("standard" as never, allTools(), prompt)) as Record<string, unknown>) ?? {});

describe("getHarnessStatus reach", () => {
  it("POSITIVE CONTROL: a plain task question does not pull it in", async () => {
    const offered = await offeredFor("what are my tasks today");
    expect(offered.length).toBeGreaterThan(0);
    expect(offered).not.toContain("getHarnessStatus");
  });

  it.each([
    "what's running right now?",
    "did that merge?",
    "how's the harness looking",
    "any PRs open?",
    "is NicksMax up?",
    "how much ram is free on mechanics",
    "what commit is bdnick on",
    "is the shop pc reporting",
    "is the code graph up",
    "when did the vault last export",
  ])("offered for: %s", async (prompt) => {
    expect(await offeredFor(prompt)).toContain("getHarnessStatus");
  });

  it("is registered as a read-only tool in every list", () => {
    expect(TOOL_CATALOG.some((t) => (t as { name: string }).name === "getHarnessStatus")).toBe(true);
    expect((TOOL_FAMILIES as Record<string, unknown>).getHarnessStatus).toBeTruthy();
    expect([...READ_ONLY_TOOLS]).toContain("getHarnessStatus");
  });
});

describe("getHarnessStatus execute", () => {
  const run = async () => {
    const { nourTools } = await import("@/lib/ai/tools");
    const tool = (nourTools as unknown as Record<string, { execute: (i: object) => Promise<Record<string, unknown>> }>)
      .getHarnessStatus;
    return tool.execute({});
  };

  it("a failed read says so; it never returns an empty picture", async () => {
    readHarnessStatus.mockRejectedValueOnce(new Error("database down"));
    const out = await run();
    expect(out.ok).toBe(false);
    expect(out.pcs).toBeUndefined();
  });

  it("a good read comes through whole", async () => {
    readHarnessStatus.mockResolvedValueOnce({ reporting: 1, pcs: [] });
    expect(await run()).toMatchObject({ ok: true, reporting: 1 });
  });
});
