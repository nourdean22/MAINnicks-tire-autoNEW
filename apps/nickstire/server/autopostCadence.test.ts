/**
 * The cap counted this door but could not stop it.
 *
 * #1129 taught the content governor to COUNT `ig_autopost_log`, so the
 * autoposter finally consumed budget alongside the Queue, reels and scheduled
 * posts. But only `publishToSocial` calls `assertPublishCadence`, and this cron
 * posts to Meta directly — so the door responsible for roughly 84% of all
 * publishing was the one door the brake could not apply to. It spent everyone
 * else's budget and was never itself refused.
 *
 * Measured: 2026-06-17 saw 32 autopost publishes in a single day. Under the
 * policy in force today that would STILL not have been stopped, because nothing
 * asked.
 *
 * Asserted at the source because the alternative is booting the whole autopost
 * pipeline (LLM generation, image render, Meta) to observe one guard.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(
  join(new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"), "services", "igAutopost.ts"),
  "utf8",
);
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("the autoposter asks the cap before publishing", () => {
  it("calls assertPublishCadence", () => {
    expect(CODE).toMatch(/assertPublishCadence\(\s*\{\s*format:\s*["']photo["']/);
  });

  it("the call happens BEFORE the Meta dispatch, not after", () => {
    const cap = CODE.indexOf("assertPublishCadence");
    const post = CODE.indexOf("postToInstagram(");
    expect(cap).toBeGreaterThan(-1);
    expect(post).toBeGreaterThan(-1);
    expect(cap).toBeLessThan(post);
  });

  it("a governor denial aborts the run instead of posting anyway", () => {
    expect(CODE).toMatch(/Blocked by content governor/);
    expect(CODE).toMatch(/status:\s*["']aborted["']/);
  });

  it("a NON-denial error is rethrown, never swallowed into a silent success", () => {
    // The whole session's defect class: a catch that converts a failure into a
    // normal result. Only the governor's deliberate refusal is handled here.
    expect(CODE).toMatch(/if\s*\(!denied\)\s*throw err;/);
  });

  it("still honours the kill switch — the cadence gate did not replace it", () => {
    expect(CODE).toMatch(/killSwitchBlockedPlatforms/);
    expect(CODE).toMatch(/["']automated["']/);
  });
});

/**
 * Review catch (P2): a capped day was paying for generation, repeatedly.
 */
describe("a capped day costs nothing and happens once", () => {
  it("preflights the cap BEFORE buildSignalBrief, not only after", () => {
    // The later assertion ran after up to three generate -> render -> evaluate
    // attempts, so a capped day bought LLM and image spend for a post that
    // could never publish.
    // Anchor on the CALL SITE, not the name: `buildSignalBrief()` also matches
    // the function's own declaration far earlier in the file, which made the
    // first version of this assertion compare against the wrong position.
    const pre = CODE.indexOf("assertPublishCadence");
    const briefCall = CODE.indexOf("await buildSignalBrief()");
    expect(pre).toBeGreaterThan(-1);
    expect(briefCall).toBeGreaterThan(-1);
    expect(pre).toBeLessThan(briefCall);
  });

  it("keeps the LATE assertion too — another door can take the slot mid-run", () => {
    // Generation takes minutes. The preflight saves money; the second check is
    // what actually enforces.
    const hits = CODE.split("assertPublishCadence").length - 1;
    expect(hits).toBeGreaterThanOrEqual(2);
  });

  it("a dry run is not capped — it publishes nothing", () => {
    expect(CODE).toMatch(/if\s*\(!dryRun\)\s*\{/);
  });

  it("a cap hold is TERMINAL for the slot, so the next tick does not repeat it", () => {
    // alreadyRanSlotToday deduped only dryrun/posted, so every later tick
    // re-ran the pipeline and re-sent the Telegram notice.
    expect(CODE).toMatch(/status\} = 'aborted' AND .*error\} LIKE 'Blocked by content governor%'/s);
  });

  it("an EVAL-gate abort is still retryable — only the cap hold is terminal", () => {
    // A fresh draft might pass later; a cap does not fall during the day.
    expect(CODE).not.toMatch(/status\} IN \('dryrun','posted','aborted'\)/);
  });
});
