/**
 * Q-23 phase 8 · the morning brief's Master Intelligence block wears the same
 * provenance as the admin panels: the health score is an ESTIMATE (or UNKNOWN
 * when the report says it averaged over silence), a failed churn read is
 * "unknown, not zero", and the review count is the monthly field the engine
 * actually returns.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  formatMasterBriefBlock,
  type MasterBriefInput,
} from "../cron/jobs/morningBriefMaster";

/** predictChurn returns at most 25 high-risk customers (intelligenceEngines.ts highRisk.slice(0, 25)). */
const CHURN_HIGH_RISK_CAP = 25;

function report(
  over: {
    summary?: Partial<MasterBriefInput["summary"]>;
    churnRisk?: MasterBriefInput["customers"]["churnRisk"];
    reviewVelocity?: MasterBriefInput["marketing"]["reviewVelocity"];
  } = {}
): MasterBriefInput {
  return {
    summary: {
      score: 71.6,
      scoreReliable: true,
      enginesFailed: 0,
      enginesTotal: 28,
      topAlert: "a",
      topOpportunity: "o",
      topRisk: "r",
      ...over.summary,
    },
    customers: {
      churnRisk:
        "churnRisk" in over ? over.churnRisk : { highRisk: [{}, {}, {}] },
    },
    marketing: {
      reviewVelocity:
        "reviewVelocity" in over
          ? over.reviewVelocity
          : { thisMonth: 7, lastMonth: 4 },
    },
  };
}

describe("morning brief master block provenance (Q-23 phase 8)", () => {
  it("labels a reliable health score as an ESTIMATE", () => {
    const block = formatMasterBriefBlock(report(), 12);
    expect(block).toContain(
      "BUSINESS HEALTH (ESTIMATE, modeled not measured): 72/100"
    );
  });

  it("prints UNKNOWN, not a number, when the report says the score averaged over silence", () => {
    const block = formatMasterBriefBlock(
      report({
        summary: {
          score: 50,
          scoreReliable: false,
          enginesFailed: 20,
          enginesTotal: 28,
        },
      }),
      12
    );
    expect(block).toContain(
      "BUSINESS HEALTH: UNKNOWN (20 of 28 engines failed"
    );
    expect(block).not.toMatch(/50\/100/);
  });

  it("prints churn as unknown, not zero, when the churn engine failed (settled() -> null)", () => {
    const block = formatMasterBriefBlock(report({ churnRisk: null }), 12);
    expect(block).toContain("Churn risk: unknown, not zero");
    expect(block).not.toMatch(/Churn risk: 0\b/);
  });

  it("prints a real churn count, and a floor at the engine's cap", () => {
    expect(formatMasterBriefBlock(report(), 12)).toContain("Churn risk: 3 |");
    const capped = {
      highRisk: Array.from({ length: CHURN_HIGH_RISK_CAP }, () => ({})),
    };
    expect(formatMasterBriefBlock(report({ churnRisk: capped }), 12)).toContain(
      `Churn risk: ${CHURN_HIGH_RISK_CAP}+ |`
    );
  });

  it("reads the monthly review count the engine returns, and unknown when it failed", () => {
    expect(formatMasterBriefBlock(report(), 12)).toContain(
      "Reviews this month: 7"
    );
    expect(
      formatMasterBriefBlock(report({ reviewVelocity: null }), 12)
    ).toContain("Reviews this month: unknown");
  });

  it("the cron job builds its block through this formatter, not inline", () => {
    const src = readFileSync(
      resolve(__dirname, "../cron/jobs/morningBrief.ts"),
      "utf8"
    );
    expect(src).toContain("formatMasterBriefBlock(");
    // The model that writes the Telegram brief is told to keep the wording.
    expect(src).toMatch(/BUSINESS HEALTH is a modeled ESTIMATE/);
    expect(src).toMatch(/stays unknown in the brief, never 0/);
    // The dead fields and the bare score line must not come back.
    expect(src).not.toMatch(/weeklyRate|monthlyRate/);
    expect(src).not.toMatch(/BUSINESS HEALTH: \$\{/);
    expect(src).not.toMatch(
      /churnCount\s*=\s*Array\.isArray\([^)]*\)\s*\?[^:]*:\s*0/
    );
  });
});
