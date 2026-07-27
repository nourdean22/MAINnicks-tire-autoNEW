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
