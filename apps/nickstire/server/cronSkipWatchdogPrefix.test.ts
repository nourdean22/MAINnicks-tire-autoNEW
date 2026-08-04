/**
 * cronSkipWatchdogPrefix.test.ts · 2026-08-03
 *
 * `cronSkipWatchdog` is the only alarm for "a config flag disappeared and a cron
 * has been quietly declining to run ever since". It matched the literal string
 * `requiresEnv:` in cron_log.details.
 *
 * But the scheduler has TWO gates. The original `requiresEnv` (presence) emits
 * `requiresEnv:KEY`. The newer strict `requiresFlag` emits `requiresFlag:KEY (why)`
 * from `unarmedFlagReason` — and `requiresFlag` is what guards the entire reel and
 * social PUBLISHING pipeline. So the publishing jobs were invisible to the one
 * watchdog that exists for them.
 *
 * Not hypothetical: a Railway variable for that pipeline was deleted on
 * 2026-08-03, and a `variable delete` does not restart the container. Had it been
 * REEL_GENERATION_ENABLED, reels would have gone dark with no alarm from anywhere
 * — the failure observer only counts status='failed', and an unarmed job logs
 * 'skipped'.
 *
 * These tests pin the matcher against BOTH strings that the scheduler can actually
 * write, using the real emitter rather than a hand-copied literal.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { unarmedFlagReason } from "./cron/scheduler";

const watchdogSource = readFileSync(
  resolve(process.cwd(), "server/cron/jobs/cronSkipWatchdog.ts"),
  "utf8",
);

/** The two patterns the watchdog uses, lifted from the file it will actually run. */
const DETECT = /requires\(Env\|Flag\):/;
const EXTRACT = /requires\(\?:Env\|Flag\):\(\[A-Z0-9_\]\+\)/;

describe("the skip watchdog sees both scheduler gates", () => {
  it("still matches the original requiresEnv: prefix", () => {
    const detail = "Skipped · requiresEnv:SOME_KEY";

    expect(/requires(Env|Flag):/.test(detail)).toBe(true);
    expect(detail.match(/requires(?:Env|Flag):([A-Z0-9_]+)/)?.[1]).toBe("SOME_KEY");
  });

  /**
   * Built from the REAL emitter, not a copied string — if unarmedFlagReason ever
   * changes its wording, this test changes with it instead of quietly passing
   * against a stale literal. That is the mistake the watchdog itself made.
   */
  it("matches what unarmedFlagReason actually emits for an unset flag", () => {
    const detail = unarmedFlagReason("REEL_GENERATION_ENABLED", undefined);

    expect(detail).not.toBeNull();
    expect(/requires(Env|Flag):/.test(detail!)).toBe(true);
    expect(detail!.match(/requires(?:Env|Flag):([A-Z0-9_]+)/)?.[1]).toBe("REEL_GENERATION_ENABLED");
  });

  it("matches a flag set to the WRONG value, not just an absent one", () => {
    // The trap this repo already carries: a flag set to "1" or "yes" reads as
    // armed to a truthiness gate but unarmed to the strict one.
    const detail = unarmedFlagReason("REEL_AUTOPOST_ENABLED", "1");

    expect(detail).not.toBeNull();
    expect(detail!.match(/requires(?:Env|Flag):([A-Z0-9_]+)/)?.[1]).toBe("REEL_AUTOPOST_ENABLED");
  });

  it("returns null — no alarm — when the flag is correctly armed", () => {
    expect(unarmedFlagReason("REEL_GENERATION_ENABLED", "true")).toBeNull();
  });

  /**
   * Guards the fix itself. If someone narrows the matcher back to requiresEnv,
   * the publishing pipeline goes silently unwatched again and every test above
   * would still pass, because they exercise the regex literal rather than the file.
   */
  it("the watchdog source uses the both-prefix matcher", () => {
    expect(watchdogSource).toMatch(DETECT);
    expect(watchdogSource).toMatch(EXTRACT);
    expect(watchdogSource).not.toMatch(/includes\("requiresEnv:"\)/);
  });
});
