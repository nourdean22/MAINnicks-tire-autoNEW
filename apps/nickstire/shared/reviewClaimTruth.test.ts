/**
 * No shipped copy may pair a review COUNT with "five-star".
 *
 * The count the site shows (1,710+, reviewCountDisplay, totalReviews) is the
 * TOTAL Google review count across every star rating — the average is ~4.9,
 * not 5.0 — so "1,710+ five-star reviews" overstates. Until 2026-09-29 that
 * sentence shipped in city pages, a meta description, the service x city
 * combinator, the tire finder and the homepage headline (spelled
 * `five&#8209;star` there, which a naive grep for "five-star" misses).
 *
 * True alternatives: "1,710+ Google reviews", "4.9 stars across 1,710+ Google
 * reviews". A "five-star" phrase with NO count (e.g. above cards that really
 * are all 5-star) is fine and not matched.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const APP_ROOT = resolve(__dirname, "..");
const SCAN_DIRS = ["shared", "client/src/pages", "client/src/components"];

// A count: 1,710 / 1,710+ / {expr} / ${expr} / thousands|hundreds|dozens (of).
const COUNT = String.raw`(?:\d[\d,]*\+?|\$?\{[^{}\n]*\}\+?|thousands|hundreds|dozens)`;
// "five-star" in every spelling seen or plausible in source: ASCII hyphen,
// U+2011 non-breaking hyphen (literal or escaped), HTML entities, space, none.
const HYPHEN = String.raw`(?:-|‑|\\u2011|&#8209;|&#x2011;|&nbsp;|\s)?`;
const FIVE_STAR = String.raw`(?:five|5)${HYPHEN}stars?`;
const COUNTED_FIVE_STAR = new RegExp(`${COUNT}(?:\\s+of)?\\s+${FIVE_STAR}`, "i");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

function violations(): string[] {
  const hits: string[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of walk(join(APP_ROOT, dir))) {
      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        const m = line.match(COUNTED_FIVE_STAR);
        if (m) hits.push(`${relative(APP_ROOT, file)}:${i + 1}: ${m[0]}`);
      });
    }
  }
  return hits;
}

describe("review count claims", () => {
  it("the matcher catches every planted spelling (positive control)", () => {
    const planted = [
      "Brakes, tires. 1,710+ five-star reviews. (216)",
      "earned us a 4.9-star rating and over 1,710 five-star reviews.",
      "{totalReviews.toLocaleString()}+ five&#8209;star reviews.",
      "Real mechanics. {reviewCountDisplay} five-star reviews.",
      "`${count} 5-star reviews`",
      "1,710+ five‑star Google reviews",
      "1,710+ five\\u2011star reviews",
      "thousands of five-star reviews",
      "1710 5 star reviews",
    ];
    for (const p of planted) expect(p, p).toMatch(COUNTED_FIVE_STAR);
  });

  it("the matcher leaves true claims alone (negative control)", () => {
    const fine = [
      "4.9 stars across 1,710+ Google reviews.",
      "{totalReviews.toLocaleString()}+ Google reviews.",
      "a 4.9-star rating across more than 1,710 Google reviews",
      "That is how we have earned 5-star reviews from Cleveland drivers",
      "award-winning / highly-rated / five-star + noun",
    ];
    for (const f of fine) expect(f, f).not.toMatch(COUNTED_FIVE_STAR);
  });

  it("no shipped copy pairs a review count with five-star", () => {
    expect(violations()).toEqual([]);
  });
});
