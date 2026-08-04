/**
 * providerErrorParse.test.ts · 2026-08-04
 *
 * Two defects in the stamp round-trip, both measured rather than assumed.
 *
 * 1. THE 160-CHAR SLICE. ActionCenter renders `lastError.slice(0, 160)`, but the
 *    stamp is "[CLASS] <reason> :: " and the reason is a per-class CONSTANT.
 *    Measured across all 11 classes: LOCAL_TIMEOUT_REMOTE_UNKNOWN's prefix is 176
 *    characters and SAFETY_POLICY_PERMANENT's is 175 — each longer than the whole
 *    slice — so for those two the operator saw boilerplate and ZERO characters of
 *    the provider's actual message. STORAGE_OR_ASSEMBLY left 13.
 *    LOCAL_TIMEOUT_REMOTE_UNKNOWN is the ONLY class with mayDoubleSpend: true.
 *
 * 2. THE UNSOUND CAST. parseErrorClass cast the captured token straight to
 *    ProviderErrorClass without checking membership. `reel_jobs.error` is a MIXED
 *    column — only the generation stage stamps it — so raw provider text starting
 *    with a bracketed word came back as a class that is not in the union.
 */
import { describe, expect, it } from "vitest";

import {
  PROVIDER_ERROR_CLASSES,
  classifyProviderError,
  parseErrorClass,
  parseErrorMessage,
  stampError,
} from "./providerErrors";

describe("stamp round-trip is exact for every class", () => {
  it("every class stamps and parses back to itself", () => {
    for (const cls of PROVIDER_ERROR_CLASSES) {
      const verdict = { errorClass: cls, reason: "r", action: "RETRY_BACKOFF", consumesAttempt: true, mayDoubleSpend: false } as never;
      expect(parseErrorClass(stampError(verdict, "provider said something")), cls).toBe(cls);
    }
  });

  it("recovers the provider message, not the boilerplate", () => {
    const verdict = classifyProviderError(new Error("HTTP 403 permission denied"));
    const stamped = stampError(verdict, "the provider's own words");

    expect(parseErrorMessage(stamped)).toBe("the provider's own words");
  });

  /**
   * The measurement that motivated the change, pinned so a longer reason cannot
   * silently re-bury the message.
   */
  /**
   * The measurement that motivated the change. Uses a REAL verdict — the reasons
   * are long per-class constants and are not exported, so a hand-written stub
   * would make the stamp short and the test would pass against the old code.
   * That is exactly the mistake this file caught in its own first draft.
   */
  it("the message survives a 160-char slice where slicing the stamp destroys it", () => {
    const verdict = classifyProviderError(new Error("Veo submit failed: blocked by responsible AI filters"));
    expect(verdict.errorClass, "fixture no longer classifies as expected").toBe("SAFETY_POLICY_PERMANENT");

    const stamped = stampError(verdict, "THE ACTUAL PROVIDER COMPLAINT");

    // Measured: this class's "[CLASS] <reason> :: " prefix is 175 chars — longer
    // than the whole slice — so the old render showed boilerplate and none of it.
    expect(stamped.indexOf("THE ACTUAL PROVIDER COMPLAINT")).toBeGreaterThan(160);
    expect(stamped.slice(0, 160)).not.toContain("THE ACTUAL PROVIDER COMPLAINT");

    // The new render spends all 160 characters on the part that differs per job.
    expect(String(parseErrorMessage(stamped)).slice(0, 160)).toContain("THE ACTUAL PROVIDER COMPLAINT");
  });

});

describe("parseErrorClass validates instead of casting", () => {
  /**
   * reel_jobs.error is written by five places and only ONE of them stamps. These
   * are the shapes the other four actually produce.
   */
  const unstamped = [
    "[ERROR] ffmpeg exited with code 1",
    "[FATAL] something the provider said",
    "discarded by operator: dddddd",
    "BUDGET_DAILY_EXCEEDED: over the ceiling",
  ];

  for (const raw of unstamped) {
    it(`returns null — not a fake class — for ${JSON.stringify(raw.slice(0, 28))}`, () => {
      const parsed = parseErrorClass(raw);
      expect(parsed).toBeNull();
      // The direction matters: a bogus token typed as ProviderErrorClass makes
      // every Record<ProviderErrorClass, _> lookup read undefined, so the lie
      // surfaces as a blank rather than an error.
      if (parsed !== null) expect(PROVIDER_ERROR_CLASSES).toContain(parsed);
    });
  }

  it("still returns the raw text as the message when there is no stamp", () => {
    // Unstamped writers must keep rendering, so the fallback is not "nothing".
    expect(parseErrorMessage("discarded by operator: dddddd")).toBe("discarded by operator: dddddd");
  });

  it("handles null and empty without throwing", () => {
    expect(parseErrorClass(null)).toBeNull();
    expect(parseErrorClass(undefined)).toBeNull();
    expect(parseErrorMessage(null)).toBeNull();
    expect(parseErrorMessage("")).toBeNull();
  });

  it("PROVIDER_ERROR_CLASSES is derived from POLICY, so it cannot drift", () => {
    // Every class the taxonomy can produce must be recognised by the parser.
    for (const cls of PROVIDER_ERROR_CLASSES) {
      expect(parseErrorClass(`[${cls}] reason :: msg`)).toBe(cls);
    }
    expect(PROVIDER_ERROR_CLASSES.length).toBeGreaterThanOrEqual(11);
  });
});
