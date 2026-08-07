/**
 * STT forensics · pure-surface tests + the turn-taking config pin.
 *
 * The signals here justified a live turn-taking change, so they have to mean
 * what the header claims. The config assertions exist because the value was
 * tuned on WEAK evidence — if someone changes it again, these tests make them
 * read the reasoning first.
 */
import { describe, expect, it } from "vitest";
import { BARE_HELLO, HESITATION_STUB, computeSttSignals } from "../scripts/stt-forensics";
import { ASSISTANT_SYSTEM_PROMPT } from "./services/vapi";

describe("HESITATION_STUB", () => {
  it("matches a pause-to-think that smartFormat closed with punctuation", () => {
    for (const t of ["Yeah.", "Okay.", "Yes. Hello?", "Uh.", "So.", "Hi.", "Sure."]) {
      expect(HESITATION_STUB.test(t), `${t} should be a stub`).toBe(true);
    }
  });

  it("does NOT match a real request that happens to start the same way", () => {
    for (const t of [
      "Yeah I need two used tires for a Civic.",
      "Okay so my brakes are grinding pretty bad.",
      "Hello, do you have a 225/60R17 in stock?",
    ]) {
      expect(HESITATION_STUB.test(t), `${t} is a real request, not a stub`).toBe(false);
    }
  });

  it("requires the terminal punctuation — an unpunctuated stub is a different signal", () => {
    expect(HESITATION_STUB.test("Yeah")).toBe(false);
  });
});

describe("BARE_HELLO", () => {
  it("matches only a bare greeting turn", () => {
    for (const t of ["Hello?", "hello", " Hello. "]) expect(BARE_HELLO.test(t)).toBe(true);
    for (const t of ["Hello, are you open?", "Hello Mark"]) expect(BARE_HELLO.test(t)).toBe(false);
  });
});

describe("computeSttSignals", () => {
  it("counts tiny/punctuated/stub turns and the hello loop", () => {
    const s = computeSttSignals([
      { outcome: "lost_opportunity", turns: ["Hello?", "Hello?", "Yeah. So I was wonder."] },
      { outcome: "walk_in_directed", turns: ["I need two used tires for a 2015 Malibu please"] },
    ]);
    expect(s.calls).toBe(2);
    expect(s.turns).toBe(4);
    expect(s.tinyTurns).toBe(2); // the two "Hello?" turns
    expect(s.tinyPunctuated).toBe(2);
    // Exactly 2 — the two bare "Hello?" turns. "Yeah. So I was wonder." is
    // deliberately NOT a stub: it is a truncated REAL request, which is a
    // different (and more serious) signal than a pause to think.
    expect(s.hesitationStubs).toBe(2);
    expect(s.helloLoopCalls).toBe(1);
  });

  it("a call with NO caller turns is not counted — it cannot signal anything", () => {
    const s = computeSttSignals([{ outcome: "lost_opportunity", turns: [] }]);
    expect(s.calls).toBe(0);
    expect(s.turns).toBe(0);
  });

  it("byOutcome drops outcomes under 5 calls — a 1-call rate is noise, not a signal", () => {
    const s = computeSttSignals([{ outcome: "rare", turns: ["Yeah."] }]);
    expect(s.byOutcome).toEqual([]);
  });
});

describe("turn-taking config · read the reasoning before changing these", () => {
  it("the prompt still warns that Deepgram mis-hears short names", () => {
    // Same root cause family: single-syllable speech is where this stack is
    // weakest, which is why the endpointing value matters.
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/Deepgram skews toward/);
  });
});
