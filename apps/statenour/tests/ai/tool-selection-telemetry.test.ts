/**
 * tests/ai/tool-selection-telemetry.test.ts
 *
 * THE GAP THIS CLOSES: lib/ai/tool-telemetry.ts records what happened
 * when a tool RAN. Nothing recorded which of the 181 tools were ever
 * OFFERED. pruneTools() picks <=NICK_TOOL_BUDGET (default 24) via a
 * 6-tier cascade whose tier 4 is ~40 hand-written regexes, and a miss
 * there makes a tool simply not exist for that turn -- with no trace.
 *
 * CANARY DISCIPLINE (root AGENTS.md, "Ship the canary, not just the
 * control"): a recorder that swallows its own failures is worse than no
 * recorder, because an empty table then reads as "no pruner misses"
 * rather than "the recorder is broken" -- the exact "failed read
 * rendering as a confident zero" shape the /brain audit found ten
 * times. So this file does not merely assert the happy path writes
 * rows. It BREAKS the writer and asserts the module reports itself
 * broken, and it asserts a healthy writer does NOT report broken.
 * Without that pair, a permanently-failing recorder scores green.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const createManyDecisions = vi.fn().mockResolvedValue({ count: 0 });
const updateTurn = vi.fn().mockResolvedValue({});
const upsertTurn = vi.fn().mockResolvedValue({});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    toolSelectionTurn: {
      update: (...a: unknown[]) => updateTurn(...a),
      upsert: (...a: unknown[]) => upsertTurn(...a),
    },
    toolGateDecision: {
      createMany: (...a: unknown[]) => createManyDecisions(...a),
    },
  },
}));

vi.mock("@/lib/utils/error-log", () => ({
  logError: vi.fn().mockResolvedValue(undefined),
}));

import {
  recordToolSelection,
  markSearchToolsFired,
  markInvokeToolFired,
  markForcedTool,
  noteForcedTool,
  resolveForcedTool,
  __pendingForceSize,
  getSelectionTelemetryHealth,
  __resetSelectionTelemetryHealth,
  SELECTION_TIER,
  type SelectionTurn,
} from "@/lib/ai/tool-selection-telemetry";

function turn(over: Partial<SelectionTurn> = {}): SelectionTurn {
  return {
    turnId: "turn-1",
    mode: "standard",
    candidateCount: 40,
    selectedCount: 24,
    budget: 24,
    budgetTruncated: true,
    semanticTierAttempted: true,
    embeddingCacheWarm: true,
    decisions: [
      { toolName: "getTasks", verdict: "ALLOWED", tier: SELECTION_TIER.CORE },
      {
        toolName: "analyzeFitness",
        verdict: "BUDGETED_OUT",
        tier: SELECTION_TIER.SEMANTIC,
        rank: 31,
        score: 0.41,
      },
    ],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetSelectionTelemetryHealth();
  createManyDecisions.mockResolvedValue({ count: 0 });
  updateTurn.mockResolvedValue({});
  upsertTurn.mockResolvedValue({});
});

describe("recordToolSelection", () => {
  it("writes the turn and one row per considered tool", async () => {
    await recordToolSelection(turn());

    expect(upsertTurn).toHaveBeenCalledTimes(1);
    const turnArg = upsertTurn.mock.calls[0][0] as {
      create: Record<string, unknown>;
    };
    expect(turnArg.create.turnId).toBe("turn-1");
    expect(turnArg.create.budgetTruncated).toBe(true);
    expect(turnArg.create.candidateCount).toBe(40);
    expect(turnArg.create.semanticTierAttempted).toBe(true);

    expect(createManyDecisions).toHaveBeenCalledTimes(1);
    const decArg = createManyDecisions.mock.calls[0][0] as {
      data: Array<Record<string, unknown>>;
    };
    expect(decArg.data).toHaveLength(2);
    // The dropped tool must be recorded as a VALUE, not an absence.
    expect(decArg.data[1]).toMatchObject({
      toolName: "analyzeFitness",
      verdict: "BUDGETED_OUT",
      rank: 31,
    });
  });

  it("records a cold embedding cache rather than silently selecting fewer tools", async () => {
    // Tier 5 no-ops when the cache is cold. If that is not recorded, a
    // cold lambda is indistinguishable from a genuine zero-match --
    // which is how analyzeFitness became unreachable in Jul 2026.
    await recordToolSelection(
      turn({ semanticTierAttempted: true, embeddingCacheWarm: false, selectedCount: 8, budgetTruncated: false })
    );

    const turnArg = upsertTurn.mock.calls[0][0] as {
      create: Record<string, unknown>;
    };
    expect(turnArg.create.embeddingCacheWarm).toBe(false);
    expect(turnArg.create.semanticTierAttempted).toBe(true);
    expect(turnArg.create.budgetTruncated).toBe(false);
  });

  it("skips the decisions write when nothing was considered", async () => {
    await recordToolSelection(turn({ decisions: [] }));
    expect(upsertTurn).toHaveBeenCalledTimes(1);
    expect(createManyDecisions).not.toHaveBeenCalled();
  });

  it("truncates over-long fields instead of throwing", async () => {
    await recordToolSelection(
      turn({
        mode: "x".repeat(60),
        decisions: [
          {
            toolName: "y".repeat(300),
            verdict: "NOT_FOUND",
            reason: "z".repeat(400),
          },
        ],
      })
    );

    const turnArg = upsertTurn.mock.calls[0][0] as {
      create: Record<string, string>;
    };
    expect(turnArg.create.mode.length).toBe(24);
    const decArg = createManyDecisions.mock.calls[0][0] as {
      data: Array<Record<string, string>>;
    };
    expect(decArg.data[0].toolName.length).toBe(120);
    expect(decArg.data[0].reason.length).toBe(200);
  });
});

describe("markSearchToolsFired / markInvokeToolFired", () => {
  it("records the pruner-miss signal with its query", async () => {
    await markSearchToolsFired("turn-1", "sleep data");
    expect(upsertTurn).toHaveBeenCalledWith({
      where: { turnId: "turn-1" },
      update: { searchToolsFired: true, searchToolsQuery: "sleep data" },
      create: expect.objectContaining({
        turnId: "turn-1",
        searchToolsFired: true,
        searchToolsQuery: "sleep data",
      }),
    });
  });

  it("records which dropped tool invokeTool actually ran", async () => {
    await markInvokeToolFired("turn-1", "getHabitStreaks");
    expect(upsertTurn).toHaveBeenCalledWith({
      where: { turnId: "turn-1" },
      update: { invokeToolFired: true, invokedToolName: "getHabitStreaks" },
      create: expect.objectContaining({
        turnId: "turn-1",
        invokeToolFired: true,
        invokedToolName: "getHabitStreaks",
      }),
    });
  });
});

describe("CANARY: the recorder must report its own failure", () => {
  it("does NOT report broken while writes succeed", async () => {
    await recordToolSelection(turn());
    const health = getSelectionTelemetryHealth();
    expect(health.writesAttempted).toBe(1);
    expect(health.writesFailed).toBe(0);
    // The control half: without this, a gate that always reported
    // "broken" would pass the break-test below and still be useless.
    expect(health.looksBroken).toBe(false);
  });

  it("reports broken when every write fails — an empty table must not read as zero misses", async () => {
    upsertTurn.mockRejectedValue(
      new Error('relation "tool_selection_turns" does not exist')
    );

    await recordToolSelection(turn());

    const health = getSelectionTelemetryHealth();
    expect(health.writesFailed).toBe(1);
    expect(health.looksBroken).toBe(true);
    expect(health.lastWriteError).toContain("does not exist");
    expect(health.lastWriteErrorAt).toBeTypeOf("number");
  });

  it("never throws into the request path when the table is missing", async () => {
    upsertTurn.mockRejectedValue(new Error("boom"));

    // The tables do not exist until the parked migration is applied, so
    // a throw here would break live chat on deploy.
    await expect(recordToolSelection(turn())).resolves.toBeUndefined();
    await expect(markSearchToolsFired("t", "q")).resolves.toBeUndefined();
    await expect(markInvokeToolFired("t", "n")).resolves.toBeUndefined();
  });

  it("does not report broken on a partial failure", async () => {
    upsertTurn.mockRejectedValueOnce(new Error("transient"));
    await recordToolSelection(turn());
    await recordToolSelection(turn({ turnId: "turn-2" }));

    const health = getSelectionTelemetryHealth();
    expect(health.writesAttempted).toBe(2);
    expect(health.writesFailed).toBe(1);
    // 1 of 2 failing is a blip, not a broken recorder.
    expect(health.looksBroken).toBe(false);
  });
});

describe("markForcedTool — is the toolChoice ladder actually honored?", () => {
  it("records a HONORED force with the provider and model that honored it", async () => {
    await markForcedTool("turn-1", "arsenalWebSearch", true, "ollama", "minimax-m3");
    expect(updateTurn).toHaveBeenCalledWith({
      where: { turnId: "turn-1" },
      data: {
        forcedToolName: "arsenalWebSearch",
        forcedToolHonored: true,
        provider: "ollama",
        modelId: "minimax-m3",
      },
    });
  });

  it("records a force that was IGNORED — the smoking gun", async () => {
    // build-stream-config.ts pins a tool at step 0. If the provider drops
    // tool_choice (Ollama Cloud does not list it in its OpenAI-compat
    // surface), the pin silently does nothing and the turn looks normal.
    // A run of these rows is what proves it.
    await markForcedTool("turn-2", "runPython", false, "ollama", "minimax-m3");
    const arg = updateTurn.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(arg.data.forcedToolHonored).toBe(false);
    expect(arg.data.forcedToolName).toBe("runPython");
  });

  it("omits provider/model rather than writing nulls when unknown", async () => {
    await markForcedTool("turn-3", "getTasks", true);
    const arg = updateTurn.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(arg.data.provider).toBeUndefined();
    expect(arg.data.modelId).toBeUndefined();
  });

  it("never throws into the request path", async () => {
    updateTurn.mockRejectedValue(new Error("column does not exist"));
    await expect(
      markForcedTool("t", "x", false)
    ).resolves.toBeUndefined();
    expect(getSelectionTelemetryHealth().writesFailed).toBe(1);
  });
});

describe("noteForcedTool -> resolveForcedTool (the wired path)", () => {
  it("records HONORED when the forced tool actually fired", async () => {
    noteForcedTool("trace-a", "arsenalWebSearch", "ollama", "minimax-m3");
    await resolveForcedTool("trace-a", ["getTasks", "arsenalWebSearch"]);

    expect(upsertTurn).toHaveBeenCalledTimes(1);
    const arg = upsertTurn.mock.calls[0][0] as {
      where: { turnId: string };
      update: Record<string, unknown>;
      create: Record<string, unknown>;
    };
    expect(arg.where.turnId).toBe("trace-a");
    expect(arg.update.forcedToolHonored).toBe(true);
    expect(arg.create.forcedToolHonored).toBe(true);
  });

  it("records NOT HONORED when the force was silently dropped — the smoking gun", async () => {
    // build-stream-config pins a tool at step 0. If the provider drops
    // tool_choice, the turn completes normally and looks fine. This row
    // is the only evidence.
    noteForcedTool("trace-b", "runPython", "ollama", "minimax-m3");
    await resolveForcedTool("trace-b", ["getTasks", "dailyPulse"]);

    const arg = upsertTurn.mock.calls[0][0] as {
      update: Record<string, unknown>;
    };
    expect(arg.update.forcedToolHonored).toBe(false);
    expect(arg.update.forcedToolName).toBe("runPython");
  });

  it("no-ops when no force was parked — safe to call every turn", async () => {
    await resolveForcedTool("trace-never-forced", ["getTasks"]);
    expect(upsertTurn).not.toHaveBeenCalled();
  });

  it("clears the parked intent so a replay cannot double-count", async () => {
    noteForcedTool("trace-c", "runPython");
    await resolveForcedTool("trace-c", ["runPython"]);
    expect(upsertTurn).toHaveBeenCalledTimes(1);

    await resolveForcedTool("trace-c", ["runPython"]);
    expect(upsertTurn).toHaveBeenCalledTimes(1);
  });

  it("CANARY: the pending map is bounded — an abandoned turn cannot leak", () => {
    const before = __pendingForceSize();
    for (let i = 0; i < 700; i++) {
      noteForcedTool(`leak-${i}`, "someTool");
    }
    const after = __pendingForceSize();
    // 700 parked, none resolved. Without the FIFO cap this would be 700+.
    expect(after).toBeLessThanOrEqual(500);
    expect(after).toBeGreaterThan(before);
  });

  it("ignores a force with no traceId or no tool name", async () => {
    noteForcedTool("", "runPython");
    noteForcedTool("trace-d", "");
    await resolveForcedTool("trace-d", []);
    expect(upsertTurn).not.toHaveBeenCalled();
  });

  it("never throws into the persist path", async () => {
    upsertTurn.mockRejectedValue(new Error("column does not exist"));
    noteForcedTool("trace-e", "runPython");
    await expect(resolveForcedTool("trace-e", [])).resolves.toBeUndefined();
    expect(getSelectionTelemetryHealth().writesFailed).toBe(1);
  });
});
