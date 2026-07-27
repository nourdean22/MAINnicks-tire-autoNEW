/**
 * Wave A of the phrasing sweep — the misses that survived #1134.
 *
 * All eleven were verified by EXECUTION in a 15-agent coverage audit, and every
 * one has the same shape: the pattern has no slot for an ordinary auxiliary,
 * copula, or reversed word order between subject and verb. None is a missing
 * vocabulary word.
 *
 * What makes these worth their own pass is where the misses LAND (see #1134):
 * `price_brakes` / `price_tires` / `diagnostic` are risk:"deterministic", so a
 * phrasing the safety layer misses is not merely unanswered — the orchestrator
 * auto-sends a canned price template over it.
 *
 * Two of the five fixes were sitting next to their own answer:
 *   · the `steam` pattern lacked the copula slot that the coolant pattern
 *     THREE LINES BELOW documents in a comment ("The copula is optional").
 *   · the smoke rule accepts hood|engine|dash|dashboard|wheel|car on one line
 *     and hood|engine|dash|dashboard on the next — one word list, two lines
 *     apart, out of sync. "my car is smoking" raised no flag.
 */
import { describe, expect, it } from "vitest";
import { detectRedFlags } from "./diagnose-safety";

const flags = (s: string) => detectRedFlags(s).map((f) => (f as { id?: string }).id);

describe("a copula does not hide an emergency", () => {
  it.each([
    ["steam is pouring out of the hood", "overheating"],
    ["steam is coming from the engine", "overheating"],
    // "oil light is on" belongs HERE, not in the false-positive block below.
    // I put it there first and the test caught me: an oil-pressure light means
    // imminent engine destruction, and this file already treated it as a red
    // flag before today. The guard block is for HARMLESS sentences.
    ["oil light is on", "oil-pressure"],
    ["oil light started flashing", "oil-pressure"],
    ["oil light keeps flashing", "oil-pressure"],
    ["steering got loose", "steering-loss"],
    ["the steering is getting loose", "steering-loss"],
  ])("%s -> %s", (text, id) => {
    expect(flags(text)).toContain(id);
  });
});

describe("the smoke noun list is consistent across both of its lines", () => {
  it.each([
    "my car is smoking",
    "the wheel is smoking",
    "the hood is smoking",
    "smoke is pouring from under the hood",
  ])("%s", (text) => {
    expect(flags(text)).toContain("fire-smoke");
  });
});

describe("an adverb works on either side of its verb", () => {
  it.each([
    "the car shakes violently",
    "it vibrates violently at speed",
    "violently shaking at 60",
  ])("%s", (text) => {
    expect(flags(text)).toContain("control-loss");
  });
});

/**
 * The other half. Every widening above is only correct if ordinary, harmless
 * sentences still raise nothing — a false red flag tells a customer their car
 * is undriveable and costs the shop the visit.
 */
describe("ordinary sentences still raise no flag", () => {
  it.each([
    "steering feels tight",
    "how much to check a wheel bearing",
    "do you steam clean engine bays",
    "the ride is smooth now, thanks",
    "no smoke at all anymore",
  ])("%s", (text) => {
    expect(flags(text)).toEqual([]);
  });
});
