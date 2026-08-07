/**
 * The prompt must not ban what it elsewhere instructs.
 *
 * FOUR SELF-CONTRADICTIONS WERE FOUND IN THIS FILE IN ONE DAY:
 *   1. banned wait-time estimates, then supplied "~20 min tire, ~15 min oil"
 *      (fixed; pinned by vapi.prompt-durations.test.ts)
 *   2. capped beats at <=25 spoken words, then handed over a 54-word script
 *      (fixed; pinned by vapi.prompt-exemplars.test.ts)
 *   3. banned chaining two waits, while a hardcoded tool message supplied the
 *      second one (fixed in the transferCall destination message)
 *   4. banned re-announcing the shop, while `## WRONG NUMBER` instructs exactly
 *      that — THIS FILE
 *
 * (4) was measured, not theorised: an audit of 100 real inbound calls found 6
 * "re-greet violations", and every one was the assistant correctly following the
 * WRONG NUMBER flow. The ban was over-broad, so the speech was right and the
 * rule was wrong.
 *
 * A contradiction is worse than a missing rule. It guarantees the model breaks
 * one of the two instructions on every call that hits both, and it poisons any
 * evaluator built on the ban — including the kill-list audit that found it.
 *
 * These assertions are structural: a ban and its documented exception must
 * co-exist. They do not police wording.
 */
import { describe, expect, it } from "vitest";
import { ASSISTANT_SYSTEM_PROMPT } from "./services/vapi";

const section = (heading: string, span = 600): string => {
  const i = ASSISTANT_SYSTEM_PROMPT.indexOf(heading);
  expect(i, `section "${heading}" missing`).toBeGreaterThan(-1);
  return ASSISTANT_SYSTEM_PROMPT.slice(i, i + span);
};

describe("prompt self-consistency · re-greeting vs WRONG NUMBER", () => {
  it("still bans re-announcing the shop", () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/Re-greeting:/);
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/NEVER re-announce the shop/i);
  });

  it("WRONG NUMBER still names the shop — a misdialer must learn where they landed", () => {
    const s = section("## WRONG NUMBER");
    expect(s).toMatch(/Nick'?s Tire/i);
  });

  it("the ban carries the WRONG NUMBER exception, so the two rules can both be obeyed", () => {
    const banLine = ASSISTANT_SYSTEM_PROMPT
      .split("\n")
      .find((l) => /Re-greeting:/.test(l));
    expect(banLine, "re-greeting ban line not found").toBeTruthy();
    expect(banLine!).toMatch(/WRONG NUMBER/i);
    expect(banLine!).toMatch(/exception/i);
  });

  it("the ban is scoped to callers who meant to reach the shop, not to all speech", () => {
    const banLine = ASSISTANT_SYSTEM_PROMPT.split("\n").find((l) => /Re-greeting:/.test(l))!;
    // "One greeting per call, period." was the absolute form that created the
    // contradiction. An absolute ban cannot carry an exception.
    expect(banLine).not.toMatch(/one greeting per call,\s*period/i);
  });
});

describe("prompt · WRONG NUMBER must open a door, not just correct the record", () => {
  /**
   * Found 2026-08-07 by ghost-replaying the REAL call (seed 019fd32f): the
   * caller asked for a different "Nick's", got the identity correction the
   * prompt scripts verbatim — and hung up, logged lost_opportunity. The model
   * obeyed the prompt exactly; the prompt was the defect. A misdialer is still
   * a driver with a car, so the correction must arrive WITH a way in.
   *
   * Note the instrument lesson pinned alongside it: the cage's live adversary
   * kept talking for 8 turns and let the receptionist recover, so the cage
   * scored this same seed a HOLD. The frozen real caller is the harsher judge.
   */
  it("pairs the clarify line with a concrete doorway", () => {
    const s = section("## WRONG NUMBER", 1200);
    expect(s).toMatch(/doorway/i);
    // A doorway is a concrete next step, not another qualifying question.
    expect(s).toMatch(/walk-ins|come (on )?by|we'?re open/i);
  });

  /**
   * Same defect family, second trigger (2026-08-07, seed 019fd890): the caller
   * garbled their vehicle ("2008 Toyota Silverado"), the assistant correctly
   * caught the contradiction — and that was three question-only turns in a row
   * with nothing offered. The caller hung up. A clarifying question is not a
   * turn; a clarifying question WITH a doorway is.
   */
  it("FLOW 1 forbids sidewall/door-jamb homework and question-only turns", () => {
    const s = section("## FLOW 1", 3000);
    expect(s).toMatch(/SIZE UNKNOWN or VEHICLE GARBLED/);
    // The tire is on the car — never send the caller away to do our reading.
    expect(s).toMatch(/NEVER send them off to read a sidewall/i);
    // ...and the disambiguating question must carry the way in.
    expect(s).toMatch(/doorway attached/i);
    expect(s).toMatch(/NEVER let a clarifying question be your whole turn/i);
  });

  it("still closes out a CONFIRMED different business, and still defers to the BY-NAME rule", () => {
    const s = section("## WRONG NUMBER", 1200);
    // The doorway must not swallow the exit path...
    expect(s).toMatch(/confirm/i);
    // ...nor the Mark fix (#1401): a person asked for BY NAME is a transfer.
    expect(s).toMatch(/BY NAME/);
  });
});

describe("prompt self-consistency · the three previously-fixed contradictions stay fixed", () => {
  it("no spoken duration estimate survives anywhere", () => {
    const durations = ASSISTANT_SYSTEM_PROMPT.match(
      /(?:~\s*)?\b\d{1,3}\s*(?:-|\s)?\s*(?:min|mins|minute|minutes|hr|hrs|hour|hours)\b/gi,
    ) ?? [];
    expect(durations, `prompt supplies durations it forbids: ${JSON.stringify(durations)}`).toEqual([]);
  });

  it("the wait-estimate ban and the oil-duration ban are both still stated", () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/NEVER estimate a wait/i);
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/Never state how long an oil change takes/i);
  });

  it("the stacked-filler ban is still stated (its cause lived in code, not here)", () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/never chain two waits/i);
  });
});
