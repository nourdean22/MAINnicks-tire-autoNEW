/**
 * Generated subtasks must be next actions. The canary for the contract.
 *
 * THE LIVE ARTEFACT, 2026-08-23. A staleness detector found an open loop and the
 * system decomposed it into six subtasks. The first was "Decide on action for the
 * open loop" — the original problem restated as a child of itself. The system
 * detected an open loop and created six more, with a progress bar.
 *
 * GROUNDING. "Open loop" is David Allen's own term, so the generator is already
 * speaking GTD vocabulary, and GTD's rule is that a next action is the next
 * PHYSICAL, VISIBLE action — a decision is definitionally not one
 * (https://ccowan.substack.com/p/a-decision-is-not-a-next-action). Vague entries
 * drive procrastination, and an item written down but unresolved into a physical
 * action remains an open loop (https://hamberg.no/gtd,
 * https://super-productivity.com/blog/gtd-next-actions-guide/).
 *
 * The generator's prompt ALREADY asked for "specific physical steps" and got a
 * decision anyway. That is why this is a test and not a prompt edit: a prompt is a
 * request, a validator is a contract.
 */
import { describe, it, expect } from "vitest";
import {
  validateSubtaskTitle,
  filterGeneratedSubtasks,
  countDispositions,
} from "@/lib/services/subtask-validator";

describe("subtask validator · the exact artefact", () => {
  it("REJECTS 'Decide on action for the open loop' — the live one", () => {
    const v = validateSubtaskTitle("Decide on action for the open loop");
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/decision|deliberation/i);
    expect(v.reason, "the message must teach the rule, not just refuse").toMatch(
      /physical/i,
    );
  });

  it("REJECTS 'Update task tracker with outcome' — work on the tracker, not the world", () => {
    const v = validateSubtaskTitle("Update task tracker with outcome");
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/tracker|side effect/i);
  });

  it("POSITIVE CONTROL: a physical action that happens to contain 'tracker' survives", () => {
    // The pattern was `/(task )?tracker/i` — a bare word match. In a tire
    // shop "Install the GPS tracker on the loaner truck" is real work, and it
    // was being rejected as meta-work. Two of those in a three-item batch would
    // also trip minKept and suppress the whole decomposition. Verb-anchored now,
    // like the other four patterns in the list always were.
    expect(validateSubtaskTitle("Install the GPS tracker on the loaner truck").ok).toBe(true);
    expect(validateSubtaskTitle("Order a GPS tracker for the shop van").ok).toBe(true);
    // …and the meta-work forms still fail.
    expect(validateSubtaskTitle("Update the task tracker").ok).toBe(false);
    expect(validateSubtaskTitle("Log the outcome").ok).toBe(false);
    expect(validateSubtaskTitle("Mark it done").ok).toBe(false);
  });

  it("rejects the other deliberation verbs", () => {
    for (const t of [
      "Determine the best supplier",
      "Consider whether to delegate",
      "Review the open loops",
      "Evaluate options for the shop",
      "Figure out what to do next",
      "Think about the pricing",
    ]) {
      expect(validateSubtaskTitle(t).ok, `${t} should be rejected`).toBe(false);
    }
  });

  it("POSITIVE CONTROL: real physical actions pass", () => {
    // Without this, a validator that rejected EVERYTHING would score perfectly
    // above while suppressing every decomposition in the product.
    for (const t of [
      "Create recurring Monday calendar event",
      "Delegate the recurring task to shop manager",
      "Call the shop manager about Monday coverage",
      "Draft outline of section 1",
      "Print the drop-off signs",
    ]) {
      expect(validateSubtaskTitle(t).ok, `${t} should pass`).toBe(true);
    }
  });

  it("does not reject a physical action that merely CONTAINS a deliberation verb", () => {
    // The rule is anchored to the opening verb. "Call the shop to decide on pricing"
    // is a real, watchable action; a substring match would have killed it, and an
    // over-broad validator gets deleted the first time it blocks something good.
    expect(validateSubtaskTitle("Call the shop to decide on pricing").ok).toBe(true);
    expect(validateSubtaskTitle("Email Dave the review checklist").ok).toBe(true);
  });

  it("strips list markers before judging — '1. Decide on X' is still a decision", () => {
    expect(validateSubtaskTitle("1. Decide on action for the open loop").ok).toBe(false);
    expect(validateSubtaskTitle("- Review the backlog").ok).toBe(false);
  });
});

describe("the gate · fewer, better, or nothing", () => {
  it("suppresses the WHOLE batch when too few real actions survive", () => {
    // The live six: one decision, one meta-work, and three mutually exclusive
    // branches. Suppression is the honest output — the operator needs the decision
    // surfaced, not five checkboxes he cannot legitimately complete.
    const generated = [
      { title: "Decide on action for the open loop" },
      { title: "Update task tracker with outcome" },
      { title: "Consider whether to delegate" },
    ];
    const out = filterGeneratedSubtasks(generated);
    expect(out.suppressed).toBe(true);
    expect(out.kept).toEqual([]);
    expect(out.rejected).toHaveLength(3);
  });

  it("a single survivor is a rename, not a decomposition — also suppressed", () => {
    const out = filterGeneratedSubtasks([
      { title: "Decide on action for the open loop" },
      { title: "Create recurring Monday calendar event" },
    ]);
    expect(out.suppressed).toBe(true);
    expect(out.kept).toEqual([]);
  });

  it("POSITIVE CONTROL: a genuinely good batch passes through intact", () => {
    const good = [
      { title: "Create recurring Monday calendar event" },
      { title: "Delegate the recurring task to shop manager" },
      { title: "Print the drop-off signs" },
    ];
    const out = filterGeneratedSubtasks(good);
    expect(out.suppressed).toBe(false);
    expect(out.kept).toHaveLength(3);
    expect(out.rejected).toEqual([]);
  });

  it("rejections are reported even when the batch survives — silent dropping is the old bug", () => {
    const out = filterGeneratedSubtasks([
      { title: "Create recurring Monday calendar event" },
      { title: "Delegate the recurring task to shop manager" },
      { title: "Print the drop-off signs" },
      { title: "Decide on action for the open loop" },
    ]);
    expect(out.suppressed).toBe(false);
    expect(out.kept).toHaveLength(3);
    expect(out.rejected).toHaveLength(1);
    expect(out.rejected[0].reason).toBeTruthy();
  });
});

describe("alternatives are not steps · the full live batch", () => {
  // Verbatim from prod, task cmt2efxsu0181p301kj5s5pfp, 2026-08-23T07:03:03Z.
  // FIVE children, not six — the count was corrected against the database.
  // Parent: [HIGH] Open loop untouched: "Create recurring Monday task 8:…"
  const LIVE_BATCH = [
    { title: "Decide on action for the open loop" },
    { title: "Create recurring Monday calendar event" },
    { title: "Delegate the recurring task to shop manager" },
    { title: "Close the open loop" },
    { title: "Update task tracker with outcome" },
  ];

  it("THE WHOLE ARTEFACT suppresses — three survivors were a menu, not a plan", () => {
    const out = filterGeneratedSubtasks(LIVE_BATCH);
    expect(out.suppressed).toBe(true);
    expect(out.suppressedReason).toBe("alternatives_not_steps");
    expect(out.kept).toEqual([]);
  });

  it("the three alternatives are reported SEPARATELY from the two rejects", () => {
    // They passed the next-action check; only their siblings disqualified them.
    // Folding them into `rejected` would have the caller log three real physical
    // actions under "subtask_rejected_not_a_next_action" — an event asserting the
    // opposite of the finding, and a lie the next reader would inherit.
    const out = filterGeneratedSubtasks(LIVE_BATCH);
    expect(out.rejected.map((r) => r.title)).toEqual([
      "Decide on action for the open loop",
      "Update task tracker with outcome",
    ]);
    expect(out.droppedByBatchRule.map((d) => d.title)).toEqual([
      "Create recurring Monday calendar event",
      "Delegate the recurring task to shop manager",
      "Close the open loop",
    ]);
    expect(out.droppedByBatchRule[0].reason).toMatch(/IS a next action/);
  });

  it("nothing is dropped by a batch rule when the batch is fine", () => {
    const out = filterGeneratedSubtasks([
      { title: "Call the supplier about the winter order" },
      { title: "Print the updated price sheet" },
    ]);
    expect(out.droppedByBatchRule).toEqual([]);
  });

  it("the title gate ALONE would have let this through — which is why the set check exists", () => {
    // Documents the gap honestly: each surviving title is a real physical
    // action, so per-title validation cannot catch this. If someone later
    // deletes the disposition check believing the opener rule covers it,
    // this test states plainly that it does not.
    const perTitleSurvivors = LIVE_BATCH.filter((s) => validateSubtaskTitle(s.title).ok);
    expect(perTitleSurvivors.map((s) => s.title)).toEqual([
      "Create recurring Monday calendar event",
      "Delegate the recurring task to shop manager",
      "Close the open loop",
    ]);
    expect(perTitleSurvivors.length).toBeGreaterThanOrEqual(2);
  });

  it("counts dispositions, and is honest that detection is partial", () => {
    // "Create … calendar event" IS a disposition in meaning (schedule it) but
    // not by its opening verb. Two of three is enough to trip the threshold.
    expect(countDispositions(LIVE_BATCH.map((s) => s.title))).toBe(2);
  });

  it("POSITIVE CONTROL: ONE disposition among real steps is an ordinary plan", () => {
    // Delegation is a legitimate next action. A rule that suppressed every
    // batch containing "Delegate" would block normal work, so the threshold
    // is two — and this asserts one does not trip it.
    const out = filterGeneratedSubtasks([
      { title: "Call the supplier about the winter order" },
      { title: "Delegate the tire rotation to Mike" },
      { title: "Print the updated price sheet" },
    ]);
    expect(out.suppressed).toBe(false);
    expect(out.kept).toHaveLength(3);
    expect(out.suppressedReason).toBe("none");
  });

  it("the two suppression reasons stay distinct — they are different messages", () => {
    const tooFew = filterGeneratedSubtasks([
      { title: "Decide on action for the open loop" },
      { title: "Update task tracker with outcome" },
    ]);
    expect(tooFew.suppressedReason).toBe("too_few_actions");
  });
});
