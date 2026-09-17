/**
 * BDN-202 · tool-usage census + rewrite-candidate selection.
 *
 * Pins the MECHANISM (bucket predicates + the disclosed confound),
 * not just shapes: a tool with zero telemetry lands in neverInvoked,
 * a ≥10-call <60% tool lands in highFailure, and the caveat text that
 * makes a zero honest is part of the payload contract.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ queryRaw: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: { $queryRaw: (...a: unknown[]) => mocks.queryRaw(...a) },
}));

import { assembleToolUsageCensus, getSurfacedStats } from "@/lib/observability/tool-usage-census";
import { pickRewriteCandidates, buildRewritePrompt } from "@/lib/ai/tool-description-rewrite";
import { TOOL_CATALOG } from "@/lib/ai/tools/catalog";
import type { ToolStat } from "@/lib/ai/tool-telemetry";

const NOW = Date.UTC(2026, 7, 13);

function stat(partial: Partial<ToolStat> & { toolName: string }): ToolStat {
  return {
    totalCalls: 0,
    successRate: 1,
    avgDurationMs: 0,
    failCount: 0,
    lastCallAt: NOW,
    lastErrors: [],
    ...partial,
  };
}

describe("assembleToolUsageCensus", () => {
  it("splits catalog into neverInvoked / highFailure / stale by the stated predicates", () => {
    const names = TOOL_CATALOG.map((t) => t.name);
    const invoked = names[0];
    const failing = names[1];
    const staleTool = names[2];
    const census = assembleToolUsageCensus(
      [
        stat({ toolName: invoked, totalCalls: 5, successRate: 0.9 }),
        stat({
          toolName: failing,
          totalCalls: 20,
          successRate: 0.4,
          lastErrors: [{ message: "boom", at: NOW }],
        }),
        stat({ toolName: staleTool, totalCalls: 3, successRate: 1, lastCallAt: NOW - 40 * 86_400_000 }),
      ],
      NOW,
    );
    expect(census.catalogSize).toBe(TOOL_CATALOG.length);
    expect(census.invokedCount).toBe(3);
    expect(census.neverInvoked.length).toBe(TOOL_CATALOG.length - 3);
    expect(census.highFailure.map((r) => r.name)).toEqual([failing]);
    expect(census.highFailure[0].lastError).toBe("boom");
    expect(census.stale.map((r) => r.name)).toEqual([staleTool]);
  });

  it("does NOT flag high failure below 10 calls (one bad afternoon is not a verdict)", () => {
    const name = TOOL_CATALOG[0].name;
    const census = assembleToolUsageCensus([stat({ toolName: name, totalCalls: 9, successRate: 0 })], NOW);
    expect(census.highFailure).toEqual([]);
  });

  it("carries the pruner-confound caveat in the payload — a zero must not read as useless", () => {
    const census = assembleToolUsageCensus([], NOW);
    expect(census.caveat).toMatch(/pruner-confounded/);
    expect(census.caveat).toMatch(/never auto-delete/i);
    // With no surfacing data the resolved buckets must stay EMPTY — an
    // absent instrument must not read as a measured zero.
    expect(census.surfacedNeverChosen).toEqual([]);
    expect(census.neverSurfaced).toEqual([]);
    expect(census.surfacedWindow.turns).toBe(0);
  });

  it("splits zero-call tools into surfacedNeverChosen vs neverSurfaced when surfacing data exists", () => {
    const names = TOOL_CATALOG.map((t) => t.name);
    const invoked = names[0];
    const offeredNeverChosen = names[1];
    const offeredMoreNeverChosen = names[2];
    const census = assembleToolUsageCensus(
      [stat({ toolName: invoked, totalCalls: 5, successRate: 0.9 })],
      NOW,
      {
        windowDays: 30,
        turns: 40,
        since: NOW - 10 * 86_400_000,
        counts: new Map([
          [invoked, 40],
          [offeredNeverChosen, 12],
          [offeredMoreNeverChosen, 33],
        ]),
      },
    );
    const chosen = census.surfacedNeverChosen.map((r) => r.name);
    // Most-offered first — strongest decline evidence sorts to the top.
    expect(chosen[0]).toBe(offeredMoreNeverChosen);
    expect(chosen).toContain(offeredNeverChosen);
    // Positive control: an INVOKED tool must not leak into either zero bucket.
    expect(chosen).not.toContain(invoked);
    expect(census.neverSurfaced.map((r) => r.name)).not.toContain(invoked);
    // Rows carry the denominator-bearing count and every un-offered zero-call
    // tool lands in neverSurfaced (catalog minus invoked minus the 2 offered).
    expect(census.surfacedNeverChosen.find((r) => r.name === offeredNeverChosen)?.surfacedCount).toBe(12);
    expect(census.neverSurfaced.length).toBe(TOOL_CATALOG.length - 3);
    expect(census.surfacedWindow).toEqual({
      windowDays: 30,
      turns: 40,
      since: new Date(NOW - 10 * 86_400_000).toISOString(),
    });
    expect(census.caveat).toMatch(/40 turns/);
    expect(census.caveat).toMatch(/never auto-delete/i);
    // neverInvoked stays the backward-compatible union of both zero buckets.
    expect(census.neverInvoked.length).toBe(
      census.surfacedNeverChosen.length + census.neverSurfaced.length,
    );
  });

  it("treats a zero-turn surfacing window exactly like no surfacing data (instrument absent)", () => {
    const census = assembleToolUsageCensus([], NOW, {
      windowDays: 30,
      turns: 0,
      since: null,
      counts: new Map(),
    });
    expect(census.surfacedNeverChosen).toEqual([]);
    expect(census.neverSurfaced).toEqual([]);
    expect(census.caveat).toMatch(/pruner-confounded/);
  });
});

describe("getSurfacedStats", () => {
  beforeEach(() => {
    mocks.queryRaw.mockReset();
  });

  it("maps the per-tool rows and window meta into SurfacedStats", async () => {
    const since = new Date("2026-08-15T00:00:00Z");
    mocks.queryRaw
      .mockResolvedValueOnce([
        { tool: "getTasks", surfaced: 33 },
        { tool: "createTask", surfaced: 12 },
      ])
      .mockResolvedValueOnce([{ turns: 40, since }]);
    const stats = await getSurfacedStats(30);
    expect(stats).not.toBeNull();
    expect(stats!.windowDays).toBe(30);
    expect(stats!.turns).toBe(40);
    expect(stats!.since).toBe(since.getTime());
    expect(stats!.counts.get("getTasks")).toBe(33);
    expect(stats!.counts.get("createTask")).toBe(12);
  });

  it("returns null on query failure so the census degrades to the disclosed confound, never a false measured-zero", async () => {
    mocks.queryRaw.mockRejectedValue(new Error("relation does not exist"));
    expect(await getSurfacedStats(30)).toBeNull();
  });

  it("clamps a hostile window to [1, 365] days before it reaches SQL", async () => {
    mocks.queryRaw.mockResolvedValue([]);
    await getSurfacedStats(99999);
    // Both queries receive the clamped parameter — Prisma tags it as the
    // template value after the SQL strings.
    const args = mocks.queryRaw.mock.calls.flat(2);
    expect(JSON.stringify(args)).toContain("365");
    expect(JSON.stringify(args)).not.toContain("99999");
  });
});

describe("pickRewriteCandidates", () => {
  it("selects only ≥10-call, <60%-success tools WITH failure evidence, worst first, capped at 3", () => {
    const mk = (n: string, calls: number, rate: number, errs = 1) =>
      stat({
        toolName: n,
        totalCalls: calls,
        successRate: rate,
        lastErrors: Array.from({ length: errs }, () => ({ message: "e", at: NOW })),
      });
    const picked = pickRewriteCandidates([
      mk("a", 50, 0.1),
      mk("b", 50, 0.3),
      mk("c", 50, 0.5),
      mk("d", 50, 0.55),
      mk("healthy", 50, 0.95),
      mk("thin", 5, 0.0),
      stat({ toolName: "noEvidence", totalCalls: 50, successRate: 0.2, lastErrors: [] }),
    ]);
    expect(picked.map((p) => p.toolName)).toEqual(["a", "b", "c"]);
  });
});

describe("buildRewritePrompt", () => {
  it("includes the tool name, current description, failures, and the drafts-only rules", () => {
    const prompt = buildRewritePrompt({
      toolName: "getTasks",
      currentDescription: "Get tasks",
      failures: [{ message: "invalid status arg" }],
    });
    expect(prompt).toContain("getTasks");
    expect(prompt).toContain("Get tasks");
    expect(prompt).toContain("invalid status arg");
    expect(prompt).toMatch(/under 500 characters/);
    expect(prompt).toMatch(/ONLY the new description/);
  });
});

/**
 * `tool.chosen` gives the prune bucket a WINDOWED numerator.
 *
 * THE DEFECT THIS CLOSES. `surfacedNeverChosen` compared
 * `tool_telemetry.totalCalls` — cumulative since the table was created — against
 * a 30-day `tool.surfaced` denominator. Mixing the two made the bucket wrong in
 * both directions: a tool useful a year ago and dead today has `totalCalls > 0`
 * and never reached the prune list, while a tool surfaced 100 times this month
 * with one call from six months ago read as "invoked" and escaped it too.
 *
 * ⚠ And the fix has its own trap, which these tests pin: the `tool.chosen` lane
 * records turns whose receipts it could NOT see (`observed: false`), because the
 * alternate chat paths hand the walk no `ev.steps`. Counting those as measured
 * zeros would inflate "never chosen" — the same confound this bucket exists to
 * remove, reintroduced one layer up.
 */
describe("assembleToolUsageCensus · windowed chosen counts", () => {
  const names = TOOL_CATALOG.map((t) => t.name);
  const surfacedFor = (m: Record<string, number>, turns = 50) => ({
    windowDays: 30,
    turns,
    since: NOW - 1000,
    counts: new Map(Object.entries(m)),
  });
  const chosenFor = (m: Record<string, number>, turns = 50, blindTurns = 0) => ({
    windowDays: 30,
    turns,
    blindTurns,
    since: NOW - 1000,
    counts: new Map(Object.entries(m)),
  });

  it("CANARY: a tool with LIFETIME calls but zero in the window IS a prune candidate", () => {
    // The whole point. Before the windowed numerator this tool was invisible to
    // the prune list purely because it had been useful once.
    const dead = names[0];
    const census = assembleToolUsageCensus(
      [stat({ toolName: dead, totalCalls: 400, lastCallAt: NOW })],
      NOW,
      surfacedFor({ [dead]: 40 }),
      chosenFor({}),
    );
    expect(census.surfacedNeverChosen.map((r) => r.name)).toContain(dead);
    const row = census.surfacedNeverChosen.find((r) => r.name === dead)!;
    expect(row.totalCalls).toBe(400); // lifetime still reported, just not decisive
    expect(row.chosenCount).toBe(0);
    expect(row.surfacedCount).toBe(40);
  });

  it("POSITIVE CONTROL: a tool chosen IN the window is not a prune candidate", () => {
    // Without this, a bucket that swallowed everything would satisfy the canary.
    const alive = names[0];
    const census = assembleToolUsageCensus(
      [stat({ toolName: alive, totalCalls: 400 })],
      NOW,
      surfacedFor({ [alive]: 40 }),
      chosenFor({ [alive]: 7 }),
    );
    expect(census.surfacedNeverChosen.map((r) => r.name)).not.toContain(alive);
  });

  it("WITHOUT chosen data it behaves exactly as before, and SAYS so", () => {
    // Degrading to the lifetime numerator is acceptable; degrading silently is
    // not. The caveat has to name which numerator produced the buckets.
    const dead = names[0];
    const census = assembleToolUsageCensus(
      [stat({ toolName: dead, totalCalls: 400 })],
      NOW,
      surfacedFor({ [dead]: 40 }),
      null,
    );
    expect(census.surfacedNeverChosen.map((r) => r.name)).not.toContain(dead);
    expect(census.caveat).toMatch(/LIFETIME/);
    expect(census.caveat).toMatch(/no measured turns yet/i);
    expect(census.chosenWindow.turns).toBe(0);
    // Null means NOT MEASURED. It must never render as a zero.
    expect(census.neverInvoked.every((r) => r.chosenCount === null)).toBe(true);
  });

  it("a chosen lane with only BLIND turns counts as no data at all", () => {
    // turns=0 with blindTurns>0 is "we saw nothing", not "nothing was chosen".
    const dead = names[0];
    const census = assembleToolUsageCensus(
      [stat({ toolName: dead, totalCalls: 400 })],
      NOW,
      surfacedFor({ [dead]: 40 }),
      chosenFor({}, 0, 25),
    );
    expect(census.surfacedNeverChosen.map((r) => r.name)).not.toContain(dead);
    expect(census.caveat).toMatch(/LIFETIME/);
    expect(census.chosenWindow.blindTurns).toBe(25);
  });

  it("reports blind turns alongside measured ones when both exist", () => {
    const census = assembleToolUsageCensus([], NOW, surfacedFor({}), chosenFor({}, 40, 12));
    expect(census.chosenWindow).toMatchObject({ turns: 40, blindTurns: 12, windowDays: 30 });
    expect(census.caveat).toMatch(/12 blind turns excluded/);
    expect(census.caveat).toMatch(/WINDOWED/);
  });
});
