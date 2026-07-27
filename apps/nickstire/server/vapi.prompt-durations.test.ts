/**
 * The prompt must not contradict its own rules.
 *
 * THE FAILURE THIS PREVENTS
 * `ASSISTANT_SYSTEM_PROMPT` forbids wait estimates in two places —
 *   "you do NOT know how busy the shop is and must NEVER estimate a wait, a
 *    number of minutes" (# YOUR TOOLS)
 *   "Never state how long an oil change takes" (Critical Rule 1)
 * — and then, 53 lines below the first, supplied three of them:
 *   "WAIT (lobby — ~20 min tire, ~15 min oil) ... preferred for anything over
 *    ~30 min"
 *
 * A 2026-07-26 pass removed one copy of the "~15 min" oil duration and wrote a
 * file-header comment saying it was gone. The WALK-IN copy survived, so the
 * comment asserted a fix that had not landed. voiceClaimGuard then caught the
 * assistant telling a real caller "about 15 minutes" — that figure, spoken,
 * from the prompt. It was the ONLY prohibited-claim violation in 526 assistant
 * turns, and its cause was in the prompt rather than in the model.
 *
 * DESIGN UNDER TEST
 * A rule the prompt states and then breaks cannot be enforced by restating it.
 * These assertions are mechanical: they scan the shipped prompt text, so a
 * partial removal fails the build rather than leaving a live contradiction.
 *
 * DELIBERATELY NOT ASSERTED: that the prompt contains no digits at all. Hours,
 * prices, tire sizes and rule numbers are all legitimate. Only spoken DURATION
 * is banned, because a duration is a completion promise and no data source
 * backs one.
 */
import { describe, expect, it } from "vitest";
import { ASSISTANT_SYSTEM_PROMPT } from "./services/vapi";

/** A duration figure the assistant could speak: "~15 min", "20 minutes", "an hour". */
const SPOKEN_DURATION =
  /(?:~\s*)?\b\d{1,3}\s*(?:-|–|\s)?\s*(?:min|mins|minute|minutes|hr|hrs|hour|hours)\b|\b(?:ten|fifteen|twenty|thirty|forty|forty[\s-]five|sixty|ninety|an?|a\s+couple\s+of|a\s+few|half\s+an)\s+(?:min|mins|minute|minutes|hr|hrs|hour|hours)\b/gi;

describe("prompt must not contradict its own wait-time rule", () => {
  it("still STATES the rule (guard against fixing this by deleting the rule)", () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/NEVER estimate a wait/i);
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/Never state how long an oil change takes/i);
  });

  it("contains NO spoken duration estimate anywhere", () => {
    const hits = ASSISTANT_SYSTEM_PROMPT.match(SPOKEN_DURATION) ?? [];
    expect(
      hits,
      `prompt contains duration estimate(s) it forbids: ${JSON.stringify(hits)}`,
    ).toEqual([]);
  });

  it("specifically carries no oil-change or tire wait duration", () => {
    expect(ASSISTANT_SYSTEM_PROMPT).not.toMatch(/15\s*min/i);
    expect(ASSISTANT_SYSTEM_PROMPT).not.toMatch(/20\s*min/i);
    expect(ASSISTANT_SYSTEM_PROMPT).not.toMatch(/30\s*min/i);
  });

  it("keeps the WAIT-or-DROP-OFF choice, which is real and not a timing claim", () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/DROP OFF/);
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/never assume drop-off/i);
  });

  it("the detector is not vacuous — it catches the string that shipped", () => {
    const shipped = "WAIT (lobby — ~20 min tire, ~15 min oil) or DROP OFF ... over ~30 min";
    expect(shipped.match(SPOKEN_DURATION) ?? []).not.toEqual([]);
  });
});
