/**
 * tests/services/outcome-ledger-resultref.test.ts · 2026-10-02 · full-circle wave 3 (Lane D)
 *
 * The two joins the census found missing: a bounded shown-writer for READ
 * paths (the Home brief and the Missions deck must never wait on the ledger),
 * closure by `resultRef` (a recommendation that became task:<id> is closed by
 * that task's completion rating even though its summary is not the title), and
 * the `unlabelled` count beside `undecided` so a rated-but-unclicked push is
 * not reported as "nothing known".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  create: vi.fn(),
  updateMany: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    intelligenceOutcome: {
      findFirst: (...a: unknown[]) => mocks.findFirst(...a),
      create: (...a: unknown[]) => mocks.create(...a),
      updateMany: (...a: unknown[]) => mocks.updateMany(...a),
      findMany: (...a: unknown[]) => mocks.findMany(...a),
    },
  },
}));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));

import { outcomeStats, recordOutcomeByResultRef, recordShownBounded } from "@/lib/services/outcome-ledger";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("recordShownBounded", () => {
  it("returns the row id when the ledger answers inside the bound", async () => {
    mocks.findFirst.mockResolvedValue(null);
    mocks.create.mockResolvedValue({ id: "led-1" });
    const id = await recordShownBounded(
      { kind: "suggestion", sourceEngine: "operator-brief:execute", summary: "x", shownSurface: "home" },
      500,
    );
    expect(id).toBe("led-1");
  });

  it("answers null past the bound instead of holding the page — the write still completes behind it", async () => {
    let release!: (v: null) => void;
    mocks.findFirst.mockReturnValue(new Promise<null>((r) => (release = r)));
    mocks.create.mockResolvedValue({ id: "led-late" });
    const started = Date.now();
    const id = await recordShownBounded(
      { kind: "suggestion", sourceEngine: "missions-deck:start", summary: "y", shownSurface: "missions" },
      60,
    );
    expect(id).toBeNull();
    expect(Date.now() - started).toBeLessThan(1_000);
    release(null);
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.create).toHaveBeenCalledOnce();
  });
});

describe("recordOutcomeByResultRef", () => {
  it("closes only rows that became THIS result and are still open (first write wins)", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });
    expect(await recordOutcomeByResultRef("task:t-1", true)).toBe(1);
    expect(mocks.updateMany).toHaveBeenCalledOnce();
    const arg = mocks.updateMany.mock.calls[0][0] as { where: unknown; data: Record<string, unknown> };
    // Accepted rows only: a dismissed row carrying the ref is never closed by
    // the task's rating (bug-hunt 2026-10-02).
    expect(arg.where).toEqual({ resultRef: "task:t-1", outcomeAt: null, decision: "accepted" });
    expect(arg.data.outcomeUseful).toBe(true);
    expect(arg.data.outcomeAt).toBeInstanceOf(Date);
    // A rating never writes a decision — the semantic contract.
    expect("decision" in arg.data).toBe(false);
  });

  it("an empty ref writes nothing; a database error is 0, never the caller's error", async () => {
    expect(await recordOutcomeByResultRef("  ", false)).toBe(0);
    expect(mocks.updateMany).not.toHaveBeenCalled();
    mocks.updateMany.mockRejectedValue(new Error("db down"));
    expect(await recordOutcomeByResultRef("task:t-2", false)).toBe(0);
  });
});

describe("outcomeStats · unlabelled is not undecided", () => {
  it("a rated-but-unclicked row is undecided yet labelled", async () => {
    mocks.findMany.mockResolvedValue([
      { decision: null, outcomeUseful: true }, // rated from a push, never clicked
      { decision: null, outcomeUseful: null }, // nothing known
      { decision: "accepted", outcomeUseful: null },
      { decision: "dismissed", outcomeUseful: false },
    ]);
    const s = await outcomeStats(7);
    expect(s).toMatchObject({ shown: 4, decided: 2, accepted: 1, dismissed: 1, usefulTrue: 1, usefulFalse: 1, undecided: 2, unlabelled: 1 });
  });
});
