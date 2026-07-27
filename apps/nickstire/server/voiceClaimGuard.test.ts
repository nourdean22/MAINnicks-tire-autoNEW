/**
 * Voice claim guard — mechanical enforcement of the prompt's truth rules.
 *
 * THE FAILURE THIS PREVENTS
 * SMS drafts are gated by `planViolations` before send. Voice had no equivalent
 * at all, so the only thing preventing an unsourced brake quote on a live call
 * was prohibition prose in the system prompt — 64% of its characters, enforcing
 * nothing mechanically. A model swap or prompt edit could start quoting repairs
 * and no signal in the system would change.
 *
 * DESIGN UNDER TEST
 * Two properties carry the whole thing and are pinned hardest here:
 *
 *   1. ATTRIBUTION. Only assistant speech is scored. A CALLER saying "so it's
 *      like three hundred bucks?" must never be recorded as the assistant
 *      quoting a price. When speaker attribution is impossible, the honest
 *      answer is no violations plus `unparsed: true` — never a clean bill.
 *
 *   2. ANCHOR SUBTRACTION. The three approved prices are stripped BEFORE money
 *      detection, so the detector cannot fire on the prices the prompt requires
 *      the assistant to say, and every surviving figure is unapproved by
 *      construction rather than by a second allowlist that would drift.
 *
 * Transcripts here are speech-to-text shaped — "sixty dollars", not "$60" —
 * because that is what the provider actually emits and a digit-only detector
 * would score a clean 0% on every real call.
 */
import { describe, it, expect } from "vitest";
import {
  buildVoiceClaimRecord,
  extractAssistantTurns,
  extractAssistantTurnsFromMessages,
  voiceClaimViolations,
  VOICE_CLAIM_GUARD_VERSION,
} from "./services/voiceClaimGuard";

const say = (...lines: string[]) => lines.join("\n");

describe("attribution — only the assistant is scored", () => {
  it("drops caller speech entirely", () => {
    const t = say(
      "AI: Nick's Tire and Auto, what can I do for ya?",
      "User: so brakes are like three hundred bucks?",
      "AI: Hard to say over the phone, depends what we see. Free check, written quote.",
    );
    const { turns, unparsed } = extractAssistantTurns(t);
    expect(unparsed).toBe(false);
    expect(turns).toHaveLength(2);
    expect(turns.join(" ")).not.toContain("three hundred");
  });

  it("does NOT flag a price the CALLER said", () => {
    const t = say(
      "User: my last shop wanted four hundred dollars for brakes",
      "AI: Hard to say over the phone, depends what we see. Free check, written quote.",
    );
    const rec = buildVoiceClaimRecord({ transcript: t });
    expect(rec?.violations).toEqual([]);
  });

  it("treats an unprefixed transcript as unparsed, not as clean", () => {
    const rec = buildVoiceClaimRecord({
      transcript: "brakes run about four hundred dollars and we have room right now",
    });
    expect(rec?.unparsed).toBe(true);
    expect(rec?.violations).toEqual([]);
  });

  it("accepts every known assistant prefix variant", () => {
    for (const p of ["AI", "Assistant", "Bot", "Agent"]) {
      const { turns } = extractAssistantTurns(`${p}: brakes run four hundred dollars`);
      expect(turns, `prefix ${p}`).toHaveLength(1);
    }
  });

  it("joins continuation lines into the same assistant turn", () => {
    const { turns } = extractAssistantTurns(say("AI: Free check,", "written quote before any wrench moves."));
    expect(turns).toEqual(["Free check, written quote before any wrench moves."]);
  });
});

describe("attribution — role-tagged messages are preferred", () => {
  it("scores bot/assistant roles and ignores the user role", () => {
    const { turns } = extractAssistantTurnsFromMessages([
      { role: "user", message: "is it four hundred dollars?" },
      { role: "bot", message: "Free check, written quote." },
      { role: "assistant", message: "First-come, first-served." },
    ]);
    expect(turns).toEqual(["Free check, written quote.", "First-come, first-served."]);
  });

  it("drops unrecognised roles rather than guessing", () => {
    const { turns } = extractAssistantTurnsFromMessages([
      { role: "tool_calls", message: "brakes four hundred dollars" },
      { role: "system", message: "you are a receptionist" },
    ]);
    expect(turns).toEqual([]);
  });

  it("flags an empty array as unparsed", () => {
    expect(extractAssistantTurnsFromMessages([]).unparsed).toBe(true);
  });
});

describe("approved anchors must never fire", () => {
  // Exactly the lines the prompt REQUIRES the assistant to say.
  const approved = [
    "Used tires start at sixty dollars installed — mount, balance, valve stems, alignment check.",
    "Conventional or synthetic-blend oil change is forty-nine dollars with coupon code OIL2999.",
    "Full synthetic is eighty dollars.",
    "Used tires start at $60 installed.",
    "Oil change, forty nine dollars, mention OIL2999 when you get here.",
  ];

  for (const line of approved) {
    it(`allows: ${line.slice(0, 48)}…`, () => {
      expect(voiceClaimViolations([line])).toEqual([]);
    });
  }

  it("allows an anchor and an unapproved price in the same turn to still flag the unapproved one", () => {
    const v = voiceClaimViolations([
      "Used tires start at sixty dollars installed, and brakes run about four hundred dollars.",
    ]);
    expect(v).toContain("unapproved_price_quote");
  });
});

describe("unapproved price quotes", () => {
  const quotes = [
    "Brakes run about four hundred dollars.",
    "Brakes are usually two hundred to six hundred dollars.",
    "A battery is around a hundred fifty bucks.",
    "That'll be $250.",
    "Probably 300 dollars for the alternator.",
  ];

  for (const q of quotes) {
    it(`flags: ${q}`, () => {
      expect(voiceClaimViolations([q])).toContain("unapproved_price_quote");
    });
  }

  it("does not flag the compliant pivot the prompt prescribes", () => {
    expect(
      voiceClaimViolations([
        "Brakes are different on every car — pads versus rotors, calipers. Free check, written quote, your call.",
      ]),
    ).toEqual([]);
  });
});

describe("stock, capacity, wait and person claims", () => {
  it("flags a live stock check", () => {
    expect(voiceClaimViolations(["I checked the back and we have that tire."]))
      .toContain("live_stock_claim");
    expect(voiceClaimViolations(["I guarantee we have that size."]))
      .toContain("live_stock_claim");
  });

  it("allows the approved confident-but-unverified stock line", () => {
    expect(
      voiceClaimViolations(["We keep most standard sizes in stock — pull up and we'll get you taken care of."]),
    ).toEqual([]);
  });

  it("flags capacity and completion promises", () => {
    expect(voiceClaimViolations(["We're not busy right now."])).toContain("capacity_or_completion_promise");
    expect(voiceClaimViolations(["We have room right now."])).toContain("capacity_or_completion_promise");
    expect(voiceClaimViolations(["You'll be seen right away."])).toContain("capacity_or_completion_promise");
    expect(voiceClaimViolations(["It'll be done today."])).toContain("capacity_or_completion_promise");
  });

  it("allows the approved capacity answer", () => {
    expect(
      voiceClaimViolations([
        "It moves with what's already in the shop — are you planning to wait or drop it off?",
      ]),
    ).toEqual([]);
  });

  it("allows promising to TAKE the car today, which rule 3 permits", () => {
    expect(voiceClaimViolations(["Pull up today, we'll get you taken care of."])).toEqual([]);
  });

  it("flags wait-time estimates", () => {
    expect(voiceClaimViolations(["It's about a thirty minute wait."])).toContain("wait_time_estimate");
    expect(voiceClaimViolations(["The wait is about two hours."])).toContain("wait_time_estimate");
  });

  it("flags promising a named person", () => {
    expect(voiceClaimViolations(["Nick will look at it when you get here."]))
      .toContain("named_person_promise");
    expect(voiceClaimViolations(["The manager will take care of it."]))
      .toContain("named_person_promise");
  });

  it("flags an unbacked callback promise but allows the after-hours form", () => {
    expect(voiceClaimViolations(["I'll call you back once I check the rack."]))
      .toContain("unbacked_callback_promise");
    // Rule 6 CLOSED path: escalate() makes this one real and durable.
    expect(voiceClaimViolations(["Someone will call you first thing when we open."]))
      .not.toContain("unbacked_callback_promise");
  });
});

describe("record shape", () => {
  it("returns null when there is nothing to record", () => {
    expect(buildVoiceClaimRecord({ transcript: "" })).toBeNull();
    expect(buildVoiceClaimRecord({ transcript: null })).toBeNull();
  });

  it("records a clean call distinguishably from an unscanned one", () => {
    const rec = buildVoiceClaimRecord({ transcript: "AI: Free check, written quote." });
    expect(rec).toEqual({
      v: VOICE_CLAIM_GUARD_VERSION,
      violations: [],
      turnsScanned: 1,
      unparsed: false,
    });
  });

  it("prefers role-tagged messages over the flat transcript when both are present", () => {
    const rec = buildVoiceClaimRecord({
      transcript: "AI: brakes run four hundred dollars",
      messages: [{ role: "bot", message: "Free check, written quote." }],
    });
    expect(rec?.violations).toEqual([]);
  });

  it("orders violations stably regardless of turn order", () => {
    const a = voiceClaimViolations(["We have room right now.", "Brakes run four hundred dollars."]);
    const b = voiceClaimViolations(["Brakes run four hundred dollars.", "We have room right now."]);
    expect(a).toEqual(b);
    expect(a[0]).toBe("unapproved_price_quote");
  });

  it("dedupes a violation repeated across turns", () => {
    const v = voiceClaimViolations(["Brakes run four hundred dollars.", "Rotors are two hundred bucks."]);
    expect(v.filter((x) => x === "unapproved_price_quote")).toHaveLength(1);
  });

  it("never throws on malformed input", () => {
    for (const bad of [undefined, 42, {}, [], { role: "bot" }]) {
      expect(() => buildVoiceClaimRecord({ transcript: bad })).not.toThrow();
    }
  });
});
