/**
 * Canaries for review-key stability (finding 9, 2026-08-23).
 *
 * The defect: both review-ingest sites derived their dedup key as
 *   `review.time?.toString() || `${author}_${Date.now()}``
 * and used it as an existence check. With no provider timestamp the key was a
 * new identity every pass, so the check could never match and the same review
 * would be re-inserted, re-dispatched to the event bus and re-counted toward
 * the low-rating alert every 6 hours.
 *
 * HONESTY: this never fired in production. Measured 2026-08-23 - review_replies
 * held 7 rows, 7 distinct review_ids, 0 timestamp-suffixed. These canaries
 * guard an unproven trigger, which is worth saying out loud so nobody later
 * reads them as evidence of damage that occurred.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

import { stableReviewId, NO_TIME_PREFIX } from "./lib/reviewIdentity";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf-8");

describe("canary - review identity is stable across runs", () => {
  it("BREAKS: the same timestamp-less review yields the SAME id on every call", () => {
    // This is the whole defect. Under the old expression these two calls
    // differed by Date.now() and the dedup check could never match.
    const review = { author_name: "Dana R.", text: "Fast honest work on my brakes." };
    const a = stableReviewId(review);
    const b = stableReviewId(review);
    expect(a).toBe(b);
    expect(a.startsWith(NO_TIME_PREFIX)).toBe(true);
  });

  it("contains no timestamp - the literal marker the old key left behind", () => {
    const id = stableReviewId({ author_name: "Dana R.", text: "x" });
    // A 13-digit run is a millisecond epoch. The prod probe counted exactly
    // this pattern in review_replies to prove the defect had never fired.
    expect(id).not.toMatch(/\d{13}/);
  });

  it("different reviews get different ids", () => {
    const one = stableReviewId({ author_name: "Dana R.", text: "Brakes." });
    const two = stableReviewId({ author_name: "Dana R.", text: "Tires." });
    const three = stableReviewId({ author_name: "Sam P.", text: "Brakes." });
    expect(new Set([one, two, three]).size).toBe(3);
  });

  // --- Backwards compatibility: the 7 live rows must not be orphaned -------

  it("a review WITH a timestamp keys exactly as before", () => {
    // The live rows are keyed by the Unix-second string. Any change here
    // orphans all of them and re-inserts every one as new.
    expect(stableReviewId({ time: 1755900000, author_name: "x", text: "y" })).toBe("1755900000");
  });

  it("time === 0 still yields \"0\", as the old truthy-string quirk did", () => {
    // `0?.toString()` is "0", which is truthy, so the old `||` never fired for
    // a zero timestamp. Preserved deliberately.
    expect(stableReviewId({ time: 0 })).toBe("0");
  });

  it("a string timestamp is stringified, not rejected", () => {
    // `reviews` is typed any[]; the old code called .toString() on whatever
    // arrived. A stricter typeof check here would re-key existing rows.
    expect(stableReviewId({ time: "1755900000" })).toBe("1755900000");
  });

  it("an empty-string timestamp falls through, as the old `||` did", () => {
    expect(stableReviewId({ time: "", author_name: "a", text: "b" }))
      .toBe(stableReviewId({ author_name: "a", text: "b" }));
  });

  it("null and undefined both fall through to the content hash", () => {
    const base = stableReviewId({ author_name: "a", text: "b" });
    expect(stableReviewId({ time: null, author_name: "a", text: "b" })).toBe(base);
    expect(stableReviewId({ time: undefined, author_name: "a", text: "b" })).toBe(base);
  });

  it("missing author and text still produce a stable id, not a crash", () => {
    expect(stableReviewId({})).toBe(stableReviewId({}));
  });

  // --- Both call sites actually use it (built-tested-unwired guard) --------

  it("BOTH ingest sites use the shared derivation, with no Date.now() key left", () => {
    // A shared helper that one site ignores is the built-tested-unwired shape.
    for (const rel of ["server/cron/jobs/reviewMonitor.ts", "server/routers/reviewReplies.ts"]) {
      const src = read(rel);
      expect(src, `${rel} must call the shared helper`).toContain("stableReviewId(review)");
      expect(src, `${rel} must import it`).toContain("reviewIdentity");
      // The exact old expression must be gone.
      expect(src, `${rel} still derives a key from Date.now()`).not.toMatch(
        /review\.time\?\.toString\(\)\s*\|\|/,
      );
    }
  });

  it("no source file in the review path contains a NUL byte", () => {
    // The first draft of reviewIdentity.ts had a NUL where a space belonged in
    // a template literal. It compiled, and made the whole file read as BINARY
    // to grep and to every text-scanning lint in `verify` - a scan that cannot
    // read a file reports the same green as a scan that found nothing.
    for (const rel of [
      "server/lib/reviewIdentity.ts",
      "server/cron/jobs/reviewMonitor.ts",
      "server/routers/reviewReplies.ts",
    ]) {
      // Referenced via String.fromCharCode(0) so neither this file nor the
      // assertion itself ever contains the byte - writing it literally is
      // exactly how the corruption spread into the first draft.
      expect(read(rel).includes(String.fromCharCode(0)), `${rel} contains a NUL byte`).toBe(false);
    }
  });
});
