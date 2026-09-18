/**
 * The semantic tier must be able to WIN a slot, not just inherit leftovers.
 *
 * THE DEFECT THIS FREEZES. Selection used to be a single pass: every tier
 * called `addIfSpace`, which stopped adding at TOOL_BUDGET. Tier 5 (semantic
 * rank) ran last AND was gated on `selectedNames.size < TOOL_BUDGET`, so on any
 * turn that truncated it was skipped entirely — the turns where relevance
 * matters most were exactly the turns it never got to speak.
 *
 * Measured over 2,616 prod gate decisions after the tier-4 ordering fix:
 *
 *   · candidates p50 43 against selected p50 24
 *   · budget truncated on 80.4% of turns
 *   · semantic tier skipped on 73.2% of turns
 *   · tier 4 ALLOWED 692 / BUDGETED_OUT 925; tier 5 ALLOWED 102 / OUT 135
 *
 * A pre-emptive RESERVE for tier 5 was tried first and reverted: it allocates
 * before it knows, so it changed membership even when nothing truncated. The
 * fix is two-stage — gather every candidate, rank them together, then cut.
 *
 * WHY THE TWO TIERS ARE COMPARABLE, which the whole design rests on: tier 4
 * scores with `scoreToolsBySimilarity(embedding, …)` and tier 5 ranks with
 * `rankToolsBySimilarity(embedding, …)` — the same cosine metric against the
 * same embedding. They were never incomparable, just never compared.
 *
 * WHAT MUST STAY TRUE, asserted below rather than assumed:
 *   · no embedding or a cold cache leaves the output byte-identical
 *   · partial scoring disables ranking instead of ranking measured against
 *     unmeasured
 *   · INTENT (core, action-core, an explicitly named tool) is never displaced
 *     by a similarity score, however high
 *   · the budget still binds — including on the guaranteed tiers
 */
import { describe, it, expect, vi, afterEach } from "vitest";

const recordToolSelection = vi.fn();

let cacheWarm = true;
/** Tier-4 score overrides, keyed by tool name. */
let SCORES: Record<string, number> = {};
/**
 * How the tier-4 scorer behaves for a name with no override.
 *
 * "full" scores it WEAK, so every keyword candidate is covered. This matters
 * more than it looks: the business family is 12 catalog tools, and the first
 * version of this file hardcoded 4 of them. The 8 unscored leftovers tripped
 * the partial-coverage rule, ranking switched itself off, and the headline
 * test failed while appearing to be about tier 5. A fixture that scores only
 * some candidates tests the FALLBACK, not the fix.
 */
let SCORE_MODE: "full" | "partial" = "full";
const WEAK = 0.1;
/** Tier-5 ranked output: [name, score][]. */
let SEMANTIC: [string, number][] = [];

// Spread the REAL module — a hand-written partial mock silently drops whatever
// the implementation adds next, and the call then lands as `undefined` inside a
// try/catch, where the failure reads as "ranking chose not to apply".
vi.mock("@/lib/ai/tool-embeddings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/tool-embeddings")>();
  return {
    ...actual,
    isToolEmbeddingCacheWarm: vi.fn(() => cacheWarm),
    scoreToolsBySimilarity: vi.fn((_emb: number[], names: Iterable<string>) => {
      const out = new Map<string, number>();
      for (const n of names) {
        const s = SCORES[n];
        if (s !== undefined) out.set(n, s);
        else if (SCORE_MODE === "full") out.set(n, WEAK);
      }
      return out;
    }),
    rankToolsBySimilarity: vi.fn(() => SEMANTIC),
  };
});

vi.mock("@/lib/ai/tool-selection-telemetry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/tool-selection-telemetry")>();
  return { ...actual, recordToolSelection };
});

import { pruneTools } from "@/lib/ai/chat-mode";
import { TOOL_CATALOG } from "@/lib/ai/tools/catalog";

const EMBEDDING = [0.1, 0.2, 0.3];

/** Fires the business keyword family — the same prompt the tier-4 tests use. */
const PROMPT = "pull the invoice and revenue numbers for that customer";
/** CORE_TOOLS (7) + ACTION_CORE (2) = 9 guaranteed, leaving 3 contested slots. */
const TIGHT_BUDGET = "12";

/**
 * Two real catalog tools the business prompt does NOT match, so they can only
 * reach the turn through tier 5. Asserted present rather than assumed: if the
 * catalog is renamed, this file must fail loudly instead of quietly testing an
 * empty semantic tier and still going green.
 */
const SEMANTIC_ONLY = ["searchWebVerified", "githubRecentCommits"] as const;

function allTools(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const t of TOOL_CATALOG) out[(t as { name: string }).name] = {};
  return out;
}

let turnSeq = 0;
/**
 * Passes a turnId, WITHOUT which pruneTools skips the telemetry block entirely
 * and every assertion about semanticTierAttempted reads `undefined` — which is
 * not "false", and must not be allowed to look like it.
 */
async function offered(prompt: string, embedding?: number[]): Promise<string[]> {
  const pruned = (await pruneTools("standard" as never, allTools(), prompt, embedding, {
    turnId: `t${(turnSeq += 1)}`,
  } as never)) as Record<string, unknown>;
  return Object.keys(pruned ?? {});
}

afterEach(() => {
  delete process.env.NICK_TOOL_BUDGET;
  delete process.env.NICK_TOOL_RANK_MERGED;
  cacheWarm = true;
  SCORES = {};
  SCORE_MODE = "full";
  SEMANTIC = [];
  recordToolSelection.mockClear();
});

describe("pruneTools · two-stage ranking", () => {
  it("FIXTURE INTEGRITY: the semantic-only names are real catalog tools", () => {
    const names = new Set(TOOL_CATALOG.map((t) => (t as { name: string }).name));
    for (const n of SEMANTIC_ONLY) expect(names, `${n} must exist in the catalog`).toContain(n);
  });

  it("FIXTURE INTEGRITY: the semantic-only names are NOT tier-4 matches for this prompt", async () => {
    // With no embedding, tier 5 cannot run at all, so anything surfaced here
    // came from a keyword family. If these leaked in that way, the headline
    // test below would pass without proving anything about tier 5.
    const names = await offered(PROMPT);
    for (const n of SEMANTIC_ONLY) expect(names).not.toContain(n);
  });

  it("THE FIX: a high-scoring SEMANTIC tool beats a low-scoring KEYWORD tool for a scarce slot", async () => {
    process.env.NICK_TOOL_BUDGET = TIGHT_BUDGET;
    // Every tier-4 candidate scored, and scored WEAKLY. Full coverage matters:
    // one unscored contender disables ranking by design, which would silently
    // test the fallback and still look green for the wrong reason.
    // Every tier-4 candidate scored (SCORE_MODE "full"), and scored WEAKLY.
    SEMANTIC = [
      ["searchWebVerified", 0.95],
      ["githubRecentCommits", 0.90],
    ];

    const names = await offered(PROMPT, EMBEDDING);

    expect(names, "the semantic tier must be able to win a contested slot").toEqual(
      expect.arrayContaining(["searchWebVerified", "githubRecentCommits"]),
    );
    // Under the single pass this was impossible: tier 5 was gated on there
    // being room left, and on this turn there is none.
    expect(names.length).toBeLessThanOrEqual(Number(TIGHT_BUDGET));
  });

  it("the semantic tier is ATTEMPTED even when earlier tiers already filled the budget", async () => {
    process.env.NICK_TOOL_BUDGET = TIGHT_BUDGET;
    SCORES = { __all: 0 }; SCORE_MODE = "full";
    SEMANTIC = [["searchWebVerified", 0.1]];

    await offered(PROMPT, EMBEDDING);

    // pruneTools fires telemetry through `void import(...).then(...)` — it is
    // deliberately never awaited, so asserting straight after the call reads an
    // empty mock and looks like "the tier did not run". Wait for the write
    // instead of racing it.
    await vi.waitFor(() => expect(recordToolSelection).toHaveBeenCalled());

    const call = recordToolSelection.mock.calls.at(-1)?.[0] as
      | { semanticTierAttempted?: boolean; budgetTruncated?: boolean }
      | undefined;
    expect(call?.budgetTruncated, "this fixture must actually truncate").toBe(true);
    expect(
      call?.semanticTierAttempted,
      "attempted must mean attempted — the old guard made this false on 73.2% of turns",
    ).toBe(true);
  });

  // ── Canaries: each of these must keep TODAY's behaviour ────────────────
  it("INTENT IS NOT CONTESTED: a huge semantic score cannot displace a core tool", async () => {
    process.env.NICK_TOOL_BUDGET = TIGHT_BUDGET;
    SEMANTIC = [["searchWebVerified", 0.999]];

    const withRank = await offered(PROMPT, EMBEDDING);
    const noEmbedding = await offered(PROMPT);
    // Whatever the core tier contributed with no ranking at all must still be
    // present once ranking is switched on.
    const coreish = noEmbedding.slice(0, 9);
    for (const n of coreish) expect(withRank, `${n} is intent, not similarity`).toContain(n);
  });

  it("NO EMBEDDING leaves the surfaced set byte-identical to the single-pass order", async () => {
    process.env.NICK_TOOL_BUDGET = TIGHT_BUDGET;
    const a = await offered(PROMPT);
    SEMANTIC = [["searchWebVerified", 0.99]];
    const b = await offered(PROMPT); // still no embedding -> tier 5 cannot run
    expect(b).toEqual(a);
    expect(b).not.toContain("searchWebVerified");
  });

  it("a COLD cache ranks nothing — neither tier may contribute scores", async () => {
    process.env.NICK_TOOL_BUDGET = TIGHT_BUDGET;
    cacheWarm = false;
    SEMANTIC = [["searchWebVerified", 0.99]];
    const names = await offered(PROMPT, EMBEDDING);
    expect(names).not.toContain("searchWebVerified");
  });

  it("PARTIAL COVERAGE disables ranking rather than sorting scored against unscored", async () => {
    process.env.NICK_TOOL_BUDGET = TIGHT_BUDGET;
    // Only ONE tier-4 candidate scored. The semantic candidates carry scores,
    // so a naive merge would float them to the top; the rule is that any
    // unscored contender falls the whole pool back to arrival order.
    SCORE_MODE = "partial";
    SCORES = { queryNickstire: 0.1 };
    SEMANTIC = [["searchWebVerified", 0.99]];
    const names = await offered(PROMPT, EMBEDDING);
    expect(names).not.toContain("searchWebVerified");
  });

  it("ESCAPE HATCH: NICK_TOOL_RANK_MERGED=0 restores arrival order without a deploy", async () => {
    process.env.NICK_TOOL_BUDGET = TIGHT_BUDGET;
    process.env.NICK_TOOL_RANK_MERGED = "0";
    SEMANTIC = [["searchWebVerified", 0.99]];
    const names = await offered(PROMPT, EMBEDDING);
    expect(names, "with ranking off, tier 4 fills first exactly as it used to").not.toContain(
      "searchWebVerified",
    );
  });

  it("THE BUDGET STILL BINDS, including on the guaranteed tiers", async () => {
    process.env.NICK_TOOL_BUDGET = "10";
    SEMANTIC = [["searchWebVerified", 0.99]];
    const names = await offered(PROMPT, EMBEDDING);
    expect(names.length).toBeLessThanOrEqual(10);
  });

  it("MEMBERSHIP IS UNCHANGED when the budget does not truncate", async () => {
    // The guarantee that makes this a routing fix and not a capability change.
    process.env.NICK_TOOL_BUDGET = "500";
    SEMANTIC = [["searchWebVerified", 0.99]];
    const ranked = await offered(PROMPT, EMBEDDING);

    process.env.NICK_TOOL_RANK_MERGED = "0";
    const arrival = await offered(PROMPT, EMBEDDING);

    expect([...ranked].sort()).toEqual([...arrival].sort());
  });
});

