/**
 * ROS-083 · the invariant, after the 2026-09-07 retirement.
 *
 * ORIGINAL DEFECT. The morning brief's TOP DECISIONS block was left as ""
 * whenever the opportunity queue came back empty, collapsing three states into
 * one (read-and-clear · unconsultable · threw). Because FORMAT RULES mandated a
 * "Top 3 priorities" section, an absent block made the LLM write the operator's
 * priorities FROM SCRATCH out of whatever else was in the data blob and send
 * them to Telegram looking exactly like a queue-backed list.
 *
 * ORIGINAL FIX. Make the block always present and self-describing, and KEEP the
 * priorities section — explicitly reasoning that "removing the section would
 * also 'fix' the invention, by removing the most useful part of the brief".
 *
 * WHY THIS FILE CHANGED. That reasoning assumed the queue SHOULD lead the
 * operator's day. On 2026-09-07 the operator decided the opposite and retired
 * the Decision Inbox from the admin home, because a queue that leads the day
 * manufactures obligations on a healthy day. Leaving the block in the brief
 * would have moved the same obligation from a page he can ignore to a push he
 * cannot.
 *
 * THE INVARIANT IS UNCHANGED AND IS THE WHOLE POINT: the brief must never emit
 * priorities that look evidence-backed but are invented. ROS-083 satisfied it by
 * CONSTRAINING the mandate. This satisfies it by DELETING the mandate. What
 * would re-open the defect is removing one half without the other — a block with
 * no rule, or a rule with no block — so both halves are asserted here.
 *
 * These are source-text assertions because the subject is a PROMPT. There is no
 * return value to inspect; the failure mode is text that instructs a model to
 * invent. That is also why the negative assertions matter more than usual.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const BRIEF = readFileSync(join(__dirname, "cron", "jobs", "morningBrief.ts"), "utf8");

/** Everything between "FORMAT RULES:" and the end of the prompt template. */
const formatRules = BRIEF.slice(BRIEF.indexOf("FORMAT RULES:"));

describe("the brief no longer assigns work", () => {
  it("does not build or interpolate a decisions block", () => {
    // The identifiers may survive in the historical note at the top of the file;
    // what must not survive is a live interpolation into the prompt.
    expect(BRIEF).not.toMatch(/\$\{decisionsBlock\}/);
    expect(BRIEF).not.toMatch(/buildDecisionsBlock\s*\(/);
  });

  it("does not mandate a ranked priority list", () => {
    // The other half of the fix. A "Top 3 priorities" mandate with no queue
    // block is exactly the original defect: the model fills it from the blob.
    expect(formatRules).not.toMatch(/Top 3 priorities/);
    expect(formatRules).not.toMatch(/TOP DECISIONS/);
  });

  it("explicitly forbids inventing or ranking priorities", () => {
    expect(formatRules).toMatch(/does not assign work/i);
    expect(formatRules).toMatch(/NEVER infer, rank, or invent a priority/);
  });

  it("allows a quiet day to be quiet", () => {
    expect(formatRules).toMatch(/a quiet day is allowed to be quiet/);
  });

  it("still routes genuine exceptions through the exceptions block", () => {
    // Retiring the queue must not also retire the honest channel. The
    // exceptions block is sourced, bounded and explicit about UNKNOWNs.
    expect(BRIEF).toMatch(/\$\{exceptionsBlock\}/);
    expect(formatRules).toMatch(/EXCEPTIONS block/);
  });
});

describe("the reasoning survives where the next editor will read it", () => {
  it("records why both halves had to be removed together", () => {
    // A future session tidying "dead" prose could delete the note and then
    // re-add a priorities mandate, re-opening ROS-083 with no test to catch it
    // — because the assertions above only fire if the rationale is discoverable.
    expect(BRIEF).toMatch(/ROS-083/);
    expect(BRIEF).toMatch(/re-created the original defect|re-creating the original defect|removing only the block/i);
  });
});
