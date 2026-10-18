/**
 * Payment Programs provider roster (operator 2026-10-18: Kafene added and featured first).
 *
 * Pins the order the /financing page renders (FINANCING_PROVIDERS.map), the canonical name list
 * every other surface reads (BUSINESS.financing.providers), and that the counted copy agrees
 * with the roster, so adding or removing a provider cannot leave "four providers" behind.
 */
import { describe, expect, it } from "vitest";
import { BUSINESS } from "./business";
import {
  FINANCING_FAQ,
  FINANCING_PROVIDERS,
  PAYMENT_METHODS,
  PAYMENT_PROGRAMS_FAQ_ANSWER,
  PAYMENT_PROGRAMS_SHORT,
} from "./financing";

const COUNT_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

describe("payment programs roster", () => {
  it("Kafene is first, with the operator's exact application link", () => {
    expect(FINANCING_PROVIDERS.map((p) => p.id)).toEqual(["kafene", "acima", "snap", "koalafi", "american-first"]);
    const kafene = FINANCING_PROVIDERS[0];
    expect(kafene.name).toBe("Kafene");
    expect(kafene.applyUrl).toBe("https://gokafene.com/nKVEWWv");
    expect(kafene.type).toBe("lease_to_own");
  });

  it("the canonical name list leads with Kafene and matches the roster length", () => {
    expect(BUSINESS.financing.providers[0]).toBe("Kafene");
    expect(BUSINESS.financing.providers).toHaveLength(FINANCING_PROVIDERS.length);
  });

  it("every counted line states the real number of providers", () => {
    const n = COUNT_WORDS[FINANCING_PROVIDERS.length];
    expect(BUSINESS.financing.display.toLowerCase()).toContain(`${n} providers`);
    expect(PAYMENT_PROGRAMS_FAQ_ANSWER.toLowerCase()).toContain(`${n} third-party payment programs`);
    // the stale count is gone (control: the assertion above is about the same strings)
    expect(`${BUSINESS.financing.display} ${PAYMENT_PROGRAMS_FAQ_ANSWER}`.toLowerCase()).not.toMatch(/\bfour (providers|third-party)/);
  });

  it("every provider-listing line names Kafene first", () => {
    expect(PAYMENT_PROGRAMS_SHORT).toMatch(/through Kafene, /);
    expect(PAYMENT_PROGRAMS_FAQ_ANSWER).toMatch(/programs: Kafene /);
    expect(FINANCING_FAQ[0].a).toMatch(/^No\. Kafene, Acima/);
    expect(PAYMENT_METHODS.findIndex((m) => m.startsWith("Kafene"))).toBe(4);
  });

  it("Kafene's customer-facing copy makes no claim the other records do not, and never says financing", () => {
    const k = FINANCING_PROVIDERS[0];
    const copy = [k.typeLabel, k.highlight, k.maxAmount, k.approvalTime, k.creditCheck, k.termRange,
      ...k.features, k.description, ...k.howItWorks, k.idealFor, k.badge, k.disclosure].join(" ");
    expect(copy).not.toMatch(/financ/i);
    expect(copy).not.toMatch(/\$\d|\d+%|guarantee[ds]? approval|no credit check|instant/i);
  });
});
