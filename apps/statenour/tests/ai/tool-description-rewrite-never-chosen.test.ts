/**
 * The description-rewrite cron must be able to see the problem it exists for.
 *
 * It filtered on `totalCalls >= 10`, so it could only ever consider tools the
 * model DID call. Measured 2026-09-16 on the first read of the census since
 * #2359 unblinded it: that bucket (`highFailure`) is **0**, so the cron ran
 * nightly against an empty queue — while 101 tools burned 8.4 of every turn's
 * 24 slots having never once been chosen. A never-called tool has no telemetry
 * row at all, so `getToolStats` structurally could not surface it.
 *
 * These lock the second evidence path and, more importantly, the two rules that
 * keep it honest: it declines on a thin window, and it never starves the
 * original failure queue.
 */
import { describe, it, expect } from "vitest";
import {
  pickNeverChosenCandidates,
  buildNeverChosenPrompt,
} from "@/lib/ai/tool-description-rewrite";

const row = (name: string, surfacedCount: number | null, category = "personal_read") => ({
  name,
  category,
  surfacedCount,
});

// Shaped after the real census read: getMasteryScores 266/467 (57%),
// getCommitments 229 (49%), a long tail far below the ratio floor.
const REAL_SHAPE = [
  row("getMasteryScores", 266),
  row("getHabitRevenueCorrelation", 235, "brain"),
  row("getCommitments", 229),
  row("arsenalNotebookLM", 47, "research"),
  row("getProjections", 2),
  row("neverMeasured", null),
];

describe("pickNeverChosenCandidates", () => {
  it("DECLINES on a thin window — an absent instrument is not a measured zero", () => {
    // 20 turns cannot distinguish "never chosen" from "barely observed".
    // Drafting from that would launder noise into an operator-facing artifact.
    expect(pickNeverChosenCandidates(REAL_SHAPE, 20, 3)).toEqual([]);
  });

  it("DECLINES when the failure queue already spent the budget", () => {
    // Failures are the higher-signal source; this path fills what remains and
    // must never starve it.
    expect(pickNeverChosenCandidates(REAL_SHAPE, 467, 0)).toEqual([]);
    expect(pickNeverChosenCandidates(REAL_SHAPE, 467, -1)).toEqual([]);
  });

  it("keeps only tools that cost budget on a large share of turns", () => {
    const picked = pickNeverChosenCandidates(REAL_SHAPE, 467, 10).map((c) => c.name);
    // 266/467 = 57%, 235 = 50%, 229 = 49% — all over the 20% floor.
    expect(picked).toContain("getMasteryScores");
    expect(picked).toContain("getCommitments");
    // 47/467 = 10%, 2/467 = 0.4% — real but not worth an LLM pass.
    expect(picked).not.toContain("arsenalNotebookLM");
    expect(picked).not.toContain("getProjections");
  });

  it("treats a null surfacedCount as no evidence, not as zero-cost", () => {
    // null means the surfacing lane had nothing for this tool. It must not be
    // silently coerced into 0 and then ranked as if measured.
    const picked = pickNeverChosenCandidates(REAL_SHAPE, 467, 10).map((c) => c.name);
    expect(picked).not.toContain("neverMeasured");
  });

  it("ranks by how much budget the tool actually costs", () => {
    const picked = pickNeverChosenCandidates(REAL_SHAPE, 467, 3);
    expect(picked.map((c) => c.name)).toEqual([
      "getMasteryScores",
      "getHabitRevenueCorrelation",
      "getCommitments",
    ]);
    expect(picked[0].surfacedCount).toBe(266);
    expect(picked[0].turns).toBe(467);
  });

  it("respects the per-run cap", () => {
    expect(pickNeverChosenCandidates(REAL_SHAPE, 467, 1)).toHaveLength(1);
  });
});

describe("buildNeverChosenPrompt", () => {
  const prompt = buildNeverChosenPrompt({
    toolName: "getMasteryScores",
    category: "personal_read",
    currentDescription: "Returns mastery scores.",
    surfacedCount: 266,
    turns: 467,
  });

  it("carries the denominator, not just the count", () => {
    // "offered 266 times" is meaningless without the 467 it is out of.
    expect(prompt).toContain("266");
    expect(prompt).toContain("467");
    expect(prompt).toContain("57%");
  });

  it("states the evidence is non-selection, NOT failure", () => {
    // The failure prompt's framing would be a lie here: nothing went wrong,
    // the tool was simply never picked. Asking it to fix errors that do not
    // exist invites the model to invent constraints.
    expect(prompt).toMatch(/never failed/i);
    expect(prompt).toMatch(/chosen ZERO times/i);
  });

  it("allows 'this tool is redundant' as a valid answer", () => {
    // A rewrite cannot fix a tool nobody needs. An honest verdict is more
    // useful to the reviewing operator than prettier wording.
    expect(prompt).toMatch(/redundant or superseded/i);
  });

  it("keeps the draft-only contract's length rule", () => {
    expect(prompt).toMatch(/under 500 characters/i);
  });
});

/**
 * A tool surfaced by a POLICY tier is not evidence of a description defect.
 *
 * WHAT PROD SHOWED, 2026-09-18. This cron had written six drafts in two days,
 * and three were for tools the pruner attaches to EVERY turn on purpose:
 *
 *   rankNextActions  259/259 tier 1 (core)        -> 100% policy
 *   createTask       259/259 tier 2 (action-core) -> 100% policy
 *   completeTask     259/259 tier 2               -> 100% policy
 *   findCustomer     t4=76 t3=40 t6=15            ->  11% policy
 *   getHabitRevenueCorrelation t4=124             ->   0% policy
 *   getMasteryScores t4=98 t3=40                  ->   0% policy
 *
 * For the first three, `surfacedCount / turns` is ~1.0 BY CONSTRUCTION, so the
 * 0.20 ratio gate is cleared regardless of what the description says, and the
 * prompt then tells the model "Other tools were available in the same turns and
 * won" — framing unconditional presence as competitive failure.
 *
 * The other three are genuinely keyword-surfaced and ARE legitimate candidates.
 * This file has to keep both halves: exclude the policy tools, keep the rest.
 */
describe("pickNeverChosenCandidates · policy-tier exclusion", () => {
  const TURNS = 259;
  const rows = [
    { name: "rankNextActions", category: "brain", surfacedCount: 259 },
    { name: "createTask", category: "tasks", surfacedCount: 259 },
    { name: "getMasteryScores", category: "brain", surfacedCount: 138 },
    { name: "findCustomer", category: "business", surfacedCount: 131 },
  ];
  // Measured shares, not invented.
  const share = new Map<string, number>([
    ["rankNextActions", 1.0],
    ["createTask", 1.0],
    ["getMasteryScores", 0.0],
    ["findCustomer", 0.11],
  ]);

  it("EXCLUDES a tool whose impressions are ~all POLICY tier", () => {
    const picked = pickNeverChosenCandidates(rows, TURNS, 10, share).map((c) => c.name);
    expect(picked).not.toContain("rankNextActions");
    expect(picked).not.toContain("createTask");
  });

  it("KEEPS a genuinely keyword-surfaced tool — the cron's real job", () => {
    const picked = pickNeverChosenCandidates(rows, TURNS, 10, share).map((c) => c.name);
    expect(picked).toContain("getMasteryScores");
    // 11% policy. I first mislabelled this one as tier-6 by reading it out of
    // the defaults array in chat-mode.ts; measured, it is a real candidate.
    expect(picked).toContain("findCustomer");
  });

  it("treats an UNKNOWN tool as NOT policy — absent data must not change behaviour", () => {
    const partial = new Map<string, number>([["rankNextActions", 1.0]]);
    const picked = pickNeverChosenCandidates(rows, TURNS, 10, partial).map((c) => c.name);
    expect(picked).not.toContain("rankNextActions");
    expect(picked).toContain("createTask"); // no entry -> unknown -> kept
  });

  it("BACKWARD COMPATIBLE: omitting the map reproduces the old behaviour exactly", () => {
    const withMap = pickNeverChosenCandidates(rows, TURNS, 10, new Map()).map((c) => c.name);
    const without = pickNeverChosenCandidates(rows, TURNS, 10).map((c) => c.name);
    expect(without).toEqual(withMap);
    expect(without).toContain("rankNextActions"); // the pre-fix outcome
  });

  it("still declines on a thin window, exclusion or not", () => {
    expect(pickNeverChosenCandidates(rows, 10, 10, share)).toEqual([]);
  });
});
