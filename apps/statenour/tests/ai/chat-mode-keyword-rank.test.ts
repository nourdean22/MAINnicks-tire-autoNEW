/**
 * When the tool budget truncates, it must cut the LEAST RELEVANT candidates —
 * not the alphabetically-last ones.
 *
 * THE DEFECT THIS FREEZES. Tier 4 ordered its candidates with
 * `Array.from(keywordMatches).sort()`. That looks like a determinism device
 * and is one, but `addIfSpace` stops adding at TOOL_BUDGET, so the list order
 * IS the selection policy for everything past the last slot. Tier 5 (semantic
 * rank) could not compensate: it is gated on `selectedNames.size < TOOL_BUDGET`
 * and so is skipped on precisely the turns that truncate.
 *
 * Measured on production 2026-09-16 — 192 recorded turns, 5,227 gate decisions:
 *
 *   · 140/192 turns (72.9%) hit the budget cliff
 *   · 135/192 turns (70.3%) skipped the semantic tier entirely
 *   · tier-4 ALLOWED names averaged first-letter index 5.28 ("f")
 *   · tier-4 BUDGETED_OUT names averaged 11.78 ("l")
 *   · 65.3% of tier-4 ALLOWED impressions went to NEVER-CHOSEN tools
 *
 * A 6.5-letter gap across 5,227 decisions is not relevance that happens to
 * correlate with spelling. `searchWebVerified` was cut 52 times and
 * `githubRecentCommits` 53 times, and both then had to be clawed back through
 * the searchTools/invokeTool recovery lane at the cost of an extra generation
 * step — 5 of 13 recorded recoveries were for a web-search tool the keyword
 * family had ALREADY matched and truncation had dropped.
 *
 * WHAT MUST STAY TRUE. Ordering changed; membership did not. With no embedding
 * or a cold cache the surfaced set is byte-identical to the alphabetical
 * behaviour this replaced — that is asserted below, not assumed, because a
 * ranking change that silently altered WHICH tools are reachable would be a
 * capability change wearing a performance-fix disguise.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

const recordToolSelection = vi.fn();

// Spread the REAL module. A hand-written partial mock silently drops whatever
// the implementation adds next, and the call lands as `undefined` inside a
// try/catch — the failure then looks like "ranking chose not to apply".
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
      }
      return out;
    }),
  };
});

vi.mock("@/lib/ai/tool-selection-telemetry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/tool-selection-telemetry")>();
  return { ...actual, recordToolSelection };
});

import { pruneTools, orderKeywordCandidates } from "@/lib/ai/chat-mode";
import { TOOL_CATALOG } from "@/lib/ai/tools/catalog";

let cacheWarm = true;
/** Deliberately INVERTED against the alphabet: the best tools sort last. */
let SCORES: Record<string, number> = {};

const EMBEDDING = [0.1, 0.2, 0.3];

function allTools(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const t of TOOL_CATALOG) out[(t as { name: string }).name] = {};
  return out;
}

async function offered(prompt: string, embedding?: number[]): Promise<string[]> {
  const pruned = (await pruneTools("standard" as never, allTools(), prompt, embedding)) as Record<
    string,
    unknown
  >;
  return Object.keys(pruned ?? {});
}

afterEach(() => {
  delete process.env.NICK_TOOL_BUDGET;
  cacheWarm = true;
  SCORES = {};
  recordToolSelection.mockClear();
});

describe("orderKeywordCandidates · the pure ordering policy", () => {
  const NAMES = ["alpha", "bravo", "charlie", "zulu"];

  it("POSITIVE CONTROL: the function is capable of reordering at all", () => {
    // Without this, every assertion below could pass against a function that
    // returns its input untouched.
    const out = orderKeywordCandidates(NAMES, new Map([["zulu", 0.9], ["alpha", 0.1]]));
    expect(out).not.toEqual([...NAMES].sort());
    expect(out[0]).toBe("zulu");
  });

  it("falls back to alphabetical with no scores — the prior behaviour, preserved", () => {
    expect(orderKeywordCandidates(NAMES, null)).toEqual(["alpha", "bravo", "charlie", "zulu"]);
  });

  it("treats an EMPTY score map as no information, not as all-zero scores", () => {
    // An empty map means the cache had nothing to say. Scoring every tool 0
    // would be a claim; falling back is an admission.
    expect(orderKeywordCandidates(NAMES, new Map())).toEqual(["alpha", "bravo", "charlie", "zulu"]);
  });

  it("orders by score descending", () => {
    const out = orderKeywordCandidates(NAMES, new Map([
      ["alpha", 0.2], ["bravo", 0.9], ["charlie", 0.5], ["zulu", 0.7],
    ]));
    expect(out).toEqual(["bravo", "zulu", "charlie", "alpha"]);
  });

  it("sorts UNSCORED names last, alphabetically among themselves", () => {
    // A tool missing from the cache is unmeasured, not dissimilar. It must not
    // outrank a tool with a real (even weak) score, and the order among
    // unmeasured tools must stay deterministic.
    const out = orderKeywordCandidates(["zulu", "alpha", "mike"], new Map([["zulu", 0.01]]));
    expect(out).toEqual(["zulu", "alpha", "mike"]);
  });

  it("breaks score ties alphabetically — output must be deterministic", () => {
    const tie = new Map([["charlie", 0.5], ["alpha", 0.5], ["bravo", 0.5]]);
    expect(orderKeywordCandidates(["charlie", "alpha", "bravo"], tie)).toEqual([
      "alpha", "bravo", "charlie",
    ]);
    // Same input, same answer, twice — a Map-iteration-order dependency would
    // show up here and nowhere else.
    expect(orderKeywordCandidates(["bravo", "charlie", "alpha"], tie)).toEqual([
      "alpha", "bravo", "charlie",
    ]);
  });
});

/**
 * The real selector, not a mirror of it. These assert against `pruneTools`
 * itself so that narrowing the tier-4 ordering shows up as a failure here.
 */
describe("pruneTools · relevance survives the budget cliff", () => {
  // Fires the business family only (12 real catalog tools), so the cliff is
  // deterministic without depending on how large the catalog grows.
  const PROMPT = "pull the invoice and revenue numbers for that customer";
  // CORE_TOOLS (7) + ACTION_CORE (2) = 9 guaranteed, leaving 3 tier-4 slots.
  const TIGHT_BUDGET = "12";

  it("baseline: with NO embedding the cut is alphabetical — the old behaviour", async () => {
    process.env.NICK_TOOL_BUDGET = TIGHT_BUDGET;
    const names = await offered(PROMPT);
    expect(names).toContain("arsenalFindLeads"); // first alphabetically
    expect(names).not.toContain("triageStaleLead"); // last alphabetically
  });

  it("THE FIX: a high-scoring late-alphabet tool survives; a low-scoring early one is cut", async () => {
    process.env.NICK_TOOL_BUDGET = TIGHT_BUDGET;
    SCORES = {
      triageStaleLead: 0.95,
      stageCustomerAlert: 0.92,
      queryNickstire: 0.9,
      arsenalFindLeads: 0.05,
      compareLiveRevenue: 0.04,
      createQuickQuote: 0.03,
    };
    const names = await offered(PROMPT, EMBEDDING);

    expect(names, "the three most relevant tools must survive truncation").toEqual(
      expect.arrayContaining(["triageStaleLead", "stageCustomerAlert", "queryNickstire"]),
    );
    expect(names, "alphabetical-but-irrelevant tools must lose their slots").not.toContain(
      "arsenalFindLeads",
    );
  });

  it("a COLD cache falls back to alphabetical rather than ranking on partial data", async () => {
    process.env.NICK_TOOL_BUDGET = TIGHT_BUDGET;
    cacheWarm = false;
    SCORES = { triageStaleLead: 0.99 };
    const names = await offered(PROMPT, EMBEDDING);
    expect(names).toContain("arsenalFindLeads");
    expect(names).not.toContain("triageStaleLead");
  });

  it("MEMBERSHIP IS UNCHANGED when the budget does not truncate", async () => {
    // The guarantee that makes this a performance fix and not a capability
    // change: ranking may reorder, but it may never add or remove a tool.
    SCORES = { triageStaleLead: 0.99, arsenalFindLeads: 0.01 };
    const ranked = await offered(PROMPT, EMBEDDING);
    const plain = await offered(PROMPT);
    expect([...ranked].sort()).toEqual([...plain].sort());
  });

  it("records the tier-4 rank and score, so the cliff is measurable afterwards", async () => {
    // `rank`/`score` existed on GateDecision since the table shipped and
    // nothing ever wrote them. A column with no producer reports nothing, and
    // the production diagnosis above had to be reconstructed from first
    // letters because of it.
    process.env.NICK_TOOL_BUDGET = TIGHT_BUDGET;
    // Score the whole family, not just two members. With a partial score map
    // the UNSCORED tools sort last by design, so a weakly-scored tool still
    // wins a slot — correct behaviour, but it would not exercise a cut here.
    SCORES = {
      triageStaleLead: 0.95,
      stageCustomerAlert: 0.92,
      queryNickstire: 0.9,
      arsenalFindLeads: 0.05,
      compareLiveRevenue: 0.04,
      createQuickQuote: 0.03,
      findCustomer: 0.02,
      getEstimateLeaks: 0.02,
      getHabitRevenueCorrelation: 0.01,
      getPendingRevenueMoves: 0.01,
      getRevenueStats: 0.01,
      getShopSnapshot: 0.01,
    };
    await pruneTools("standard" as never, allTools(), PROMPT, EMBEDDING, {
      turnId: "t-rank-1",
    } as never);
    await vi.waitFor(() => expect(recordToolSelection).toHaveBeenCalled());

    const turn = recordToolSelection.mock.calls[0][0];
    const byName = new Map(turn.decisions.map((d: { toolName: string }) => [d.toolName, d]));

    const kept = byName.get("triageStaleLead") as { rank?: number; score?: number; verdict: string };
    expect(kept.verdict).toBe("ALLOWED");
    expect(kept.rank).toBe(0);
    expect(kept.score).toBeCloseTo(0.95);

    const cut = byName.get("arsenalFindLeads") as { rank?: number; verdict: string };
    expect(cut.verdict).toBe("BUDGETED_OUT");
    // How far past the cliff it sat — "just missed" vs "never close".
    expect(cut.rank).toBeGreaterThan(0);
  });
});
