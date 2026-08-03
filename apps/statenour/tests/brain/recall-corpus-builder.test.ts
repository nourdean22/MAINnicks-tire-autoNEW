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
  },
}));

import { prisma } from "@/lib/prisma";
import {
  buildRealRecallCases,
  caseFromRejectedOutcome,
  caseFromClaimWarning,
  caseFromFailedToolCall,
  describeCorpus,
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

  beforeEach(() => {
    vi.clearAllMocks();
    mocked(prisma.intelligenceOutcome.findMany).mockResolvedValue([outcomeRow]);
    mocked(prisma.brainMemory.findMany).mockResolvedValue([]);
    mocked(prisma.agentTrace.findMany).mockResolvedValue([traceRow]);
  });

  it("harvests all three signals when every source is healthy", async () => {
    const r = await buildRealRecallCases();
    expect(r.degraded).toBe(false);
    expect(r.sources.every((s) => s.ok)).toBe(true);
    expect(r.cases.map((c) => c.id)).toEqual([
      expect.stringMatching(/^real-outcome-/),
      expect.stringMatching(/^real-toolfail-/),
    ]);
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
    // The tool-failure case still made it through.
    expect(r.cases.map((c) => c.id)).toEqual([expect.stringMatching(/^real-toolfail-/)]);
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
