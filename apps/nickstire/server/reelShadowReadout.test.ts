/**
 * BEHAVIOUR, not source text. Every assertion here constructs inputs and calls
 * the real function — the rule this arc learned when 7 of 46 source-text pins
 * passed against unfixed code, two of them vacuously.
 *
 * What is under test: the reel lane has paid for an independent judge verdict on
 * every about-to-publish reel since 2026-08-13 and had no reader for it. The
 * danger in writing that reader is subtle — the obvious implementation reuses
 * `shadowJudgeGate` directly, and that predicate FAILS CLOSED (no verdict means
 * block) because it guards an unattended publisher. The reel shadow lane fails
 * OPEN by design. Reuse it naively and every Ollama timeout is counted as a
 * quality blind spot, inflating the exact statistic an operator would flip a
 * live publish gate on. The first four describes exist for that one bug.
 */
import { describe, expect, it } from "vitest";
import { JUDGE_GATE_MIN_TOTAL } from "./services/igJudgeGate";
import {
  formatReelShadowReadout,
  isPublished,
  parseJudgeRow,
  parseQcRow,
  shadowJudgeEligibility,
  SHADOW_JUDGE_ROLLOUT_DATE,
  summarizeReelShadow,
  type ReelShadowJudgeRow,
} from "./services/reelShadowReadout";

const judged = (over: Partial<ReelShadowJudgeRow> & { jobId: number }): ReelShadowJudgeRow => ({
  total: 80,
  rejected: false,
  ...over,
});

describe("a judge that never answered is not a judge that said no", () => {
  it("an unusable verdict buckets as no_verdict, NOT would_block", () => {
    // shadowJudgeGate would return block:true here. That is right for the live
    // image gate and wrong for a shadow readout.
    const s = summarizeReelShadow({ judge: [judged({ jobId: 1, total: Number.NaN })] });
    expect(s.rows[0].bucket).toBe("no_verdict");
    expect(s.wouldBlock).toBe(0);
    expect(s.noVerdict).toBe(1);
  });

  it("no_verdict rows are OUTSIDE the judged denominator, so they cannot move the rate", () => {
    const withErrors = summarizeReelShadow({
      judge: [
        judged({ jobId: 1, total: 90 }),
        judged({ jobId: 2, total: 40 }),
        judged({ jobId: 3, total: Number.NaN }),
        judged({ jobId: 4, total: Number.NaN }),
      ],
    });
    expect(withErrors.judged).toBe(2);
    expect(withErrors.blindSpotRate).toBeCloseTo(0.5);

    // Same two real verdicts, no infra failures — identical rate.
    const clean = summarizeReelShadow({
      judge: [judged({ jobId: 1, total: 90 }), judged({ jobId: 2, total: 40 })],
    });
    expect(clean.blindSpotRate).toBe(withErrors.blindSpotRate);
  });

  it("the no_verdict reason says explicitly that this is not a block", () => {
    const s = summarizeReelShadow({ judge: [judged({ jobId: 1, total: Number.NaN })] });
    expect(s.rows[0].reason).toMatch(/not a block/);
  });

  it("nothing judged reports null, never a rate of zero", () => {
    // "0% blind spots" from an empty corpus is the confident-empty lie this
    // whole session has been closing.
    const s = summarizeReelShadow({ judge: [] });
    expect(s.blindSpotRate).toBeNull();
    expect(s.totals.mean).toBeNull();
    expect(s.totals.min).toBeNull();
    expect(formatReelShadowReadout(s).join("\n")).toMatch(/unknown, not a clean result/);
  });
});

describe("the block threshold is the canonical one, not a third copy", () => {
  it("uses JUDGE_GATE_MIN_TOTAL as its boundary", () => {
    // ig-dual-judge-readout.ts hardcodes its own GATE_MIN = 60. This asserts we
    // did not add a third copy that could drift: the boundary is derived from
    // the exported constant, so raising it there moves this test with it.
    const below = summarizeReelShadow({ judge: [judged({ jobId: 1, total: JUDGE_GATE_MIN_TOTAL - 1 })] });
    const at = summarizeReelShadow({ judge: [judged({ jobId: 2, total: JUDGE_GATE_MIN_TOTAL })] });
    expect(below.rows[0].bucket).toBe("would_block");
    expect(at.rows[0].bucket).toBe("clear");
  });

  it("separates a hard reject from a merely low score", () => {
    // Qualitatively different: one is "the judge refused it", the other is
    // "the judge scored it 58". A gate decision reads them differently.
    const s = summarizeReelShadow({
      judge: [
        judged({ jobId: 1, total: 85, rejected: true }),
        judged({ jobId: 2, total: 42, rejected: false }),
      ],
    });
    expect(s.wouldBlock).toBe(2);
    expect(s.hardRejects).toBe(1);
    expect(s.belowThreshold).toBe(1);
    expect(s.rows.find((r) => r.jobId === 1)?.blockKind).toBe("hard_reject");
    expect(s.rows.find((r) => r.jobId === 2)?.blockKind).toBe("below_threshold");
  });
});

describe("realized exposure counts only reels that actually went live", () => {
  it("counts a would-block reel that posted, and not one that was held", () => {
    const s = summarizeReelShadow({
      judge: [judged({ jobId: 1, total: 30 }), judged({ jobId: 2, total: 30 })],
      outcomes: [
        { jobId: 1, status: "posted", igPostId: "ig_1" },
        { jobId: 2, status: "assembled" },
      ],
    });
    expect(s.wouldBlock).toBe(2);
    expect(s.wouldBlockAndPublished).toBe(1);
  });

  it("publish_ambiguous is unknown — never counted live, never claimed dead", () => {
    // The reel lane parks a thrown publish as publish_ambiguous precisely
    // because Meta may have accepted it. Reporting that as "not posted" would
    // understate exposure; reporting it as posted would fabricate it.
    expect(isPublished({ jobId: 1, status: "publish_ambiguous" })).toBeNull();
    const s = summarizeReelShadow({
      judge: [judged({ jobId: 1, total: 30 })],
      outcomes: [{ jobId: 1, status: "publish_ambiguous" }],
    });
    expect(s.rows[0].published).toBeNull();
    expect(s.wouldBlockAndPublished).toBe(0);
  });

  it("a job with no outcome row is unknown, not unpublished", () => {
    expect(isPublished(undefined)).toBeNull();
    expect(summarizeReelShadow({ judge: [judged({ jobId: 9, total: 30 })] }).rows[0].published).toBeNull();
  });
});

describe("the coverage denominator counts only reels that COULD have been judged", () => {
  // P1 review finding on this PR, and it was right: the first version counted
  // every historically posted reel_jobs row. The judge only began on 2026-08-13
  // and only runs inside dailyReelPost, so older reels and reels published via
  // routes/adminRoutes.ts or routers/content.ts were being reported as judge
  // failures. That fabricates the very gap coverage exists to expose.
  const AP = (d: string) => `autopost-${d}`;

  it("excludes reels posted BEFORE the judge existed", () => {
    expect(shadowJudgeEligibility({ jobId: 1, status: "posted", briefId: AP("2026-08-12") }))
      .toEqual({ eligible: false, reason: "before_rollout" });
    expect(shadowJudgeEligibility({ jobId: 2, status: "posted", briefId: AP(SHADOW_JUDGE_ROLLOUT_DATE) }))
      .toEqual({ eligible: true, reason: "eligible" });
  });

  it("excludes reels published through a path the judge does not sit in", () => {
    // contentManufacturing also enqueues with source "cron" but publishes
    // elsewhere, which is exactly why briefId — not source — is the signal.
    for (const briefId of ["manual-kickoff", "campaign-abc", "reel-42", null, ""]) {
      expect(shadowJudgeEligibility({ jobId: 1, status: "posted", briefId }).reason)
        .toBe("other_publish_path");
    }
  });

  it("a reel that never posted is not a coverage gap", () => {
    expect(shadowJudgeEligibility({ jobId: 1, status: "assembled", briefId: AP("2026-08-14") }).reason)
      .toBe("not_posted");
    expect(shadowJudgeEligibility({ jobId: 2, status: "publish_ambiguous", briefId: AP("2026-08-14") }).reason)
      .toBe("not_posted");
  });

  it("coverage is computed over the eligible set and REPORTS what it excluded", () => {
    const s = summarizeReelShadow({
      judge: [judged({ jobId: 1, total: 90 })],
      outcomes: [
        { jobId: 1, status: "posted", briefId: AP("2026-08-14") }, // eligible, judged
        { jobId: 2, status: "posted", briefId: AP("2026-08-15") }, // eligible, NOT judged
        { jobId: 3, status: "posted", briefId: AP("2026-08-01") }, // pre-rollout
        { jobId: 4, status: "posted", briefId: "campaign-xyz" },   // other path
        { jobId: 5, status: "assembled", briefId: AP("2026-08-15") }, // never posted
      ],
    });
    expect(s.coverage).toEqual({
      published: 2, withVerdict: 1, withoutVerdict: 1,
      excluded: { beforeRollout: 1, otherPublishPath: 1 },
    });
  });

  it("without the eligibility filter this exact input would have lied", () => {
    // Regression guard for the review finding: 4 posted rows, 1 judged. The old
    // denominator said 3 unjudged reels; only 1 is a real gap.
    const s = summarizeReelShadow({
      judge: [judged({ jobId: 1, total: 90 })],
      outcomes: [
        { jobId: 1, status: "posted", briefId: AP("2026-08-14") },
        { jobId: 2, status: "posted", briefId: AP("2026-08-15") },
        { jobId: 3, status: "posted", briefId: AP("2026-07-20") },
        { jobId: 4, status: "posted", briefId: "operator-publish-9" },
      ],
    });
    expect(s.coverage?.withoutVerdict).toBe(1);
    expect(s.coverage?.withoutVerdict).not.toBe(3);
  });

  it("the readout names the eligibility rule and the exclusion counts", () => {
    const text = formatReelShadowReadout(
      summarizeReelShadow({
        judge: [judged({ jobId: 1, total: 90 })],
        outcomes: [
          { jobId: 1, status: "posted", briefId: AP("2026-08-14") },
          { jobId: 2, status: "posted", briefId: AP("2026-08-15") },
          { jobId: 3, status: "posted", briefId: AP("2026-07-01") },
        ],
      }),
    ).join("\n");
    expect(text).toMatch(/ELIGIBLE posted reels/);
    expect(text).toMatch(/posted before rollout \.+ 1/);
    expect(text).toMatch(/1 ELIGIBLE posted reel\(s\) carry NO verdict row at all/);
    expect(text).toMatch(/never judged/);
    // The filter must not be silent about itself.
    expect(text).toContain(SHADOW_JUDGE_ROLLOUT_DATE);
  });

  it("says so plainly when eligible coverage IS complete", () => {
    const text = formatReelShadowReadout(
      summarizeReelShadow({
        judge: [judged({ jobId: 1, total: 90 })],
        outcomes: [{ jobId: 1, status: "posted", briefId: AP("2026-08-14") }],
      }),
    ).join("\n");
    expect(text).toMatch(/that sample is complete/);
  });

  it("zero ELIGIBLE reels proves nothing — it must not read as complete", () => {
    // All excluded: an empty eligible set with 0 gaps is vacuous, not clean.
    const s = summarizeReelShadow({
      judge: [],
      outcomes: [{ jobId: 1, status: "posted", briefId: AP("2026-07-01") }],
    });
    expect(s.coverage).toMatchObject({ published: 0, withoutVerdict: 0 });
    const text = formatReelShadowReadout(s).join("\n");
    expect(text).toMatch(/proves nothing either way/);
    expect(text).not.toMatch(/sample is complete/);
  });

  it("no outcomes at all means coverage UNKNOWN, not coverage complete", () => {
    const s = summarizeReelShadow({ judge: [judged({ jobId: 1, total: 90 })] });
    expect(s.coverage).toBeNull();
    expect(formatReelShadowReadout(s).join("\n")).toMatch(/Coverage is UNKNOWN, not complete/);
  });

  it("the rollout boundary is inclusive and compared as a date, not a timestamp", () => {
    // briefId dates are immutable and lexicographically ordered, so no Date
    // parsing or timezone is involved — a deliberate choice over updatedAt.
    const on = shadowJudgeEligibility({ jobId: 1, status: "posted", briefId: AP("2026-08-13") });
    const before = shadowJudgeEligibility({ jobId: 2, status: "posted", briefId: AP("2026-08-12") });
    const after = shadowJudgeEligibility({ jobId: 3, status: "posted", briefId: AP("2026-12-31") });
    expect([on.eligible, before.eligible, after.eligible]).toEqual([true, false, true]);
  });

  it("a malformed autopost briefId is not silently treated as eligible", () => {
    for (const bad of ["autopost-", "autopost-2026-8-13", "autopost-20260813", "autopost-2026-08-13-retry"]) {
      expect(shadowJudgeEligibility({ jobId: 1, status: "posted", briefId: bad }).reason)
        .toBe("other_publish_path");
    }
  });
});

describe("QC agreement answers whether the LLM call is earning its money", () => {
  it("judgeOnly isolates blocks the free deterministic checklist cannot see", () => {
    const s = summarizeReelShadow({
      judge: [
        judged({ jobId: 1, total: 30 }), // blocked, QC also flagged
        judged({ jobId: 2, total: 30 }), // blocked, QC clean  -> judge-only
        judged({ jobId: 3, total: 90 }), // clear, QC flagged  -> qc-only
        judged({ jobId: 4, total: 90 }), // clear, QC clean
      ],
      qc: [
        { jobId: 1, passCount: 7, failCount: 2 },
        { jobId: 2, passCount: 9, failCount: 0 },
        { jobId: 3, passCount: 8, failCount: 1 },
        { jobId: 4, passCount: 9, failCount: 0 },
      ],
    });
    expect(s.qcAgreement).toEqual({ comparable: 4, bothFlagged: 1, judgeOnly: 1, qcOnly: 1 });
  });

  it("rows lacking a QC signal are excluded rather than assumed clean", () => {
    const s = summarizeReelShadow({
      judge: [judged({ jobId: 1, total: 30 }), judged({ jobId: 2, total: 30 })],
      qc: [{ jobId: 1, passCount: 9, failCount: 0 }],
    });
    expect(s.qcAgreement?.comparable).toBe(1);
    expect(s.rows.find((r) => r.jobId === 2)?.qcFailCount).toBeNull();
  });

  it("no comparable rows reports null, and the readout says so", () => {
    const s = summarizeReelShadow({ judge: [judged({ jobId: 1, total: 90 })] });
    expect(s.qcAgreement).toBeNull();
    expect(formatReelShadowReadout(s).join("\n")).toMatch(/no rows carry both signals yet/);
  });
});

describe("parsing is defensive, and defensive means unknown — not passing", () => {
  it("an unparseable value becomes a no-verdict row, never a clear one", () => {
    const row = parseJudgeRow("reel_shadow_judge_42", "{not json");
    expect(row?.jobId).toBe(42);
    expect(Number.isFinite(row?.total as number)).toBe(false);
    expect(summarizeReelShadow({ judge: [row as ReelShadowJudgeRow] }).clear).toBe(0);
  });

  it("a row missing `total` is unusable rather than scored zero", () => {
    // Scored zero would read as a hard quality failure; it is a schema gap.
    const row = parseJudgeRow("reel_shadow_judge_7", JSON.stringify({ rejected: false, at: "x" }));
    expect(Number.isFinite(row?.total as number)).toBe(false);
    expect(summarizeReelShadow({ judge: [row as ReelShadowJudgeRow] }).wouldBlock).toBe(0);
  });

  it("keys that are not this corpus are rejected, including near-misses", () => {
    expect(parseJudgeRow("reel_autopost_index", "3")).toBeNull();
    expect(parseJudgeRow("reel_shadow_judge_", "{}")).toBeNull();
    expect(parseJudgeRow("reel_shadow_judge_abc", "{}")).toBeNull();
    expect(parseQcRow("reel_shadow_judge_1", "{}")).toBeNull();
  });

  it("reads the enrichment fields the writer now stores", () => {
    const row = parseJudgeRow(
      "reel_shadow_judge_101",
      JSON.stringify({ total: 55, rejected: false, briefId: "b-9", topic: "brake pad wear", note: "generic", at: "t" }),
    );
    expect(row).toMatchObject({ jobId: 101, total: 55, briefId: "b-9", topic: "brake pad wear" });
  });

  it("parses a QC row and refuses one with no failCount", () => {
    expect(parseQcRow("reel_qc_checklist_5", JSON.stringify({ passCount: 8, failCount: 1 })))
      .toMatchObject({ jobId: 5, passCount: 8, failCount: 1 });
    expect(parseQcRow("reel_qc_checklist_5", JSON.stringify({ passCount: 8 }))).toBeNull();
  });
});

describe("a row is identifiable, which is why the enrichment exists", () => {
  it("labels by topic, falls back to briefId, then to the job id", () => {
    const s = summarizeReelShadow({
      judge: [
        judged({ jobId: 1, topic: "brake pad wear", briefId: "b-1" }),
        judged({ jobId: 2, briefId: "b-2" }),
        judged({ jobId: 3 }),
        judged({ jobId: 4, topic: "   ", briefId: "b-4" }),
      ],
    });
    expect(s.rows.map((r) => r.label)).toEqual(["brake pad wear", "b-2", "job 3", "b-4"]);
  });

  it("rows come back in job order regardless of input order", () => {
    const s = summarizeReelShadow({ judge: [judged({ jobId: 9 }), judged({ jobId: 2 }), judged({ jobId: 5 })] });
    expect(s.rows.map((r) => r.jobId)).toEqual([2, 5, 9]);
  });
});

describe("the readout discloses its own conditioning", () => {
  const text = formatReelShadowReadout(
    summarizeReelShadow({
      judge: [judged({ jobId: 1, total: 30 }), judged({ jobId: 2, total: 90 })],
      outcomes: [{ jobId: 1, status: "posted" }],
    }),
  ).join("\n");

  it("states that every row already cleared rendered-QA", () => {
    // Without this the 50% below reads as "half our reels are bad" rather than
    // "half the reels rendered-QA approved would be blocked by the judge".
    expect(text).toMatch(/ALREADY cleared the rendered-QA publish gate/);
    expect(text).toMatch(/BLIND-SPOT rate, not a/);
  });

  it("explains why no_verdict is held out", () => {
    expect(text).toMatch(/fails OPEN by design/);
  });

  it("names realized exposure as the cost of not flipping", () => {
    expect(text).toMatch(/cost of NOT flipping/);
  });

  it("reports the numbers it computed", () => {
    expect(text).toMatch(/would block \.+ 1 {2}\(50\.0%\)/);
    expect(text).toMatch(/already published while would-block \.+ 1/);
  });
});
