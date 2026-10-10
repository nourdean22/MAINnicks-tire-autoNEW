/**
 * tests/services/nick-suggestions-ledger.test.ts · 2026-10-02 · census E11 fold
 *
 * The chat chips were the only daily recommendation surface with no row in
 * the outcome ledger. Pinned: every chip the operator will see is ledgered
 * (`chip: <label>`, `nick-suggestions:<kind>`, surface chat-chips) and carries
 * its row id; a late ledger leaves the id null and the chip still renders; the
 * one-task rule for the evidence taskId.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { recordShownBounded, taskFindMany } = vi.hoisted(() => ({
  recordShownBounded: vi.fn(),
  taskFindMany: vi.fn(),
}));

// Every model read in the builder fails closed to [] via its own .catch; only
// task.findMany answers: the overdue pile (3 rows) and one broken promise, so
// exactly two chips are produced — one about a pile, one about a single task.
vi.mock("@/lib/prisma", () => {
  const rejecting = () => Promise.reject(new Error("not in this test"));
  const model = () => new Proxy({}, { get: () => rejecting });
  return {
    prisma: new Proxy(
      {},
      {
        get: (_t, name) => (name === "task" ? { findMany: taskFindMany } : model()),
      },
    ),
  };
});
vi.mock("@/lib/services/outcome-ledger", () => ({ recordShownBounded }));
vi.mock("@/lib/brain/suggestion-loop", () => ({ getDismissedSuggestionIds: async () => new Set<string>() }));
vi.mock("@/lib/services/leads", () => ({ getUrgentLeads: async () => [] }));

import { buildNickSuggestions, chipLedgerSummary, chipTaskId } from "@/lib/services/nick-suggestions";

const overdue = [1, 2, 3].map((n) => ({ id: `t${n}`, title: `task ${n}`, dueDate: new Date("2026-09-01") }));
const promise = [{ id: "t9", title: "Send Sam the brake estimate", dueDate: new Date("2026-09-01"), promiseTo: "Sam" }];

beforeEach(() => {
  recordShownBounded.mockReset();
  taskFindMany.mockReset();
  // The builder reads tasks three times: DOING/stuck (none here), overdue
  // (three), and broken promises (selects promiseTo; one).
  taskFindMany.mockImplementation(async (args: { where?: { status?: unknown }; select?: { promiseTo?: unknown } }) => {
    if (args?.where?.status === "DOING") return [];
    if (args?.select?.promiseTo) return promise;
    return overdue;
  });
});

function callFor(engine: string) {
  const call = recordShownBounded.mock.calls.find((c) => c[0].sourceEngine === engine);
  if (!call) throw new Error(`no ledger call for ${engine}`);
  return call[0];
}

describe("buildNickSuggestions · ledger", () => {
  it("ledgers each visible chip and carries the row id; only a single-task chip puts a task on the evidence", async () => {
    recordShownBounded.mockResolvedValue("led-1");
    const view = await buildNickSuggestions();
    expect(view.suggestions.map((s) => s.kind).sort()).toEqual(["broken-promise", "overdue"]);
    expect(view.suggestions.every((s) => s.ledgerId === "led-1")).toBe(true);
    expect(recordShownBounded).toHaveBeenCalledTimes(2);
    expect(callFor("nick-suggestions:overdue")).toMatchObject({
      kind: "suggestion",
      summary: "chip: overdue-pile",
      shownSurface: "chat-chips",
      evidenceRefs: { suggestionId: "overdue-pile", severity: "med" },
    });
    expect(callFor("nick-suggestions:overdue").evidenceRefs).not.toHaveProperty("taskId");
    expect(callFor("nick-suggestions:broken-promise").evidenceRefs).toMatchObject({ suggestionId: "broken-promise-t9", taskId: "t9", label: expect.stringContaining("broken promise") });
    expect(callFor("nick-suggestions:overdue").evidenceRefs).toMatchObject({ label: "3 tasks overdue · stacking up" });
    expect(callFor("nick-suggestions:broken-promise").summary).toBe("chip: broken-promise-t9 · task:t9");
    // The chip carries the summary it was ledgered under, so a tap with a null
    // id can still decide the row by content (audit 2026-10-10, 06-F2).
    expect(view.suggestions.map((s) => s.ledgerSummary).sort()).toEqual(["chip: broken-promise-t9 · task:t9", "chip: overdue-pile"]);
  });

  it("a late ledger leaves the id null and the chips still render", async () => {
    recordShownBounded.mockResolvedValue(null);
    const view = await buildNickSuggestions();
    expect(view.suggestions).toHaveLength(2);
    expect(view.suggestions.every((s) => s.ledgerId === null)).toBe(true);
    expect(view.suggestions.every((s) => s.ledgerSummary.startsWith("chip: "))).toBe(true);
  });
});

describe("chip helpers", () => {
  it("the summary is the chip's stable id, so a live count in the label never mints a new row", () => {
    expect(chipLedgerSummary({ id: " overdue-pile ", kind: "overdue", sourceContext: { count: 4 } })).toBe("chip: overdue-pile");
  });

  it("a chip about ONE task names it, so `stuck on A` and `stuck on B` are different recommendations (06-F3)", () => {
    const a = chipLedgerSummary({ id: "stuck-doing", kind: "stuck-task", sourceContext: { taskIds: ["tA"] } });
    const b = chipLedgerSummary({ id: "stuck-doing", kind: "stuck-task", sourceContext: { taskIds: ["tB"] } });
    expect(a).toBe("chip: stuck-doing · task:tA");
    expect(b).not.toBe(a);
    // A pile stays one recommendation.
    expect(chipLedgerSummary({ id: "stuck-doing", kind: "stuck-task", sourceContext: { taskIds: ["tA", "tB"] } })).toBe("chip: stuck-doing");
  });

  it("the evidence task is the one task a chip is about, never a pile", () => {
    expect(chipTaskId({ kind: "broken-promise", sourceContext: { taskId: "t9" } })).toBe("t9");
    expect(chipTaskId({ kind: "broken-promise", sourceContext: { taskId: "t9", count: 1 } })).toBe("t9");
    // "N broken promises · top …" is a pile; its top task must not close it.
    expect(chipTaskId({ kind: "broken-promise", sourceContext: { taskId: "t9", count: 3 } })).toBeNull();
    expect(chipTaskId({ kind: "stuck-task", sourceContext: { taskIds: ["t1"] } })).toBe("t1");
    expect(chipTaskId({ kind: "stuck-task", sourceContext: { taskIds: ["t1", "t2"] } })).toBeNull();
    expect(chipTaskId({ kind: "overdue", sourceContext: { count: 4 } })).toBeNull();
    expect(chipTaskId({ kind: "weak-axis" })).toBeNull();
  });
});
