/**
 * The board must not answer a question the operator did not ask.
 *
 * THE COMPLAINT, and the first defect today that reached the operator's own
 * daily use rather than his instrumentation: he finished his workout, marked it
 * done, and the board read `WAITING`. Nothing displayed was false. That is what
 * makes it a lying surface rather than a bug — nobody wrote anything untrue, and
 * the reader still came away with the wrong belief. It is also, in one row, the
 * whole "everything feels broken while nothing is wrong" complaint.
 *
 * MEASURED AGAINST PROD, 2026-08-23, and it corrected the design twice:
 *
 *   · 8 `completed` events across 8 distinct tasks. Four ONCE tasks read DONE;
 *     four DAILY tasks read WAITING. The split is exactly recurring vs one-off.
 *   · The WAITING four are NOT stranded — the first hypothesis, and wrong. All
 *     four carry `snoozedUntil` seven hours out (tomorrow 6am). `checkTask`
 *     leaves a completed DAILY at READY; only WEEKLY snoozes on completion. So
 *     the operator completed them AND snoozed them, and the row collapsed two
 *     true facts into the less useful one.
 *
 * Hence "done today · back at 6am" rather than "done today": either half alone
 * is a different lie. Understanding the mechanism changed the fix.
 */
import { describe, it, expect } from "vitest";
import {
  describeCompletion,
  hasDeclaredFrame,
  type CompletionDisplay,
} from "@/lib/services/completion-frame";

// 2026-08-23 21:00Z ≈ 5pm ET. Snooze lands at 6am ET tomorrow.
const NOW = new Date("2026-08-23T21:00:00Z");
const DONE_TODAY = new Date("2026-08-23T16:59:00Z").toISOString();
const SNOOZE_6AM = new Date("2026-08-24T10:00:00Z").toISOString();

describe("the artefact · a recurring task completed today", () => {
  it("NEVER reads as bare WAITING", () => {
    const d = describeCompletion(
      { status: "WAITING", loopKind: "DAILY", lastCompletedAt: DONE_TODAY, snoozedUntil: SNOOZE_6AM },
      NOW,
    );
    expect(d.label.toLowerCase(), "this is the exact string the operator saw").not.toBe("waiting");
    expect(d.label).toContain("done today");
  });

  it("says when it comes back, because half the truth is a different lie", () => {
    // The snooze is real and deliberate — the four live tasks all carry one.
    // "done today" alone would imply it is finished with; "WAITING" alone hides
    // that he did it. Both facts or neither.
    const d = describeCompletion(
      { status: "WAITING", loopKind: "DAILY", lastCompletedAt: DONE_TODAY, snoozedUntil: SNOOZE_6AM },
      NOW,
    );
    expect(d.label).toMatch(/back/);
    expect(d.frame).toBe("both");
  });

  it("a completed DAILY with no snooze still says it returns tomorrow", () => {
    // checkTask leaves a completed DAILY at READY "so it reappears tomorrow".
    const d = describeCompletion(
      { status: "READY", loopKind: "DAILY", lastCompletedAt: DONE_TODAY, snoozedUntil: null },
      NOW,
    );
    expect(d.label).toBe("done today · back tomorrow");
    expect(d.frame).toBe("both");
  });
});

describe("every label declares its frame — the invariant", () => {
  const CASES: Array<[string, Parameters<typeof describeCompletion>[0]]> = [
    ["recurring done today", { status: "WAITING", loopKind: "DAILY", lastCompletedAt: DONE_TODAY, snoozedUntil: SNOOZE_6AM }],
    ["recurring not done", { status: "READY", loopKind: "DAILY", lastCompletedAt: null }],
    ["recurring snoozed, not done", { status: "WAITING", loopKind: "WEEKLY", lastCompletedAt: null, snoozedUntil: SNOOZE_6AM }],
    ["one-off done", { status: "DONE", loopKind: "ONCE", lastCompletedAt: DONE_TODAY }],
    ["one-off open", { status: "READY", loopKind: "ONCE", lastCompletedAt: null }],
    ["no loopKind at all", { status: "READY", lastCompletedAt: null }],
  ];

  for (const [name, input] of CASES) {
    it(`${name} carries a frame`, () => {
      const d = describeCompletion(input, NOW);
      expect(hasDeclaredFrame(d), `no frame on: ${d.label}`).toBe(true);
      expect(d.detail.length, "the detail must say something, not be an empty string").toBeGreaterThan(10);
    });
  }

  it("THE NEGATIVE CASE: a label with NO frame fails — that is today's condition", () => {
    // The board did not render a WRONG frame. It rendered none: a bare status
    // string with nothing saying which question it answered. The guard has to
    // fail on absence, or it would have passed over the exact defect it exists
    // for. Each shape below is something a careless caller could hand it.
    expect(hasDeclaredFrame(null)).toBe(false);
    expect(hasDeclaredFrame(undefined)).toBe(false);
    expect(hasDeclaredFrame({ label: "WAITING" } as Partial<CompletionDisplay>)).toBe(false);
    expect(hasDeclaredFrame({ label: "WAITING", frame: undefined })).toBe(false);
    expect(
      hasDeclaredFrame({ label: "WAITING", frame: "lifetime" as unknown as CompletionDisplay["frame"] }),
      "an invented frame is not a declared one",
    ).toBe(false);
  });
});

describe("the row actually RENDERS it — a computed label nobody reads is not a fix", () => {
  const src = readRowSource();

  it("mission-task-row calls describeCompletion", () => {
    expect(src).toContain("describeCompletion(");
    expect(src).toContain("completion-frame");
  });

  it("the label reaches the DOM, not just a title= attribute", () => {
    // statenour is a standalone iOS PWA (AGENTS.md → Frontend conventions):
    // hover does not exist, so a tooltip is a dead affordance. The operator has
    // to be able to READ it.
    expect(src).toMatch(/\{completionDisplay\.label\}/);
    const at = src.indexOf("{completionDisplay.label}");
    const around = src.slice(Math.max(0, at - 400), at);
    expect(around, "must be rendered as element text").toMatch(/<p[^>]*>/);
  });

  it("it is gated on the frame, not on loopKind", () => {
    // Keying on loopKind would show the chip on a recurring task he has NOT
    // completed, which claims a completion that did not happen.
    expect(src).toMatch(/showsCompletionFrame\s*&&/);
    expect(src).toMatch(/completionDisplay\.frame === "both"/);
  });
});

describe("POSITIVE CONTROLS · the ordinary cases must stay ordinary", () => {
  it("a one-off DONE still just says done", () => {
    // Without this, a function that returned "done today · back tomorrow" for
    // everything would pass every assertion above while making one-off tasks
    // look recurring.
    const d = describeCompletion({ status: "DONE", loopKind: "ONCE", lastCompletedAt: DONE_TODAY }, NOW);
    expect(d.label).toBe("done");
    expect(d.frame).toBe("status");
    expect(d.label).not.toContain("back");
  });

  it("a recurring task NOT completed today does not claim it was", () => {
    // The failure that would be worst: telling him he worked out when he did not.
    const d = describeCompletion(
      { status: "WAITING", loopKind: "DAILY", lastCompletedAt: "2026-08-22T16:00:00Z", snoozedUntil: SNOOZE_6AM },
      NOW,
    );
    expect(d.label).not.toContain("done today");
    expect(d.label).toContain("snoozed");
  });

  it("the ET day boundary is load-bearing, and these values PROVE it", () => {
    // Chosen so ET and UTC DISAGREE — an earlier version used two timestamps
    // that fell on the same day in both zones, so swapping the ET calendar for
    // toISOString() changed nothing and the mutation survived. A boundary test
    // whose inputs sit on the same side of the boundary tests nothing.
    //
    //   completed 2026-08-23T20:00Z = 4pm  ET, Aug 23
    //   now       2026-08-24T02:00Z = 10pm ET, Aug 23   <- same ET day
    //                                          Aug 24   <- different UTC day
    //
    // Under UTC math his 4pm workout stops counting as "done today" at 8pm,
    // which is the same defect class as the UTC streak bug checkTask already
    // carries a comment about.
    const tenPmEt = new Date("2026-08-24T02:00:00Z");
    const d = describeCompletion(
      { status: "READY", loopKind: "DAILY", lastCompletedAt: "2026-08-23T20:00:00Z" },
      tenPmEt,
    );
    expect(d.label, "a 4pm workout is still today's at 10pm the same evening").toContain("done today");
  });

  it("an unparseable timestamp degrades to status, it does not throw", () => {
    const d = describeCompletion(
      { status: "READY", loopKind: "DAILY", lastCompletedAt: "not-a-date" },
      NOW,
    );
    expect(d.frame).toBe("status");
    expect(d.label).toBe("ready");
  });
});

function readRowSource(): string {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const { resolve } = require("node:path") as typeof import("node:path");
  return readFileSync(resolve(process.cwd(), "components/missions/mission-task-row.tsx"), "utf8");
}
