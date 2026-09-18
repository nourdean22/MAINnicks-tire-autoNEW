/**
 * tests/brain/recall-corpus-builder.test.ts — recall corpus V2
 * (2026-07-29): real corrections become eval cases with honest
 * provenance, and the composition report refuses to imply quality
 * while the corpus is synthetic-only.
 */

import { readFileSync } from "node:fs";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    intelligenceOutcome: { findMany: vi.fn() },
    brainMemory: { findMany: vi.fn() },
    agentTrace: { findMany: vi.fn() },
    // Fourth source (learning-loops wave 2026-08-28): noise-verdict
    // discoveries, fetched via raw SQL so the metadata-precedence rule
    // lives in the predicate. Defaults to empty in beforeEach.
    $queryRawUnsafe: vi.fn(),
  },
}));

import { prisma } from "@/lib/prisma";
import {
  buildRealRecallCases,
  caseFromRejectedOutcome,
  caseFromClaimWarning,
  caseFromFailedToolCall,
  describeCorpus,
  paraphraseVerdict,
  selectBalancedDurableFactRows,
  DURABLE_FACT_PER_CATEGORY,
} from "@/lib/brain/recall-corpus-builder";
import { SEED_CASES } from "@/lib/brain/recall-eval";

describe("caseFromRejectedOutcome", () => {
  const row = {
    id: "out_123",
    kind: "suggestion",
    sourceEngine: "rescue-scanner",
    summary: "Reschedule the alignment promo to next week",
    decision: "dismissed",
    outcomeUseful: null,
  };

  it("carries real provenance naming the source row — never synthetic-seed", () => {
    const c = caseFromRejectedOutcome(row);
    expect(c.provenance).toContain("outcome:out_123");
    expect(c.provenance).toContain("rescue-scanner");
    expect(c.provenance).not.toBe("synthetic-seed");
  });

  it("a rejected recommendation becomes an ABSTENTION case, not an invented expectation", () => {
    const c = caseFromRejectedOutcome(row);
    expect(c.kind).toBe("abstention");
    expect(c.acceptableAbstention).toBe(true);
    expect(c.relevantKeys).toEqual([]);
  });

  it("distinguishes dismissed from not-useful in the provenance trail", () => {
    expect(caseFromRejectedOutcome(row).provenance).toContain("dismissed");
    expect(
      caseFromRejectedOutcome({ ...row, decision: null, outcomeUseful: false }).provenance,
    ).toContain("marked not useful");
  });

  it("ids are slugged and stable for the same source row", () => {
    expect(caseFromRejectedOutcome(row).id).toBe(caseFromRejectedOutcome(row).id);
    expect(caseFromRejectedOutcome(row).id).toMatch(/^real-outcome-[a-z0-9-]+$/);
  });
});

describe("caseFromClaimWarning", () => {
  const row = {
    key: "sdk-fail-trace123",
    content: "SDK tool call failed · expected tools: createTask",
    metadata: {
      claims: [{ verb: "created the task", expectedTool: "createTask" }],
      textPreview: "I created the task for the alignment promo.",
    },
  };

  it("uses the operator-visible text as the query and names the unproven verb", () => {
    const c = caseFromClaimWarning(row);
    expect(c.query).toContain("I created the task");
    expect(c.provenance).toContain("created the task");
    expect(c.provenance).toContain("chat_claim_warn:sdk-fail-trace123");
  });

  it("degrades to the row content when metadata is missing — never crashes on shape drift", () => {
    const c = caseFromClaimWarning({ key: "k", content: "fallback text", metadata: null });
    expect(c.query).toBe("fallback text");
    expect(c.provenance).toContain("the claimed action");
  });
});

describe("caseFromFailedToolCall", () => {
  const row = { traceId: "trc_77", label: "createTask", errorClass: "api_timeout" };

  it("a failed tool call becomes an ABSTENTION case - nothing may assert it succeeded", () => {
    const c = caseFromFailedToolCall(row);
    expect(c.kind).toBe("abstention");
    expect(c.acceptableAbstention).toBe(true);
    expect(c.relevantKeys).toEqual([]);
  });

  it("provenance names the trace and the error class", () => {
    const c = caseFromFailedToolCall(row);
    expect(c.provenance).toContain("trace:trc_77");
    expect(c.provenance).toContain("createTask");
    expect(c.provenance).toContain("api_timeout");
    expect(c.provenance).not.toBe("synthetic-seed");
  });

  it("ADMITS the query is synthesized, since AgentTrace stores no user text", () => {
    // Overclaiming here would be the quiet kind of lie: the case would
    // read as a replay of the real turn when it is a stand-in.
    expect(caseFromFailedToolCall(row).provenance).toContain("synthesized");
  });

  it("degrades to a readable error class when errorClass is null", () => {
    expect(caseFromFailedToolCall({ ...row, errorClass: null }).provenance).toContain(
      "unknown error",
    );
  });

  it("ids are stable and slugged for the same source row", () => {
    expect(caseFromFailedToolCall(row).id).toBe(caseFromFailedToolCall(row).id);
    expect(caseFromFailedToolCall(row).id).toMatch(/^real-toolfail-[a-z0-9-]+$/);
  });
});

describe("buildRealRecallCases distinguishes a BROKEN source from an EMPTY one", () => {
  const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

  const outcomeRow = {
    id: "o1", kind: "suggestion", sourceEngine: "e",
    summary: "s", decision: "dismissed", outcomeUseful: null,
  };
  const traceRow = { traceId: "t1", label: "createTask", errorClass: "api_timeout" };

  const noiseRow = {
    id: "bm9",
    key: "blindspot_general_cafe0000cafe0000",
    category: "blind_spot",
    content: "[HIGH] general: judged noise by the operator",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocked(prisma.intelligenceOutcome.findMany).mockResolvedValue([outcomeRow]);
    mocked(prisma.brainMemory.findMany).mockResolvedValue([]);
    mocked(prisma.agentTrace.findMany).mockResolvedValue([traceRow]);
    // Fourth source (learning-loops wave): noise-verdict discoveries.
    mocked(prisma.$queryRawUnsafe).mockResolvedValue([noiseRow]);
  });

  it("harvests all four signals when every source is healthy", async () => {
    const r = await buildRealRecallCases();
    expect(r.degraded).toBe(false);
    expect(r.sources.every((s) => s.ok)).toBe(true);
    expect(r.cases.map((c) => c.id)).toEqual([
      expect.stringMatching(/^real-outcome-/),
      expect.stringMatching(/^real-toolfail-/),
      expect.stringMatching(/^real-discovery-/),
    ]);
    // The fourth source is the first LABEL-BEARING one — its case must
    // carry the judged row's key as a forbidden key, or the corpus is
    // back to being unable to fail.
    const disc = r.cases.find((c) => c.id.startsWith("real-discovery-"));
    expect(disc?.forbiddenKeys).toEqual([noiseRow.key]);
  });

  it("a THROWING source flips degraded and is named with its error", async () => {
    mocked(prisma.intelligenceOutcome.findMany).mockRejectedValue(new Error("relation missing"));
    const r = await buildRealRecallCases();

    expect(r.degraded).toBe(true);
    const failed = r.sources.find((s) => !s.ok);
    expect(failed?.source).toContain("intelligence_outcomes");
    expect(failed?.error).toContain("relation missing");
  });

  it("one dead source does not cost the corpus the others", async () => {
    mocked(prisma.intelligenceOutcome.findMany).mockRejectedValue(new Error("boom"));
    const r = await buildRealRecallCases();
    // The tool-failure and noise-discovery cases still made it through.
    expect(r.cases.map((c) => c.id)).toEqual([
      expect.stringMatching(/^real-toolfail-/),
      expect.stringMatching(/^real-discovery-/),
    ]);
  });

  it("THE FIX: a broken source and an empty table no longer look identical", async () => {
    // Before this, both paths returned [] and describeCorpus reported
    // "SYNTHETIC ONLY" either way — so a stopped flywheel read exactly
    // like a flywheel nobody had fed yet.
    mocked(prisma.agentTrace.findMany).mockResolvedValue([]);
    const empty = await buildRealRecallCases();

    mocked(prisma.agentTrace.findMany).mockRejectedValue(new Error("column gone"));
    const broken = await buildRealRecallCases();

    expect(empty.cases).toEqual(broken.cases); // identical case output...
    expect(empty.degraded).toBe(false);
    expect(broken.degraded).toBe(true); // ...but no longer identical reports
  });
});

describe("the harvest CLI cannot write to the DB it reads", () => {
  const src = readFileSync(
    new URL("../../scripts/harvest-eval-corpus.ts", import.meta.url),
    "utf8",
  );

  it.each([
    ["create", /\.create(Many)?\s*\(/],
    ["update", /\.update(Many)?\s*\(/],
    ["delete", /\.delete(Many)?\s*\(/],
    ["upsert", /\.upsert\s*\(/],
    ["raw execute", /\$executeRaw/],
  ])("contains no %s call", (_label, pattern) => {
    expect(src).not.toMatch(pattern);
  });

  it("writes only to the gitignored eval-datasets dir by default", () => {
    // Harvested cases carry real operator content; the register's WP-21
    // rule is "local no-send first".
    expect(src).toMatch(/eval-datasets\//);
  });

  it("exits non-zero when a source failed, so a stopped flywheel cannot read as healthy", () => {
    expect(src).toMatch(/degraded/);
    expect(src).toMatch(/process\.exit\(1\)/);
  });
});

describe("describeCorpus", () => {
  it("synthetic-only corpora are labeled as a smoke test, NOT a quality measure", () => {
    const d = describeCorpus(SEED_CASES);
    expect(d.real).toBe(0);
    expect(d.hasRealEvidence).toBe(false);
    expect(d.note).toContain("SYNTHETIC ONLY");
  });

  it("counts real cases and flips the evidence flag once corrections land", () => {
    const mixed = [
      ...SEED_CASES,
      caseFromRejectedOutcome({
        id: "o1",
        kind: "suggestion",
        sourceEngine: "e",
        summary: "s",
        decision: "dismissed",
        outcomeUseful: null,
      }),
    ];
    const d = describeCorpus(mixed);
    expect(d.real).toBe(1);
    expect(d.synthetic).toBe(SEED_CASES.length);
    expect(d.total).toBe(SEED_CASES.length + 1);
    expect(d.hasRealEvidence).toBe(true);
    expect(d.note).toContain("1 real case");
  });
});

/**
 * paraphraseVerdict — 2026-09-18.
 *
 * The harvest's --paraphrase arm was unrunnable (a transitive `server-only`
 * guard threw under plain tsx), and a blocked arm printed a warning and then
 * EXITED 0 — so every non-human reader saw success while the corpus it wrote
 * measured echo (query == document) instead of recall.
 *
 * These pin the rule that decides both the banner and the exit code.
 */
describe("paraphraseVerdict decides whether a precision figure is readable", () => {
  it("a plain harvest is unscorable but is NOT a failed request", () => {
    const v = paraphraseVerdict(null);
    expect(v.status).toBe("not-requested");
    expect(v.scorable).toBe(false);
    expect(v.failedRequest).toBe(false);
  });

  it("a blocked arm IS a failed request — the exit code must move", () => {
    const v = paraphraseVerdict({ rewritten: 0, failed: 4, blocked: "server-only threw" });
    expect(v.status).toBe("blocked");
    expect(v.failedRequest).toBe(true);
    expect(v.reason).toContain("server-only threw");
  });

  it("requested, eligible cases existed, zero rewritten -> failed request", () => {
    const v = paraphraseVerdict({ rewritten: 0, failed: 6 });
    expect(v.status).toBe("produced-nothing");
    expect(v.scorable).toBe(false);
    expect(v.failedRequest).toBe(true);
  });

  it("nothing eligible to rewrite is vacuous, not a failure", () => {
    // An abstention-only corpus has no positive arm to make tautological, so
    // exiting 1 here would punish a harvest that did exactly what it could.
    const v = paraphraseVerdict({ rewritten: 0, failed: 0 });
    expect(v.status).toBe("vacuous");
    expect(v.scorable).toBe(false);
    expect(v.failedRequest).toBe(false);
  });

  it("a PARTIAL rewrite is scorable — provenance separates the arms", () => {
    const v = paraphraseVerdict({ rewritten: 3, failed: 2 });
    expect(v.status).toBe("partial");
    expect(v.scorable).toBe(true);
    expect(v.failedRequest).toBe(false);
    expect(v.reason).toContain("kept verbatim");
  });

  it("every eligible case rewritten is complete and scorable", () => {
    const v = paraphraseVerdict({ rewritten: 5, failed: 0 });
    expect(v.status).toBe("complete");
    expect(v.scorable).toBe(true);
    expect(v.failedRequest).toBe(false);
  });

  /**
   * ★ THE CANARY. `scorable` and `failedRequest` are two different questions,
   * and the cheap "simplification" is to collapse them into one flag. Doing so
   * silently reintroduces one of the two original defects, depending on which
   * flag survives:
   *   - keep `scorable`      -> a plain `pnpm harvest:evals` starts exiting 1
   *   - keep `failedRequest` -> a blocked arm goes back to exiting 0
   * This asserts the BEHAVIOUR that makes them non-identical: at least one
   * input is unscorable WITHOUT being a failed request. Delete the distinction
   * and this test goes red.
   */
  it("CANARY: unscorable does not imply failed-request", () => {
    const inputs: Array<Parameters<typeof paraphraseVerdict>[0]> = [
      null,
      { rewritten: 0, failed: 0 },
      { rewritten: 0, failed: 6 },
      { rewritten: 0, failed: 4, blocked: "x" },
      { rewritten: 3, failed: 2 },
      { rewritten: 5, failed: 0 },
    ];
    const verdicts = inputs.map((i) => paraphraseVerdict(i));
    const divergent = verdicts.filter((v) => !v.scorable && !v.failedRequest);
    expect(divergent.length).toBeGreaterThan(0);
    // And the converse holds too: nothing scorable is ever a failed request.
    expect(verdicts.filter((v) => v.scorable && v.failedRequest)).toHaveLength(0);
  });

  it("CANARY: every status is reachable, so none is dead code", () => {
    const seen = new Set(
      [
        null,
        { rewritten: 0, failed: 4, blocked: "x" },
        { rewritten: 0, failed: 6 },
        { rewritten: 0, failed: 0 },
        { rewritten: 3, failed: 2 },
        { rewritten: 5, failed: 0 },
      ].map((i) => paraphraseVerdict(i).status),
    );
    expect(seen).toEqual(
      new Set(["not-requested", "blocked", "produced-nothing", "vacuous", "partial", "complete"]),
    );
  });
});

/**
 * selectBalancedDurableFactRows — 2026-09-18.
 *
 * MEASURED ON PROD: the previous sampler (`orderBy updatedAt desc, take 75`
 * across 14 curated categories) returned 75 of 75 rows from
 * `customer_preference` — the worst category in the set, 3 eligible of 283 —
 * because it is machine-churned and therefore wins on recency. 74 of those 75
 * died on the >=60-char filter and the corpus's POSITIVE ARM WAS ONE CASE,
 * against 2,412 eligible rows sitting in the other categories.
 *
 * A LIMIT applied before a diversity requirement is won by whatever churns
 * most. These pin that it cannot happen again.
 */
describe("selectBalancedDurableFactRows stops one category eating the corpus", () => {
  /** A row shaped to survive every caseFromDurableFact filter. */
  const viable = (id: string, category: string) => ({
    id,
    key: `pricing_rule_${id}`,
    category,
    content:
      "The shop keeps a hard floor on mounted tire jobs so the bays never run at a loss during the slow winter weeks.",
  });

  /** Same category, but too short to clear the >=60 character filter. */
  const tooShort = (id: string, category: string) => ({
    id,
    key: `cust_${id}`,
    category,
    content: "prefers morning drop-off",
  });

  it("caps each category at the quota", () => {
    const rows = Array.from({ length: 50 }, (_, i) => viable(`a${i}`, "insight"));
    const out = selectBalancedDurableFactRows(rows);
    expect(out).toHaveLength(DURABLE_FACT_PER_CATEGORY);
  });

  it("★ CANARY: a 100-row dominant category cannot starve a 6-row rare one", () => {
    // This is the production bug as a test. Under the old global top-N the
    // churny rows came first and the rare category contributed NOTHING.
    const rows = [
      ...Array.from({ length: 100 }, (_, i) => viable(`churn${i}`, "customer_preference")),
      ...Array.from({ length: 6 }, (_, i) => viable(`rare${i}`, "decision_log")),
    ];
    const out = selectBalancedDurableFactRows(rows);
    const byCat = new Map<string, number>();
    for (const r of out) byCat.set(r.category, (byCat.get(r.category) ?? 0) + 1);

    expect(byCat.get("customer_preference")).toBe(DURABLE_FACT_PER_CATEGORY);
    expect(byCat.get("decision_log")).toBe(6);
    // And the headline property, stated directly: no category owns the result.
    expect(out.length).toBe(DURABLE_FACT_PER_CATEGORY + 6);
  });

  it("★ CANARY: unusable rows do NOT consume the quota", () => {
    // The subtle way to reintroduce the bug: fill the quota with rows that
    // caseFromDurableFact later rejects. The category then LOOKS represented
    // and contributes zero cases — the arm starves exactly as before, but
    // silently. Six junk rows precede six good ones in the SAME category.
    const rows = [
      ...Array.from({ length: 6 }, (_, i) => tooShort(`junk${i}`, "insight")),
      ...Array.from({ length: 6 }, (_, i) => viable(`good${i}`, "insight")),
    ];
    const out = selectBalancedDurableFactRows(rows);
    expect(out).toHaveLength(6);
    expect(out.every((r) => r.id.startsWith("good"))).toBe(true);
  });

  it("preserves per-category recency order within the quota", () => {
    // Callers pass rows already ordered updatedAt desc; the balancer must not
    // reshuffle, or "a spread of CURRENT facts" stops being true.
    const rows = Array.from({ length: 20 }, (_, i) => viable(`n${i}`, "wisdom"));
    const out = selectBalancedDurableFactRows(rows);
    expect(out.map((r) => r.id)).toEqual(["n0", "n1", "n2", "n3", "n4", "n5"]);
  });

  it("an empty input yields an empty result rather than throwing", () => {
    expect(selectBalancedDurableFactRows([])).toEqual([]);
  });

  it("CONTROL: the quota is honoured for an explicitly passed value", () => {
    // Without this, a balancer that ignored its argument and always returned
    // everything would still pass the caps test above at the default.
    const rows = Array.from({ length: 10 }, (_, i) => viable(`x${i}`, "concern"));
    expect(selectBalancedDurableFactRows(rows, 2)).toHaveLength(2);
    expect(selectBalancedDurableFactRows(rows, 9)).toHaveLength(9);
  });
});
