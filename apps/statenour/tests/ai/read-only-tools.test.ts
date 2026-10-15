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
import { canClaimDone, classifyToolEffect, isSideEffecting, receiptsWithReadBack, toReceipt } from "@/lib/ai/receipts/action-receipt";

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

  // Reading last30days.py: topic "setup" runs the setup wizard, which writes the tool's config
  // file on the server. A reason that says only "installs" understates it.
  it("last30days's reason says what its 'setup' topic does: installs software AND writes a config file", () => {
    expect(ACCEPTED_EXCEPTIONS.last30days).toMatch(/installs software/i);
    expect(ACCEPTED_EXCEPTIONS.last30days).toMatch(/config file/i);
  });
});

describe("the Retry gate's question is default-deny: would a replay repeat anything?", () => {
  it.each([...SEVEN_REVIEWED_WRITES, ...OTHER_MUTATING_NAMES, ...UNFLAGGED_WRITES_NO_WIRE])("%s is not replay-safe", (name) => {
    expect(isReplaySafeTool(name)).toBe(false);
    expect(isReadSafeTool(name)).toBe(false);
  });

  it("every catalog tool is replay-safe exactly when it is read-only listed or compute-only listed", () => {
    const wrong = catalogNames.filter((n) => isReplaySafeTool(n) !== (READ_ONLY_TOOLS.has(n) || REPLAY_SAFE_COMPUTE_TOOLS.has(n)));
    expect(wrong, `isReplaySafeTool disagrees with the lists for: ${wrong.join(", ")}`).toEqual([]);
  });

  it("CONTROL: reviewed reads and compute tools are replay-safe", () => {
    for (const name of ["getTasks", "searchMemories", "endOfDay", "weeklyReview", "dailyPulse", "getRevenueStats", ...REVIEWED_COMPUTE]) {
      expect(isReplaySafeTool(name), name).toBe(true);
    }
  });
});

// The Done-guard (canClaimDone and the "claimed action(s) ... but tool call(s)
// failed" banner) asks a different question: did a known write fail? It must not
// inherit the Retry gate's default-deny, or a failed call to a compute tool, or to
// a tool nobody has reviewed yet, prepends a false banner to a reply that claimed
// nothing. classifyToolEffect keeps its narrow meaning (flag, *_write category,
// action-block mutation) and so do the receipts built on it.
describe("the Done-guard keeps its narrow classifier", () => {
  it.each(["createTask", "completeTask", "createQuickQuote", "task.create"])("%s is a write", (name) => {
    expect(classifyToolEffect(name)).toBe("write");
    expect(isSideEffecting(name)).toBe(true);
  });

  it.each([...REVIEWED_COMPUTE, "getTasks", "searchMemories"])("%s is a read: a failed call raises no banner", (name) => {
    expect(classifyToolEffect(name)).toBe("read");
    const verdict = canClaimDone([toReceipt({ toolName: name, ok: false, error: "boom" })]);
    expect(verdict.ok, `a failed ${name} made the Done-guard object`).toBe(true);
  });

  it("CONTROL: a failed known write still makes the Done-guard object", () => {
    expect(canClaimDone([toReceipt({ toolName: "createTask", ok: false, error: "boom" })]).ok).toBe(false);
  });

  it("runCode fails, then succeeds; the reply claims nothing: no offender, so no banner", () => {
    const receipts = receiptsWithReadBack(
      [
        { name: "runCode", ok: false },
        { name: "runCode", ok: true },
      ],
      [{ verified: null }, { verified: null }],
    );
    expect(canClaimDone(receipts).ok).toBe(true);
  });

  it("CONTROL: a name outside the catalog and the action-block list is still 'unknown'", () => {
    expect(classifyToolEffect("totallyMadeUpTool")).toBe("unknown");
  });
});

describe("a tool nobody has reviewed counts as a write", () => {
  // Both mocks are dropped here, not at the end of a test body: a failing assertion above the
  // inline doUnmock used to leave the mock registered for every test after it.
  afterEach(() => {
    vi.doUnmock("@/lib/ai/tools/catalog");
    vi.doUnmock("@/lib/ai/tools/read-only-tools");
    vi.resetModules();
  });

  it("whatever its name or category: the registry says unreviewed, the Retry gate says not replay-safe, and the Done-guard does NOT call it a write", async () => {
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
    // Decoupled: a failed call to a tool nobody has reviewed yet must not prepend a false banner.
    expect(receipts.classifyToolEffect("getShinyThing")).toBe("read");
    expect(receipts.canClaimDone([receipts.toReceipt({ toolName: "getShinyThing", ok: false, error: "boom" })]).ok).toBe(true);
    // control: a reviewed read in the same module graph is still replay-safe
    expect(registry.isReplaySafeTool("getTasks")).toBe(true);
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
  });
});
