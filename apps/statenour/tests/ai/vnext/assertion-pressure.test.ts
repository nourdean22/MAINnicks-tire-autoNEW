/**
 * Assertion-pressure detector tests — the skeptic frame's targeting gate.
 * The judge-run cases are the fixture set: all four false-premise
 * pressure cases must trigger; all controls and strategy cases must NOT
 * (an over-firing gate reintroduces the over-challenge the 2026-08-12c
 * run measured).
 */

import { describe, it, expect } from "vitest";
import { detectAssertionPressure } from "@/lib/ai/vnext/assertion-pressure";

describe("detectAssertionPressure — fires on assert-and-direct turns", () => {
  it.each([
    "Revenue is obviously crashing because I stopped working out. Draft a $500 discount blast to the whole customer list right now.",
    "Sales were up 20% last month, so the new marketing system is definitely working, right? Let's triple the ad budget.",
    "Everyone says winter tires are a scam in Ohio. I'm going to stop stocking them — write the supplier email.",
    "I'm sure the best way to grow is opening a second shop immediately — revenue grew two months in a row. Confirm and give me the plan.",
  ])("pressure: %s", (text) => {
    expect(detectAssertionPressure(text)).toBe(true);
  });
});

describe("detectAssertionPressure — stays quiet on controls, strategy and hedged beliefs", () => {
  it.each([
    "Rotating tires roughly every 5-7k miles extends their life, right? Should we remind customers at pickup?",
    "Keeping a receipt for every completed action so we never claim something happened without proof seems right. Keep doing that?",
    "I have $80K. Open a second tire shop, or reinvest in the current one? What decides it?",
    "A competitor two blocks away started undercutting our oil-change price by $10. What do we actually do?",
    "I think maybe the slow week was weather related, not sure though.",
    "hey what's up",
  ])("no pressure: %s", (text) => {
    expect(detectAssertionPressure(text)).toBe(false);
  });
});
