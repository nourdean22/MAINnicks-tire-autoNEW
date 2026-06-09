import { describe, it, expect } from "vitest";
import {
  parseCommand,
  resolveCommand,
  runCommand,
  COMMANDS,
  type CommandDeps,
} from "@/lib/ai/chat/command-registry";

// Minimal stubbed services so commands run end-to-end without DB/fs.
const stubs: Partial<CommandDeps> = {
  changeDigest: async () => ({
    generatedAt: "now",
    latestWave: { date: "2026-06-09", title: "function wave", ships: ["a38f2d98"], verifyGate: "typecheck 0" },
    truth: { staleCriticalInKeyDocs: 0, staleWarnInKeyDocs: 2, evals: { total: 23, passed: 22, failed: 0, manual: 1 }, runbooksActive: 8, runbooksOldestVerified: "2026-06-09" },
    deployment: { sha: "abc", branch: "main", env: "production", source: "railway", status: "production", note: "ok" },
    checksAvailable: [],
    risks: [],
    nextOwnerDecision: "Nothing pending.",
  }),
  taskRescue: async () => ({
    scanned: 10,
    findings: [{ taskId: "t1", title: "Old task", issue: "stale", reason: "untouched 40d", confidence: 0.6, suggestedFix: "review it", missionTitle: "X" }],
    byIssue: { stale: 1 },
  }),
  receiptFeed: async () => ({
    items: [
      { receiptId: "r1", toolName: "task.created", category: "entity-audit", sideEffecting: true, status: "success", undoAvailable: false, userVisibleSummary: "Created task abc.", createdAt: "2026-06-09T10:00:00Z" },
      { receiptId: "r2", toolName: "send_email", category: "autonomous-action", sideEffecting: true, status: "failed", undoAvailable: false, userVisibleSummary: "FAILED send_email on quote q-9.", createdAt: "2026-06-09T09:00:00Z" },
    ],
    counts: { total: 2, success: 1, failed: 1, other: 0 },
  }),
  today: async () => ({
    date: "2026-06-09", masteryTotal: 100, masteryByDomain: {}, topMastery: { domain: "business", score: 50, delta: 3 },
    insightCount: 0, wisdomCount: 0, learnCount: 0, goalsLifted: 0, focusedMinutes: 90, tasksDone: 4, tasksOpen: 7,
  }),
};

describe("parseCommand", () => {
  it("parses a bare command", () => {
    expect(parseCommand("/rescue")).toEqual({ name: "rescue", args: "" });
  });
  it("parses a command with args", () => {
    expect(parseCommand("/import-session here is the log")).toEqual({ name: "import-session", args: "here is the log" });
  });
  it("returns null for non-commands", () => {
    expect(parseCommand("hello there")).toBeNull();
    expect(parseCommand("")).toBeNull();
  });
});

describe("resolveCommand", () => {
  it("resolves a known command", () => {
    expect(resolveCommand("/rescue").command?.name).toBe("rescue");
  });
  it("resolves an alias", () => {
    expect(resolveCommand("/changed").command?.name).toBe("what-changed");
  });
  it("returns suggestions for an unknown command", () => {
    const r = resolveCommand("/recue"); // typo
    expect(r.command).toBeNull();
    expect(r.suggestions).toContain("rescue"); // shares first letter / overlap
  });
});

describe("runCommand (end-to-end with stubbed services)", () => {
  it("runs /what-changed", async () => {
    const o = await runCommand("/what-changed", stubs);
    expect(o.handled).toBe(true);
    expect(o.command).toBe("what-changed");
    expect(o.result.text).toContain("function wave");
  });

  it("runs /rescue", async () => {
    const o = await runCommand("/rescue", stubs);
    expect(o.result.text).toContain("Old task");
  });

  it("runs /receipts with a visible failure", async () => {
    const o = await runCommand("/receipts", stubs);
    expect(o.result.text).toContain("✗");
    expect(o.result.text).toContain("FAILED");
  });

  it("runs /today with a warning line", async () => {
    const o = await runCommand("/today", stubs);
    expect(o.result.text).toContain("4 done");
    expect(o.result.text).toContain("⚠");
  });

  it("runs /import-session on pasted text (suggestion-only, no store)", async () => {
    const o = await runCommand("/import-session # Wave\\n- abc1234 fix(x): y\\nNext steps\\n- Deploy it", stubs);
    expect(o.handled).toBe(true);
    expect(o.result.text).toContain("Session:");
  });

  it("/import-session with no args prompts to paste", async () => {
    const o = await runCommand("/import-session", stubs);
    expect(o.result.text.toLowerCase()).toContain("paste");
  });

  it("falls back with suggestions on an unknown command", async () => {
    const o = await runCommand("/frobnicate", stubs);
    expect(o.handled).toBe(false);
    expect(o.result.text).toContain("Unknown command");
  });

  it("rejects non-command input", async () => {
    const o = await runCommand("just chatting", stubs);
    expect(o.handled).toBe(false);
    expect(o.result.text.toLowerCase()).toContain("not a command");
  });
});

describe("registry shape", () => {
  it("has the six expected commands with unique names", () => {
    const names = COMMANDS.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(["today", "rescue", "what-changed", "import-session", "receipts", "stale"]));
    expect(new Set(names).size).toBe(names.length);
  });
});
