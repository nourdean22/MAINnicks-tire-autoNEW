/**
 * Default-deny for "is this tool a read?". classifyToolEffect used to answer
 * "read" for any catalog tool that was not flagged and not in a *_write
 * category, so seven tools whose executors write (scheduleFollowUp, setOKRs,
 * queueDeepResearch, setMit, clearMit, setWeeklyTargets, runPython) counted as
 * reads in the live Retry gate, the persisted receipts and the errored-row
 * receipts. Now a tool is a read only if it is on READ_ONLY_TOOLS, and the
 * registry's name/category/flag tripwires still apply on top.
 *
 * Two questions, two lists. READ_ONLY_TOOLS answers "may this run in a read-only
 * or locked turn" (the authority gates). REPLAY_SAFE_COMPUTE_TOOLS adds the
 * tools that only compute, generate or draft, for the Retry gate alone: the
 * authority gates keep refusing runCode and its siblings by name (a decision the
 * red-team suite records as the operator's), while replaying them repeats nothing.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { TOOL_CATALOG } from "@/lib/ai/tools/catalog";
import {
  ACCEPTED_EXCEPTIONS,
  READ_ONLY_TOOLS,
  REPLAY_SAFE_COMPUTE_TOOLS,
  REVIEWED_UNFLAGGED_WRITES,
} from "@/lib/ai/tools/read-only-tools";
import { MUTATING_PREFIX, WRITE_CATEGORIES, classifyTool, isReadSafeTool, isReplaySafeTool } from "@/lib/ai/capability-registry";
import { classifyToolEffect, isSideEffecting, toReceipt } from "@/lib/ai/receipts/action-receipt";

const catalogNames = TOOL_CATALOG.map((t) => t.name);
type Meta = (typeof TOOL_CATALOG)[number];
const flagOrCategory = (t: Meta) => t.sideEffecting === true || WRITE_CATEGORIES.has(t.category);
const trippedWire = (t: Meta) => flagOrCategory(t) || MUTATING_PREFIX.test(t.name);

// Executors that write (read in 2026-10-15), plus runSimulation (a new BrainMemory
// row per run) and arsenalDeepResearch (a new BrainMemory row per fresh run).
const SEVEN_REVIEWED_WRITES = ["scheduleFollowUp", "setOKRs", "queueDeepResearch", "setMit", "clearMit", "setWeeklyTargets", "runPython"];
const OTHER_MUTATING_NAMES = ["runSimulation"];
const UNFLAGGED_WRITES_NO_WIRE = ["arsenalDeepResearch"];
// Executors that only compute, generate or draft (read 2026-10-15): they trip the name wire, not a real one.
const REVIEWED_COMPUTE = ["generateCode", "generateSQL", "runCode", "writeCreative", "draftOpportunitySms"];
const NAMED_EXCEPTIONS = ["getEmotionalState", "getTodaySchedule", "last30days", "scrapeWebPage", "getShopSnapshot", "suggestMIT"];

describe("the reviewed read-only list", () => {
  it("names only tools that exist in the catalog", () => {
    for (const [label, set] of [["read-only", READ_ONLY_TOOLS], ["replay-safe compute", REPLAY_SAFE_COMPUTE_TOOLS], ["reviewed writes", REVIEWED_UNFLAGGED_WRITES]] as const) {
      const stale = [...set].filter((n) => !catalogNames.includes(n));
      expect(stale, `${label} list names tools not in the catalog: ${stale.join(", ")}`).toEqual([]);
    }
  });

  it("lists no tool that a write tripwire (flag, write category, mutating name) catches", () => {
    const wrong = TOOL_CATALOG.filter((t) => READ_ONLY_TOOLS.has(t.name) && trippedWire(t)).map((t) => t.name);
    expect(wrong, `listed as read but tripped a write wire: ${wrong.join(", ")}`).toEqual([]);
  });

  it("CANARY: every catalog tool is explicitly classified: read-only, reviewed compute, a reviewed write, or caught by a write tripwire", () => {
    const unclassified = TOOL_CATALOG.filter(
      (t) => !READ_ONLY_TOOLS.has(t.name) && !REVIEWED_UNFLAGGED_WRITES.has(t.name) && !trippedWire(t),
    ).map((t) => t.name);
    expect(
      unclassified,
      `review the executor, then add to lib/ai/tools/read-only-tools.ts (READ_ONLY_TOOLS if it only reads, REVIEWED_UNFLAGGED_WRITES if it writes): ${unclassified.join(", ")}`,
    ).toEqual([]);
  });

  it("the seven reviewed writes, runSimulation and arsenalDeepResearch are off every safe list", () => {
    for (const name of [...SEVEN_REVIEWED_WRITES, ...OTHER_MUTATING_NAMES, ...UNFLAGGED_WRITES_NO_WIRE]) {
      expect(READ_ONLY_TOOLS.has(name), `${name} is read-only listed`).toBe(false);
      expect(REPLAY_SAFE_COMPUTE_TOOLS.has(name), `${name} is compute listed`).toBe(false);
      expect(isReplaySafeTool(name), `${name} is replay-safe`).toBe(false);
    }
  });

  it("reviewed writes that slip every tripwire are named, and nothing else is", () => {
    expect([...REVIEWED_UNFLAGGED_WRITES].sort()).toEqual([...UNFLAGGED_WRITES_NO_WIRE].sort());
    for (const name of REVIEWED_UNFLAGGED_WRITES) {
      const meta = TOOL_CATALOG.find((t) => t.name === name)!;
      expect(trippedWire(meta), `${name} is caught by a tripwire already: it needs no entry here`).toBe(false);
      expect(READ_ONLY_TOOLS.has(name), `${name} is both a reviewed write and read-only`).toBe(false);
    }
  });

  it("the tools that only compute, generate or draft are replay-safe, and still refused by the authority gates", () => {
    expect([...REPLAY_SAFE_COMPUTE_TOOLS].sort()).toEqual([...REVIEWED_COMPUTE].sort());
    for (const name of REVIEWED_COMPUTE) {
      expect(isReplaySafeTool(name), `${name} is not replay-safe`).toBe(true);
      expect(isReadSafeTool(name), `${name} must stay out of the authority read-safe set`).toBe(false);
      expect(classifyTool(name).reason).toBe("mutating_name");
    }
  });

  it("every compute entry is still needed: its name trips the wire, it is not also read-only listed, and it is not flagged or a write category", () => {
    for (const name of REPLAY_SAFE_COMPUTE_TOOLS) {
      const meta = TOOL_CATALOG.find((t) => t.name === name)!;
      expect(MUTATING_PREFIX.test(name), `${name} no longer trips the name wire: move it to READ_ONLY_TOOLS`).toBe(true);
      expect(READ_ONLY_TOOLS.has(name), `${name} is on both lists`).toBe(false);
      expect(flagOrCategory(meta), `${name} is a flagged or write-category tool: it cannot be replay-safe`).toBe(false);
    }
  });

  // The header used to say none of the listed tools writes. Six do something small
  // that a replay may repeat; they are accepted by name, with the reason, and the
  // list is not widened past them.
  it("the accepted bookkeeping exceptions are named, listed, and explained", () => {
    expect(Object.keys(ACCEPTED_EXCEPTIONS).sort()).toEqual([...NAMED_EXCEPTIONS].sort());
    for (const [name, reason] of Object.entries(ACCEPTED_EXCEPTIONS)) {
      expect(READ_ONLY_TOOLS.has(name), `${name} is an accepted exception but not on the list`).toBe(true);
      expect(reason.trim().length, `${name} has no stated reason`).toBeGreaterThan(20);
    }
    expect(ACCEPTED_EXCEPTIONS).not.toHaveProperty("arsenalDeepResearch");
  });
});

describe("classifyToolEffect answers 'read' only for the reviewed list", () => {
  it.each(SEVEN_REVIEWED_WRITES)("%s is a write", (name) => {
    expect(classifyToolEffect(name)).toBe("write");
    expect(isSideEffecting(name)).toBe(true);
    expect(isReadSafeTool(name)).toBe(false);
  });

  it.each([...OTHER_MUTATING_NAMES, ...UNFLAGGED_WRITES_NO_WIRE])("%s (it persists a row per run) is a write", (name) => {
    expect(classifyToolEffect(name)).toBe("write");
    expect(isReadSafeTool(name)).toBe(false);
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
    expect(registry.isReplaySafeTool("getShinyThing")).toBe(false);
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

  it("a name outside the catalog is never replay-safe", () => {
    expect(isReplaySafeTool("notInTheCatalog")).toBe(false);
  });

  it("reviewed reads are replay-safe too (the read-only list is a subset)", () => {
    for (const name of ["getTasks", "searchMemories", "endOfDay"]) expect(isReplaySafeTool(name), name).toBe(true);
  });

  // Even if the compute list were edited to name them, a flagged tool, a write
  // category tool and an uncatalogued name must not become replay-safe.
  it("the compute list can never vouch for a flagged, write-category or uncatalogued name", async () => {
    vi.resetModules();
    vi.doMock("@/lib/ai/tools/read-only-tools", async (importOriginal) => {
      const real = await importOriginal<typeof import("@/lib/ai/tools/read-only-tools")>();
      return { ...real, REPLAY_SAFE_COMPUTE_TOOLS: new Set([...real.REPLAY_SAFE_COMPUTE_TOOLS, "createQuickQuote", "createTask", "notInTheCatalog"]) };
    });
    const registry = await import("@/lib/ai/capability-registry");

    expect(registry.isReplaySafeTool("createQuickQuote"), "flagged").toBe(false);
    expect(registry.isReplaySafeTool("createTask"), "write category").toBe(false);
    expect(registry.isReplaySafeTool("notInTheCatalog"), "uncatalogued").toBe(false);
    // control: the genuine compute tools in the same graph are still replay-safe
    expect(registry.isReplaySafeTool("runCode")).toBe(true);
    vi.doUnmock("@/lib/ai/tools/read-only-tools");
  });
});
