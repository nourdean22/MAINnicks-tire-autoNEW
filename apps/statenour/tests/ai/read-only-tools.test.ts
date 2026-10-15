/**
 * Default-deny for "is this tool a read?". classifyToolEffect used to answer
 * "read" for any catalog tool that was not flagged and not in a *_write
 * category, so seven tools whose executors write (scheduleFollowUp, setOKRs,
 * queueDeepResearch, setMit, clearMit, setWeeklyTargets, runPython) counted as
 * reads in the live Retry gate, the persisted receipts and the errored-row
 * receipts. Now a tool is a read only if it is on READ_ONLY_TOOLS, and the
 * registry's name/category/flag tripwires still apply on top.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { TOOL_CATALOG } from "@/lib/ai/tools/catalog";
import { READ_ONLY_TOOLS } from "@/lib/ai/tools/read-only-tools";
import { MUTATING_PREFIX, WRITE_CATEGORIES, classifyTool, isReadSafeTool } from "@/lib/ai/capability-registry";
import { classifyToolEffect, isSideEffecting, toReceipt } from "@/lib/ai/receipts/action-receipt";

const catalogNames = TOOL_CATALOG.map((t) => t.name);
const trippedWire = (t: (typeof TOOL_CATALOG)[number]) =>
  t.sideEffecting === true || WRITE_CATEGORIES.has(t.category) || MUTATING_PREFIX.test(t.name);

// Executors that write (read in 2026-10-15), plus the mutating-named tools the
// registry already called writes but the receipt classifier called reads.
const SEVEN_REVIEWED_WRITES = ["scheduleFollowUp", "setOKRs", "queueDeepResearch", "setMit", "clearMit", "setWeeklyTargets", "runPython"];
const OTHER_MUTATING_NAMES = ["generateCode", "generateSQL", "runCode", "writeCreative", "runSimulation", "draftOpportunitySms"];

describe("the reviewed read-only list", () => {
  it("names only tools that exist in the catalog", () => {
    const stale = [...READ_ONLY_TOOLS].filter((n) => !catalogNames.includes(n));
    expect(stale, `not in the catalog: ${stale.join(", ")}`).toEqual([]);
  });

  it("lists no tool that a write tripwire (flag, write category, mutating name) catches", () => {
    const wrong = TOOL_CATALOG.filter((t) => READ_ONLY_TOOLS.has(t.name) && trippedWire(t)).map((t) => t.name);
    expect(wrong, `listed as read but tripped a write wire: ${wrong.join(", ")}`).toEqual([]);
  });

  it("CANARY: every catalog tool is explicitly classified, listed as read-only or caught by a write tripwire", () => {
    const unclassified = TOOL_CATALOG.filter((t) => !READ_ONLY_TOOLS.has(t.name) && !trippedWire(t)).map((t) => t.name);
    expect(
      unclassified,
      `review the executor, then add to lib/ai/tools/read-only-tools.ts if it only reads: ${unclassified.join(", ")}`,
    ).toEqual([]);
  });

  it("the seven reviewed writes and the other mutating-named tools are off the list", () => {
    for (const name of [...SEVEN_REVIEWED_WRITES, ...OTHER_MUTATING_NAMES]) {
      expect(READ_ONLY_TOOLS.has(name), name).toBe(false);
    }
  });
});

describe("classifyToolEffect answers 'read' only for the reviewed list", () => {
  it.each(SEVEN_REVIEWED_WRITES)("%s is a write", (name) => {
    expect(classifyToolEffect(name)).toBe("write");
    expect(isSideEffecting(name)).toBe(true);
    expect(isReadSafeTool(name)).toBe(false);
  });

  it.each(OTHER_MUTATING_NAMES)("%s (mutating name) is a write", (name) => {
    expect(classifyToolEffect(name)).toBe("write");
  });

  it("every catalog tool is exactly read (listed) or write (not listed); none is left 'unknown'", () => {
    const wrong = catalogNames.filter((n) => classifyToolEffect(n) !== (READ_ONLY_TOOLS.has(n) ? "read" : "write"));
    expect(wrong, `classifyToolEffect disagrees with the list for: ${wrong.join(", ")}`).toEqual([]);
  });

  it("the registry and the receipt classifier give one answer for every catalog tool", () => {
    const split = catalogNames.filter((n) => isReadSafeTool(n) !== (classifyToolEffect(n) === "read"));
    expect(split, `registry and receipts disagree for: ${split.join(", ")}`).toEqual([]);
  });

  it("a persisted receipt for an unflagged write carries sideEffecting true", () => {
    expect(toReceipt({ toolName: "setMit", ok: true }).sideEffecting).toBe(true);
    expect(toReceipt({ toolName: "runPython", ok: true }).sideEffecting).toBe(true);
  });

  it("CONTROL: reviewed reads stay reads", () => {
    for (const name of ["getTasks", "searchMemories", "endOfDay", "weeklyReview", "dailyPulse", "getRevenueStats"]) {
      expect(classifyToolEffect(name), name).toBe("read");
      expect(isReadSafeTool(name), name).toBe(true);
    }
  });

  it("CONTROL: a name outside the catalog and the action-block list is still 'unknown'", () => {
    expect(classifyToolEffect("totallyMadeUpTool")).toBe("unknown");
    expect(classifyToolEffect("task.create")).toBe("write");
  });
});

describe("a tool nobody has reviewed counts as a write", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/ai/tools/catalog");
    vi.resetModules();
  });

  it("whatever its name or category: the registry says unreviewed and the receipt classifier says write", async () => {
    vi.resetModules();
    vi.doMock("@/lib/ai/tools/catalog", async (importOriginal) => {
      const real = await importOriginal<typeof import("@/lib/ai/tools/catalog")>();
      const fresh = { name: "getShinyThing", category: "personal_read" as const };
      return {
        ...real,
        TOOL_CATALOG: [...real.TOOL_CATALOG, fresh],
        getToolMeta: (n: string) => (n === fresh.name ? fresh : real.getToolMeta(n)),
      };
    });
    const registry = await import("@/lib/ai/capability-registry");
    const receipts = await import("@/lib/ai/receipts/action-receipt");

    expect(registry.classifyTool("getShinyThing")).toEqual({ readSafe: false, reason: "unreviewed" });
    expect(receipts.classifyToolEffect("getShinyThing")).toBe("write");
    // control: a reviewed read in the same module graph is still a read
    expect(receipts.classifyToolEffect("getTasks")).toBe("read");
  });

  it("the registry keeps its original reasons for tools it already caught", () => {
    expect(classifyTool("createTask").reason).toBe("write_category");
    expect(classifyTool("setMit").reason).toBe("mutating_name");
    expect(classifyTool("notInTheCatalog").reason).toBe("not_in_catalog");
    expect(classifyTool("getTasks").reason).toBe("read_safe");
  });
});
