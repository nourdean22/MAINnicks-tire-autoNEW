/**
 * Action vocab parity tests · v10.0.177
 *
 * Asserts the bijection between input-side (intent) and output-side
 * (claim) regexes for every concept in the shared vocab. If a verb
 * is added in past-tense without an imperative counterpart (or vice
 * versa), the parity test fails — preventing the v10.0.176 drift
 * that let "complete those tasks" slip past the intent detector.
 *
 * Also asserts that representative phrases match round-trip:
 *   imperative phrase → intent regex matches → tool name surfaces
 *   past-tense phrase → claim regex matches → tool name surfaces
 */

import { describe, it, expect } from "vitest";
import {
  ACTION_VOCAB,
  intentRegex,
  claimRegex,
  intentEntries,
  claimEntries,
} from "@/lib/ai/action-vocab";

describe("action-vocab · structural integrity", () => {
  it("every concept has at least one imperative AND past form", () => {
    for (const c of ACTION_VOCAB) {
      expect(c.imperative.length, `${c.intent} imperative empty`).toBeGreaterThan(0);
      expect(c.past.length, `${c.intent} past empty`).toBeGreaterThan(0);
    }
  });

  it("every concept maps to a non-empty tool name", () => {
    for (const c of ACTION_VOCAB) {
      expect(c.tool, c.intent).toMatch(/^[a-zA-Z]+(?:\|[a-zA-Z]+)*$/);
    }
  });

  it("intent and claim entries have 1:1 cardinality", () => {
    expect(intentEntries().length).toBe(ACTION_VOCAB.length);
    expect(claimEntries().length).toBe(ACTION_VOCAB.length);
  });

  it("regex generation is stable (no infinite gaps, no syntax errors)", () => {
    for (const c of ACTION_VOCAB) {
      const i = intentRegex(c);
      const o = claimRegex(c);
      expect(i.source.length, `${c.intent} intent regex too long`).toBeLessThan(500);
      expect(o.source.length, `${c.intent} claim regex too long`).toBeLessThan(500);
    }
  });
});

describe("action-vocab · round-trip parity", () => {
  it("'add a task' triggers intent for task-create", () => {
    const concept = ACTION_VOCAB.find((c) => c.intent === "task-create");
    expect(concept).toBeDefined();
    expect(intentRegex(concept!).test("add a task")).toBe(true);
    expect(claimRegex(concept!).test("Added a task to the list")).toBe(true);
  });

  it("'complete the tasks' triggers intent for task-complete", () => {
    const concept = ACTION_VOCAB.find((c) => c.intent === "task-complete");
    expect(concept).toBeDefined();
    expect(intentRegex(concept!).test("complete the tasks")).toBe(true);
    expect(claimRegex(concept!).test("Completed both tasks")).toBe(true);
  });

  it("'send an email' triggers intent for send-comm", () => {
    const concept = ACTION_VOCAB.find((c) => c.intent === "send-comm");
    expect(concept).toBeDefined();
    expect(intentRegex(concept!).test("send an email to that customer")).toBe(true);
    // 2026-09-22 · the concept's claim form is FIRST PERSON only
    // (claimNeedsFirstPerson): every production banner it raised in 60 days
    // was a recap of someone else's send. The terse sentence-opening "Sent
    // the email …" is the detector's `sent (bare)` edge pattern's job and is
    // asserted in action-claim-detector.test.ts ("flags 'sent the email'").
    expect(claimRegex(concept!).test("I sent the email to the customer")).toBe(true);
    expect(claimRegex(concept!).test("Mo sent the email to the customer")).toBe(false);
  });

  it("'schedule a follow-up' triggers intent for schedule", () => {
    const concept = ACTION_VOCAB.find((c) => c.intent === "schedule");
    expect(concept).toBeDefined();
    expect(intentRegex(concept!).test("schedule a follow-up")).toBe(true);
    expect(claimRegex(concept!).test("Scheduled a follow-up for next week")).toBe(true);
  });

  it("'bump priority' triggers intent for priority-set", () => {
    const concept = ACTION_VOCAB.find((c) => c.intent === "priority-set");
    expect(concept).toBeDefined();
    expect(intentRegex(concept!).test("bump priority on Bay 5")).toBe(true);
    expect(claimRegex(concept!).test("Bumped priority on the brake job")).toBe(true);
  });
});

describe("action-vocab · kaizen contract", () => {
  it("adding a verb to imperative MUST also appear in past (drift guard)", () => {
    // Heuristic: imperative and past arrays should be the same length
    // for verbs that have a clean -ed/-d transformation. We don't
    // enforce strict equality (some verbs have irregular forms), but
    // we DO assert that adding one without considering the other is
    // hard to do silently — array lengths within ±2.
    for (const c of ACTION_VOCAB) {
      const diff = Math.abs(c.imperative.length - c.past.length);
      expect(
        diff,
        `${c.intent} has imperative=${c.imperative.length} but past=${c.past.length} — likely drift`,
      ).toBeLessThanOrEqual(2);
    }
  });
});

/**
 * 2026-09-22 · Codex follow-ups on #2513: the sentence-opening arm needs a real
 * object opener (determiner or pronoun) after the verb, and a mid-sentence `just`
 * is not a subject.
 */
describe("claimRegex · sentence-opening arm needs an object opener (Codex on #2513)", () => {
  const taskComplete = ACTION_VOCAB.find((c) => c.intent === "task-complete")!;
  const dataSync = ACTION_VOCAB.find((c) => c.intent === "data-sync")!;
  it("an opening adjective phrase is not a claim", () => {
    expect(claimRegex(taskComplete).test("Closed job details follow")).toBe(false);
    expect(claimRegex(dataSync).test("Synced calendar events appear below.")).toBe(false);
    expect(claimRegex(taskComplete).test("Completed tasks are listed at the bottom.")).toBe(false);
  });
  it("POSITIVE CONTROL: the terse confirmation with a determiner or pronoun still fires", () => {
    expect(claimRegex(taskComplete).test("Closed the job.")).toBe(true);
    expect(claimRegex(taskComplete).test("Done — completed both tasks.")).toBe(true);
    expect(claimRegex(taskComplete).test("Marked those done.")).toBe(true);
    expect(claimRegex(dataSync).test("Synced your calendar.")).toBe(true);
    expect(claimRegex(dataSync).test("Ok, pulled the inbox.")).toBe(true);
  });
});

describe("claimRegex · a mid-sentence `just` is not a subject (Codex on #2513)", () => {
  const taskComplete = ACTION_VOCAB.find((c) => c.intent === "task-complete")!;
  it("a third-person recap with `just` stays quiet", () => {
    expect(claimRegex(taskComplete).test("She just finished the job.")).toBe(false);
    expect(claimRegex(taskComplete).test("Mo just closed the task an hour ago.")).toBe(false);
  });
  it("POSITIVE CONTROL: first person with `just`, and a sentence-opening `Just`, still fire", () => {
    expect(claimRegex(taskComplete).test("I just finished the job.")).toBe(true);
    expect(claimRegex(taskComplete).test("I've just closed the task.")).toBe(true);
    expect(claimRegex(taskComplete).test("Just finished the job.")).toBe(true);
  });
});
