/**
 * Payment Programs provider roster (operator 2026-10-18: Kafene added and featured first).
 *
 * Pins the order the /financing page renders (FINANCING_PROVIDERS.map), the canonical name list
 * every other surface reads (BUSINESS.financing.providers), and that the counted copy agrees
 * with the roster, so adding or removing a provider cannot leave "four providers" behind.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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

// Review of PR 1 (2026-10-18) and Codex on PR #3148: copy outside shared/financing.ts still said
// "4 providers", "four payment programs" or "none of the four", or listed the four names without
// Kafene. Two scans: a stale COUNT anywhere in server/, shared/ and scripts/ (comments skipped),
// and a roster LIST without Kafene in the files that hand-write the names.
describe("hand-written provider copy agrees with the roster", () => {
  const APP = join(__dirname, "..");
  const COUNT = /\b(four|4)\b(\s+(different|third-party|payment(-program)?))*\s+(providers?|payment programs?|programs?)\b|\bnone of the four\b|\bof the four (providers?|programs?|payment)/i;
  const LIST = /(?<!Kafene[^.\n]{0,25})\bAcima( lease-to-own)?\s*[,·]\s*(Koalafi|Snap)/i;
  const LIST_FILES = [
    "shared/blog.ts",
    "shared/guides.ts",
    "shared/cities.ts",
    "server/gemini.ts",
    "server/services/adStudio/adCopyGen.ts",
    "server/services/chatTools.ts",
    "server/services/gbpContentGenerator.ts",
    "server/routers/voiceAgent.ts",
    // Codex round 2 on #3148: the customer SMS planner still listed four names.
    ...readdirSync(join(APP, "server/services"))
      .filter((n) => /^sms.*\.ts$/.test(n) && !/\.test\./.test(n))
      .map((n) => `server/services/${n}`),
  ];
  const isComment = (l: string) => /^\s*(\/\/|\*|\/\*)/.test(l);

  it("the roster scan covers the customer SMS files", () => {
    expect(LIST_FILES).toEqual(expect.arrayContaining(["server/services/smsReplyPlanner.ts", "server/services/smsIntentRouter.ts"]));
  });
  const read = (rel: string) => readFileSync(join(APP, rel), "utf8");
  function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(join(APP, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name !== "node_modules" && e.name !== "__tests__" && e.name !== "fixtures") sourceFiles(rel, out);
      } else if (/\.(ts|tsx|mjs|cjs|js)$/.test(e.name) && !/\.test\.|\.spec\./.test(e.name)) out.push(rel);
    }
    return out;
  }

  it("canary: the patterns catch each stale shape they exist for, and pass the fixed wording", () => {
    for (const bad of [
      "accept four payment-program providers", "How the 4 payment programs work", "discount: \"4 providers\"",
      "all 4 payment providers review applications", "None of the four can promise approval", "four different payment-program providers",
      "Highest published cap of the four providers",
    ]) expect(COUNT.test(bad), bad).toBe(true);
    for (const bad of ["through Acima, Koalafi, Snap", "Acima · Snap Finance", "programs: Acima, Snap Finance, Koalafi and American First Finance"]) {
      expect(LIST.test(bad), bad).toBe(true);
    }
    for (const good of ["five payment programs", "5 providers", "None of the five", "four columns", "of the four ordered elements", "Format 4: Third-party"]) {
      expect(COUNT.test(good), good).toBe(false);
    }
    for (const good of ["through Kafene, Acima, Koalafi", "Kafene · Acima · Snap", "Kafene (lease-to-own), Acima, Snap"]) {
      expect(LIST.test(good), good).toBe(false);
    }
  });

  it("the count scan reads the real tree (an empty walk would pass vacuously)", () => {
    const files = [...sourceFiles("server"), ...sourceFiles("shared"), ...sourceFiles("scripts")];
    expect(files.length).toBeGreaterThan(300);
    expect(files).toContain("server/services/chatTools.ts");
    expect(files).toContain("shared/guides.ts");
  });

  it("no non-comment line in server/, shared/ or scripts/ counts four providers", () => {
    const hits: string[] = [];
    for (const rel of [...sourceFiles("server"), ...sourceFiles("shared"), ...sourceFiles("scripts")]) {
      read(rel).split("\n").forEach((l, i) => {
        if (!isComment(l) && COUNT.test(l)) hits.push(`${rel}:${i + 1}: ${l.trim().slice(0, 120)}`);
      });
    }
    expect(hits).toEqual([]);
  });

  for (const rel of LIST_FILES) {
    it(`${rel} names no roster without Kafene`, () => {
      const hits = read(rel).split("\n").filter((l) => !isComment(l) && LIST.test(l)).map((l) => l.trim().slice(0, 120));
      expect(hits).toEqual([]);
    });
  }
});