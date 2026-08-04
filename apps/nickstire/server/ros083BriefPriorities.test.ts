/**
 * ROS-083 · the last site, and the only one that is not a rendered number.
 *
 * The morning brief's TOP DECISIONS block used to be left as "" whenever the
 * opportunity queue came back empty, collapsing three different states into
 * one: the queue was read and is genuinely clear · the queue could not be
 * consulted (no database handle, or migration 0099 unapplied so
 * revenue_opportunities does not exist) · the read threw.
 *
 * The consequence is specific to this site being a PROMPT rather than a card.
 * An absent block does not read as "nothing to decide" to the model — the
 * FORMAT RULES mandate a "Top 3 priorities" section, so with no block the LLM
 * writes the operator's priorities for the day FROM SCRATCH, out of whatever
 * else is in the data blob, and Telegram delivers them every morning looking
 * exactly like a queue-backed list.
 *
 * Two things are asserted, because the fix has two halves and the prompt half
 * is the one most likely to be quietly tidied away by a later editor:
 *   1. the block always says which of the three states produced it, and
 *   2. the system prompt still tells the model what to do with each.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildDecisionsBlock, DECISIONS_UNAVAILABLE_READ_FAILED } from "./cron/jobs/morningBrief";

const BRIEF = readFileSync(join(__dirname, "cron", "jobs", "morningBrief.ts"), "utf8");

const decision = {
  urgency: "critical",
  recommendedAction: "Call Maria about the declined brake estimate",
  reason: "declined 9 days ago, no follow-up",
  dataQuality: "verified",
  attempts: 0,
  factors: { valueDollars: 840 },
};

describe("an unconsultable queue never renders as a quiet one", () => {
  it("says UNAVAILABLE when the queue could not be consulted at all", () => {
    const block = buildDecisionsBlock({
      decisions: [], excludedNoConsent: 0, excludedSnoozed: 0, totalLive: 0, queryable: false,
    });
    expect(block).toMatch(/UNAVAILABLE/);
    expect(block).toMatch(/NOT the same as an empty queue/);
    expect(block).not.toBe("");
  });

  it("says UNAVAILABLE — and distinguishes a throw from an unqueryable table", () => {
    expect(DECISIONS_UNAVAILABLE_READ_FAILED).toMatch(/UNAVAILABLE/);
    expect(DECISIONS_UNAVAILABLE_READ_FAILED).toMatch(/FAILED/);
    expect(DECISIONS_UNAVAILABLE_READ_FAILED).not.toBe("");
  });

  it("distinguishes a genuine empty queue, and carries the counts that prove it was read", () => {
    const block = buildDecisionsBlock({
      decisions: [], excludedNoConsent: 2, excludedSnoozed: 1, totalLive: 3, queryable: true,
    });
    expect(block).toMatch(/read successfully/);
    expect(block).not.toMatch(/UNAVAILABLE/);
    expect(block).toMatch(/3 live, 2 excluded for no contact consent, 1 snoozed/);
  });

  it("is never the empty string — every state produces a line the model must account for", () => {
    for (const t of [
      { decisions: [], excludedNoConsent: 0, excludedSnoozed: 0, totalLive: 0, queryable: false },
      { decisions: [], excludedNoConsent: 0, excludedSnoozed: 0, totalLive: 0, queryable: true },
      { decisions: [decision], excludedNoConsent: 0, excludedSnoozed: 0, totalLive: 1, queryable: true },
    ]) {
      expect(buildDecisionsBlock(t).trim().length).toBeGreaterThan(0);
    }
  });
});

describe("the populated block is unchanged", () => {
  it("still lists decisions verbatim with value, evidence and attempts", () => {
    const block = buildDecisionsBlock({
      decisions: [decision], excludedNoConsent: 4, excludedSnoozed: 0, totalLive: 5, queryable: true,
    });
    expect(block).toMatch(/lead with these, verbatim/);
    expect(block).toMatch(/1\. \[CRITICAL\] Call Maria about the declined brake estimate — \$840 · declined 9 days ago, no follow-up \(evidence: verified, attempts: 0\)/);
    expect(block).toMatch(/\(4 opportunities excluded — no contact consent\)/);
  });

  it("still says 'value unknown' rather than $0 when the value is not known", () => {
    const block = buildDecisionsBlock({
      decisions: [{ ...decision, factors: { valueDollars: 0 } }],
      excludedNoConsent: 0, excludedSnoozed: 0, totalLive: 1, queryable: true,
    });
    expect(block).toMatch(/value unknown/);
    expect(block).not.toMatch(/\$0/);
  });
});

describe("the prompt half — the model has to be told what to do with each state", () => {
  it("instructs the model not to invent priorities when the queue is UNAVAILABLE", () => {
    expect(BRIEF).toMatch(/If it says "UNAVAILABLE"/);
    expect(BRIEF).toMatch(/Never fill an unavailable queue with priorities you inferred/);
  });

  it("keeps the verbatim rule for a populated queue", () => {
    expect(BRIEF).toMatch(/keep each recommended action verbatim, and never invent decisions beyond them/);
  });

  it("still asks for a Top 3 priorities section — the rule constrains it, it does not delete it", () => {
    // Removing the section would also 'fix' the invention, by removing the most
    // useful part of the brief. The point is a priority list that is honest
    // about its own provenance, not no priority list.
    expect(BRIEF).toMatch(/Top 3 priorities/);
  });
});
