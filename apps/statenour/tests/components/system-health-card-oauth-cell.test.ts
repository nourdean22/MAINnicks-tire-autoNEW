/**
 * The card's google-oauth cell has three states, not two.
 *
 * #1348 made the DIGEST distinguish "the token is expired" from "the status
 * read itself failed" (probeFailed), but the card collapsed them back:
 * `stats.googleOauth ? "ok" : "expired"` rendered a failed probe as the
 * literal word "expired" — the exact claim that arc set out to stop making.
 * The consumer branch is pinned here; the producer (stats.googleOauthProbeFailed)
 * is pinned in tests/lib/health-digest-counts.test.ts.
 */
import { describe, expect, it } from "vitest";

import { googleOauthCell } from "@/components/ultron/system-health-card";

describe("googleOauthCell", () => {
  it("probe failure renders unknown — never expired", () => {
    const cell = googleOauthCell({ googleOauth: false, googleOauthProbeFailed: true });
    expect(cell.value).toBe("unknown");
    expect(cell.value).not.toBe("expired");
    expect(cell.warn).toBe(true);
  });

  it("a real expiry still says expired — both directions hold", () => {
    expect(googleOauthCell({ googleOauth: false, googleOauthProbeFailed: false })).toEqual({
      value: "expired",
      warn: true,
    });
  });

  it("healthy token says ok with no warn", () => {
    expect(googleOauthCell({ googleOauth: true })).toEqual({ value: "ok", warn: false });
  });

  it("digests persisted before the flag existed keep their old rendering", () => {
    expect(googleOauthCell({ googleOauth: false })).toEqual({ value: "expired", warn: true });
  });
});
