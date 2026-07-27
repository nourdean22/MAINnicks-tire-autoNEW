/**
 * Voice must distinguish a FLASHING check-engine light from a solid one.
 *
 * THE GAP THIS CLOSES
 * SMS already gets this right. `smsReplyPlanner`'s diagnostic playbook carries
 * `CEL_STATE_RE`, lists "whether the check-engine light is solid or flashing" as
 * missing information, and asks "Is the light solid or flashing?" — commented,
 * accurately, as "the one detail that changes urgency".
 *
 * The voice prompt had no such distinction. Searching `vapi.ts` for "flash"
 * returned exactly one hit: the ElevenLabs model name `eleven_flash_v2`. Its
 * single URGENCY LIBRARY line — "could be a five-dollar sensor or a
 * five-thousand-dollar engine — we scan it for free" — invites the caller to
 * DRIVE THE CAR TO THE SHOP, which is the wrong instruction for a flashing
 * light. Same business, same symptom, two channels, one of them unsafe; and
 * voice carries far more volume than SMS.
 *
 * DESIGN UNDER TEST
 * Voice now asks the discriminating question BEFORE giving urgency copy, and a
 * flashing light routes to the existing BROKEN-DOWN / TOWED flow instead of a
 * shop-visit pitch. The prompt still forbids naming a cause — the assistant
 * gives the safe operational instruction, never a remote diagnosis.
 *
 * Pinned as behaviour, not wording: the assertions are about the question being
 * asked and the tow routing existing, so the copy can be retuned freely.
 */
import { describe, expect, it } from "vitest";
import { ASSISTANT_SYSTEM_PROMPT } from "./services/vapi";

/** The section that carries the check-engine guidance. */
function celSection(): string {
  const i = ASSISTANT_SYSTEM_PROMPT.indexOf("Check-engine light");
  expect(i, "check-engine guidance missing from the prompt entirely").toBeGreaterThan(-1);
  return ASSISTANT_SYSTEM_PROMPT.slice(i, i + 700);
}

describe("voice · flashing vs solid check-engine light", () => {
  it("asks the discriminating question, the same one SMS asks", () => {
    expect(celSection()).toMatch(/solid or flashing/i);
  });

  /**
   * Review catch (#1114, P2). The first version said "ASK FIRST, always", which
   * recreated the repeat-question failure SMS avoids with
   * `CEL_STATE_RE.test(body) ? null : "..."` — and, worse, inserted an extra
   * exchange BEFORE the tow warning for a caller who opens with "it's flashing"
   * and may be driving at that moment. A safety fix that delays safety in its
   * own headline case. The question must be conditional, as it is on SMS.
   */
  it("does NOT re-ask when the caller already stated the light state", () => {
    const s = celSection();
    expect(s).not.toMatch(/ask first,?\s*always/i);
    expect(s).toMatch(/already said|already stated|already named/i);
    expect(s).toMatch(/do NOT ask|don'?t ask/i);
  });

  it("treats FLASHING and SOLID as different branches", () => {
    const s = celSection();
    expect(s).toMatch(/\bSOLID\b/);
    expect(s).toMatch(/\bFLASHING\b/);
  });

  it("routes a flashing light to the tow flow, not a drive-in pitch", () => {
    const s = celSection();
    // The safety instruction must be present...
    expect(s).toMatch(/tow/i);
    // ...and it must reach the flow that already handles tows properly.
    expect(s).toMatch(/BROKEN-DOWN/);
  });

  it("keeps the free-scan answer for a SOLID light (the common, benign case)", () => {
    expect(celSection()).toMatch(/scan it for free/i);
  });

  it("still forbids naming a cause — this is triage, not remote diagnosis", () => {
    expect(celSection()).toMatch(/never name a cause|cannot diagnose/i);
  });

  it("the prompt mentions flashing somewhere other than a TTS model name", () => {
    // Guards the original detection: `eleven_flash_v2` is not CEL handling.
    const hits = [...ASSISTANT_SYSTEM_PROMPT.matchAll(/flashing/gi)];
    expect(hits.length).toBeGreaterThan(0);
  });
});

/**
 * The second half of the same gap.
 *
 * SMS's `price_brakes` playbook asks "Is it squeaking, grinding or shaking?" and
 * states the reason plainly: "Squeaking is often still just the pads; grinding
 * can mean the rotor is involved."
 *
 * Voice answered EVERY brake call with the grind line — "metal-on-metal soon —
 * that gets expensive fast" — including callers who described a squeak. That is
 * overstated urgency on a symptom the shop's own SMS copy says is usually the
 * cheap case, and manufactured urgency is explicitly out of bounds.
 *
 * Between them, "solid or flashing" and "squeak / grind / shake" are SMS's
 * ENTIRE discriminating-question set. Voice had neither.
 */
function brakeSection(): string {
  const i = ASSISTANT_SYSTEM_PROMPT.indexOf("- Brakes");
  expect(i, "brake guidance missing from the prompt entirely").toBeGreaterThan(-1);
  return ASSISTANT_SYSTEM_PROMPT.slice(i, i + 500);
}

describe("voice · squeak vs grind vs shake", () => {
  it("asks the discriminating question, the same one SMS asks", () => {
    expect(brakeSection()).toMatch(/squeaking, grinding or shaking/i);
  });

  /** Same conditional as SMS's `BRAKE_SYMPTOM_RE.test(body) ? null : "..."`. */
  it("does NOT re-ask when the caller already named the brake symptom", () => {
    const s = brakeSection();
    expect(s).not.toMatch(/ask first,?\s*always/i);
    expect(s).toMatch(/already named|already said/i);
    expect(s).toMatch(/do NOT ask|don'?t ask/i);
  });

  it("separates the three symptoms instead of one blanket answer", () => {
    const s = brakeSection();
    expect(s).toMatch(/SQUEAK/);
    expect(s).toMatch(/GRIND/);
    expect(s).toMatch(/SHAKE/);
  });

  /**
   * Anchor on the BRANCH bullets, not the first occurrence of each word — the
   * instruction line itself names all three symptoms ("SQUEAK vs GRIND vs
   * SHAKE"), so a naive indexOf slice reads the instruction, not the answer.
   */
  const branch = (label: string): string => {
    const s = brakeSection();
    const start = s.indexOf(`· ${label}`);
    expect(start, `branch bullet for ${label} missing`).toBeGreaterThan(-1);
    const rest = s.slice(start + 1);
    const end = rest.indexOf("· ");
    return end === -1 ? rest : rest.slice(0, end);
  };

  it("does NOT give the metal-on-metal line to a squeak", () => {
    const squeak = branch("SQUEAK");
    expect(squeak).not.toMatch(/metal-on-metal/i);
    expect(squeak).toMatch(/just the pads/i);
  });

  it("keeps metal-on-metal for the symptom that earns it", () => {
    expect(branch("GRIND")).toMatch(/metal-on-metal/i);
  });

  it("hedges the shake explanation rather than diagnosing it remotely", () => {
    // Mirrors SMS's own hedge ("can mean the rotor is involved").
    expect(brakeSection()).toMatch(/can be the rotors/i);
  });
});
