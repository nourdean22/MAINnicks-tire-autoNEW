/**
 * /api/brain/time-travel dates a day the way the operator lived it.
 *
 * THREE DATING DEFECTS, all the same frame error, all in one route:
 *
 *   1. `dayStart`/`dayEnd` were `${date}T00:00:00Z` / `T23:59:59Z` — UTC
 *      midnight is 8pm ET the PREVIOUS evening, so all ELEVEN queries in the
 *      route were shifted 4-5 hours and an ET evening landed on the NEXT day's
 *      snapshot.
 *   2. The default date was `new Date().toISOString().slice(0,10)` — the UTC
 *      date. Between 20:00 and 23:59 ET that is already TOMORROW, so an
 *      operator asking "what was in my head today" at 9pm got an empty
 *      next-day view.
 *   3. `emotional_state` was filtered by `createdAt`, but those keys embed the
 *      day they are ABOUT. Measured 2026-08-26: 170 rows imported in one
 *      5-minute window on 2026-08-16 carry keys spanning 2026-05-28 to
 *      2026-08-13 — 58 distinct days. All 170 surfaced on the 2026-08-16 view
 *      and never on the days they describe.
 *
 * WHY EACH ARM HAS A FRAME-DIFFERS CONTROL. "The ET bound is 04:00Z" is
 * vacuous on its own — it would also pass if the helper silently returned UTC
 * on a machine where the two agreed. So each arm additionally asserts the ET
 * answer DIFFERS from the naive UTC one. That is the lesson `check-et-clock`'s
 * canary encodes, applied here.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { startOfDayET, endOfDayET } from "@/lib/utils/datetime";

/** The route's anchor idiom: noon UTC is mid-day in ET for every date. */
const anchor = (date: string) => new Date(`${date}T12:00:00Z`);

describe("the day is the ET calendar day, not the UTC one", () => {
  it("EDT: a summer day runs 04:00Z to 04:00Z the next day", () => {
    const d = "2026-06-14";
    expect(startOfDayET(anchor(d)).toISOString()).toBe("2026-06-14T04:00:00.000Z");
    expect(endOfDayET(anchor(d)).toISOString()).toBe("2026-06-15T04:00:00.000Z");
  });

  it("EST: a winter day runs 05:00Z to 05:00Z — the offset is not hardcoded", () => {
    const d = "2026-01-15";
    expect(startOfDayET(anchor(d)).toISOString()).toBe("2026-01-15T05:00:00.000Z");
    expect(endOfDayET(anchor(d)).toISOString()).toBe("2026-01-16T05:00:00.000Z");
  });

  it("FRAME DIFFERS: the ET bound is NOT the UTC bound", () => {
    // Without this the two assertions above would also pass for a helper that
    // silently returned UTC midnight. This is what makes them mean something.
    const d = "2026-06-14";
    const utcMidnight = new Date(`${d}T00:00:00Z`).getTime();
    expect(startOfDayET(anchor(d)).getTime()).not.toBe(utcMidnight);
    expect(startOfDayET(anchor(d)).getTime() - utcMidnight).toBe(4 * 60 * 60 * 1000);
  });

  it("the ET day contains the ET evening that the UTC day pushed into tomorrow", () => {
    // 22:00 ET on 2026-06-14 is 02:00Z on the 15th. The old UTC bounds put it
    // in the NEXT day's snapshot; the ET bounds keep it where it happened.
    const d = "2026-06-14";
    const tenPmET = new Date("2026-06-15T02:00:00Z");
    expect(tenPmET >= startOfDayET(anchor(d)) && tenPmET < endOfDayET(anchor(d))).toBe(true);
    expect(tenPmET < new Date(`${d}T23:59:59Z`), "the old UTC bound excluded it").toBe(false);
  });
});

describe("the route uses those bounds, and dates emotional_state by KEY", () => {
  const src = () => readFileSync("app/api/brain/time-travel/route.ts", "utf8");

  it("no UTC day literal survives", () => {
    // Assert the INVOCATION, not the identifier: matching "startOfDayET"
    // anywhere would also match the import line and stay green after a revert.
    const s = src();
    expect(s).toMatch(/const dayStart = startOfDayET\(anchor\)/);
    expect(s).toMatch(/const dayEnd = endOfDayET\(anchor\)/);
    expect(s, "a UTC day literal came back").not.toMatch(/T00:00:00Z`\)\s*;/);
    expect(s, "a UTC end-of-day literal came back").not.toMatch(/T23:59:59Z/);
  });

  it("the upper bound is EXCLUSIVE everywhere — endOfDayET is the next day's start", () => {
    const s = src();
    expect(s, "an inclusive bound against an exclusive value double-counts a day boundary").not.toContain(
      "lte: dayEnd",
    );
    // Relational, not a magic number. A hardcoded count is a cache with no
    // invalidation — this arm was first written as ">= 11" and went red the
    // moment the emotional_state query stopped using the range at all. Every
    // lower bound must have exactly one upper bound; that stays true however
    // many queries the route grows or sheds.
    const lower = (s.match(/gte: dayStart/g) ?? []).length;
    const upper = (s.match(/lt: dayEnd/g) ?? []).length;
    expect(lower, "the route no longer bounds anything by day").toBeGreaterThan(0);
    expect(upper, "a day range is missing its exclusive upper bound").toBe(lower);
  });

  it("the default date is the ET today, not the UTC one", () => {
    expect(src()).toMatch(/searchParams\.get\("date"\) \?\? today\(\)/);
  });

  it("emotional_state is selected by the date in its KEY", () => {
    const s = src();
    const block = s.slice(s.indexOf('category: "emotional_state"'));
    expect(block.slice(0, 1400)).toMatch(/key: \{ contains: date \}/);
    expect(
      block.slice(0, block.indexOf("take: 5")),
      "a createdAt filter on emotional_state re-introduces the backfill mis-dating",
    ).not.toMatch(/createdAt: \{ gte: dayStart/);
  });
});

describe("the key-dating assumption holds at the WRITERS", () => {
  // The route filters emotional_state by `key contains <date>`. That is total
  // ONLY while every emotional_state key embeds a date — measured true for all
  // 329 live rows on 2026-08-26. Pinning it here rather than in the DB, so a
  // future undated key fails loudly instead of silently vanishing from every
  // day view.
  function emotionalStateRememberKeys(): Array<{ file: string; key: string }> {
    const files = execFileSync("git", ["ls-files", "--", "lib", "app"], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    })
      .split("\n")
      .map((l) => l.trim())
      .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));

    const out: Array<{ file: string; key: string }> = [];
    for (const file of files) {
      let text: string;
      try {
        text = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      let i = text.indexOf('"emotional_state",');
      while (i !== -1) {
        // The KEY is the argument immediately after the category.
        const after = text.slice(i, i + 400).split("\n");
        const keyLine = after[1] ?? "";
        if (keyLine.includes("`")) out.push({ file, key: keyLine.trim() });
        i = text.indexOf('"emotional_state",', i + 1);
      }
    }
    return out;
  }

  it("finds the emotional_state writers at all", () => {
    // Positive control — a scanner matching nothing would make the arm below
    // pass vacuously, which is the failure mode this file exists to prevent.
    expect(emotionalStateRememberKeys().length).toBeGreaterThan(0);
  });

  it("every emotional_state key embeds a date", () => {
    const undated = emotionalStateRememberKeys()
      .filter((k) => !/\$\{(today\(\)|dateStr)\}/.test(k.key))
      .map((k) => `${k.file}: ${k.key}`);
    expect(
      undated,
      `these emotional_state keys carry no date, so /api/brain/time-travel cannot place them on a day: ${undated.join(" | ")}`,
    ).toEqual([]);
  });
});
