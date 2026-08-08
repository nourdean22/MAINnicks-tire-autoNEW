/**
 * Cancelling the paid video provider must degrade the reel lane, not kill it.
 *
 * On 2026-08-03 Higgsfield returned `grace_daily_limit_reached`. That is
 * QUOTA_OR_CREDIT -> PAUSE_PROVIDER, and nextStatusFor sends PAUSE_PROVIDER
 * straight to `failed` (correctly: no retry clears a plan-tier wall). The
 * consequence was that the Instagram account published NOTHING for two days
 * while a free local renderer sat in the same file, fully built and tested.
 *
 * This covers the opt-in fallback that turns "dark" into "degraded", and the
 * two properties that make it safe to ship:
 *
 *  1. It is OFF by default. selectReelVideoProvider deliberately refuses to
 *     auto-select template_stock because that would "quietly change what the
 *     shop publishes". This flag does not overturn that ruling.
 *  2. It does not slip past the durable-storage guard. The top-of-function
 *     precondition runs against the SELECTED provider, and Higgsfield is
 *     exempt from it (it returns its own CDN URL). So a mid-job flip to a lane
 *     that DOES re-host would bypass a fail-closed check unless the flip
 *     asserts it again itself.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { shouldDegradeToFreeLane } from "./services/reelPipeline";

const FLAG = "REEL_FALLBACK_TO_TEMPLATE_STOCK";

/** The exact stderr payload from prod reel job #1380001. */
const GRACE_LIMIT = new Error(
  'Higgsfield CLI exited with code 3. Stderr: Error: {"data":{"modal_data":{"elapsed_days":2},"type":"unlock_full_access_notice"},"error_type":"grace_daily_limit_reached"}',
);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the fallback is opt-in", () => {
  it("stays OFF when the flag is unset - a plan wall still goes terminal", async () => {
    vi.stubEnv(FLAG, "");
    expect(await shouldDegradeToFreeLane(GRACE_LIMIT)).toBe(false);
  });

  it("stays OFF for any value other than the exact string 'true'", async () => {
    for (const v of ["1", "yes", "TRUE", "on"]) {
      vi.stubEnv(FLAG, v);
      expect(await shouldDegradeToFreeLane(GRACE_LIMIT)).toBe(false);
    }
  });
});

describe("when armed, it degrades exactly the unrecoverable failures", () => {
  it("degrades on the real prod plan-tier wall", async () => {
    vi.stubEnv(FLAG, "true");
    expect(await shouldDegradeToFreeLane(GRACE_LIMIT)).toBe(true);
  });

  it("degrades on a dead provider session - AUTH_INVALID is the same dead end", async () => {
    // 2026-08-04 recorded "Higgsfield keepalive FAILED - re-login required
    // (refresh token revoked)". Same outcome for the shop: nothing publishes.
    vi.stubEnv(FLAG, "true");
    expect(await shouldDegradeToFreeLane(new Error("401 unauthorized"))).toBe(true);
  });

  it("does NOT degrade a network blip - that retries and should stay paid", async () => {
    // The important negative. Downgrading the shop's visual output because a
    // socket hiccuped would trade brand quality for nothing.
    vi.stubEnv(FLAG, "true");
    expect(await shouldDegradeToFreeLane(new Error("ECONNRESET"))).toBe(false);
  });

  it("does NOT degrade a rate limit - the request never ran", async () => {
    vi.stubEnv(FLAG, "true");
    expect(await shouldDegradeToFreeLane(new Error("HTTP 429 rate limit"))).toBe(false);
  });

  it("does NOT degrade an unrecognised failure - it retries with backoff", async () => {
    vi.stubEnv(FLAG, "true");
    expect(await shouldDegradeToFreeLane(new Error("something nobody has seen"))).toBe(false);
  });
});

/**
 * THE ARMED FLAG THAT STILL WENT DARK (2026-08-07).
 *
 * REEL_FALLBACK_TO_TEMPLATE_STOCK=true was live on Railway and daily-reel-post
 * STILL failed 4x in one day with cron_log details "timeout", while
 * higgsfield-session-keepalive recorded "re-login required (refresh token
 * revoked)".
 *
 * Why the tests above did not catch it: they assert on error TEXT, and a revoked
 * session never produces auth text. The CLI HANGS. withTimeout raises a timeout,
 * which classifies as a local timeout -> RECONCILE_BEFORE_RETRY, and only
 * AUTH_INVALID / QUOTA_OR_CREDIT reach PAUSE_PROVIDER. The predicate was correct
 * about every error it was shown and blind to the one that actually happened.
 *
 * The fix consults higgsfieldSessionHealth() - built and tested 2026-08-03, and
 * until now wired into exactly one operator display surface and no decision.
 */
const TIMEOUT_ERR = new Error("higgsfield beat 2 timed out after 600s");

describe("a HUNG provider degrades too - not just one that answers with an error", () => {
  it("the timeout alone is NOT enough — proving this is the gap, not a duplicate case", async () => {
    vi.stubEnv(FLAG, "true");
    // No provider passed = the old signature. Still false, because the error
    // text carries no auth/quota signal. This is the bug, pinned.
    expect(await shouldDegradeToFreeLane(TIMEOUT_ERR)).toBe(false);
  });

  it("degrades when the KEEPALIVE says the session is dead, even though the error is only a timeout", async () => {
    vi.stubEnv(FLAG, "true");
    vi.doMock("./services/higgsfieldStudio", () => ({
      higgsfieldSessionHealth: async () => ({
        healthy: false,
        reason: "re-login required (refresh token revoked)",
        checkedAt: new Date("2026-08-07T12:25:00Z"),
      }),
    }));
    const { shouldDegradeToFreeLane: fresh } = await import("./services/reelPipeline");
    expect(await fresh(TIMEOUT_ERR, "higgsfield")).toBe(true);
  });

  it("does NOT degrade when liveness is UNKNOWN - a blind spot must never downgrade a working provider", async () => {
    vi.stubEnv(FLAG, "true");
    // higgsfieldSessionHealth returns null (never false) for "no row / stale
    // verdict / unreadable DB" precisely so this case stays distinguishable.
    vi.doMock("./services/higgsfieldStudio", () => ({
      higgsfieldSessionHealth: async () => ({
        healthy: null,
        reason: "keepalive last ran too long ago to vouch for the session",
        checkedAt: null,
      }),
    }));
    const { shouldDegradeToFreeLane: fresh } = await import("./services/reelPipeline");
    expect(await fresh(TIMEOUT_ERR, "higgsfield")).toBe(false);
  });

  it("does NOT degrade a healthy provider that merely timed out once", async () => {
    vi.stubEnv(FLAG, "true");
    vi.doMock("./services/higgsfieldStudio", () => ({
      higgsfieldSessionHealth: async () => ({
        healthy: true,
        reason: "keepalive refreshed the session",
        checkedAt: new Date(),
      }),
    }));
    const { shouldDegradeToFreeLane: fresh } = await import("./services/reelPipeline");
    expect(await fresh(TIMEOUT_ERR, "higgsfield")).toBe(false);
  });

  it("ignores higgsfield liveness when a DIFFERENT provider failed", async () => {
    vi.stubEnv(FLAG, "true");
    vi.doMock("./services/higgsfieldStudio", () => ({
      higgsfieldSessionHealth: async () => ({ healthy: false, reason: "dead", checkedAt: new Date() }),
    }));
    const { shouldDegradeToFreeLane: fresh } = await import("./services/reelPipeline");
    // Veo timing out says nothing about Higgsfield's session.
    expect(await fresh(TIMEOUT_ERR, "veo")).toBe(false);
  });

  it("still respects the opt-in flag - a dead session does not degrade when the flag is off", async () => {
    vi.stubEnv(FLAG, "");
    vi.doMock("./services/higgsfieldStudio", () => ({
      higgsfieldSessionHealth: async () => ({ healthy: false, reason: "dead", checkedAt: new Date() }),
    }));
    const { shouldDegradeToFreeLane: fresh } = await import("./services/reelPipeline");
    expect(await fresh(TIMEOUT_ERR, "higgsfield")).toBe(false);
  });
});

/**
 * Source assertions, because the wiring is what actually failed here - a
 * correct predicate that nothing calls would leave the account just as dark.
 *
 * Every pattern below is ANCHORED TO LINE START so it can only match code.
 * Comment lines begin with `//`, and this file has been burned before by a
 * regex that matched the explanatory comment describing the very thing it was
 * supposed to prove absent.
 */
const PIPELINE = fs.readFileSync(
  path.join(__dirname, "services", "reelPipeline.ts"),
  "utf8",
);

describe("the fallback is actually wired into the beat loop", () => {
  it("consults the predicate around the paid generation call", () => {
    // Widened 2026-08-07: the call now passes the ACTIVE PROVIDER as well, so a
    // hung session (which produces only a timeout) can be judged by the
    // keepalive's verdict rather than by error text. The provider argument is
    // asserted separately below — losing it silently would restore the exact
    // blind spot that kept reels dark for a day with the flag already armed.
    expect(PIPELINE).toMatch(/^\s*if \(!\(await shouldDegradeToFreeLane\(genErr, activeProvider\)\)\) throw genErr;$/m);
  });

  it("passes the active provider, so a HUNG session is judged by liveness not by error text", () => {
    expect(PIPELINE).toMatch(/shouldDegradeToFreeLane\(genErr, activeProvider\)/);
  });

  it("the predicate consults the keepalive verdict, and only on an explicit false", () => {
    const SVC = fs.readFileSync(path.join(__dirname, "services", "reelPipeline.ts"), "utf8");
    // Built + tested 2026-08-03, wired into no decision until now.
    expect(SVC).toMatch(/^\s*const \{ higgsfieldSessionHealth \} = await import\("\.\/higgsfieldStudio"\);$/m);
    // `=== false` is load-bearing: null means not-knowable and must not degrade.
    expect(SVC).toMatch(/^\s*if \(health\.healthy === false\) \{$/m);
    expect(SVC).not.toMatch(/^\s*if \(!health\.healthy\) \{$/m);
  });

  it("re-throws anything it does not handle, so no failure is swallowed", () => {
    // The `throw genErr` above is the whole reason this is not a silent
    // catch-all. If it is ever dropped, every provider error becomes a
    // downgraded reel instead of a reported failure.
    expect(PIPELINE).toMatch(/shouldDegradeToFreeLane\(genErr, activeProvider\)\)\) throw genErr;/);
  });

  it("flips to the free lane and re-runs the SAME beat", () => {
    expect(PIPELINE).toMatch(/^\s*activeProvider = "template_stock";$/m);
    expect(PIPELINE).toMatch(/^\s*i -= 1;$/m);
  });

  it("asserts durable storage on the flip, so the fallback cannot bypass it", () => {
    expect(PIPELINE).toMatch(
      /^\s*assertDurableStorageForGeneration\(`reel job \$\{job\.id\} template_stock fallback`\);$/m,
    );
  });

  it("asserts storage AFTER the flip and BEFORE resuming the beat", () => {
    // Ordering is the property, not mere presence: asserting before the flip
    // would test the wrong provider, and asserting after `continue` would be
    // dead code.
    const flip = PIPELINE.indexOf('activeProvider = "template_stock";');
    const assertIdx = PIPELINE.indexOf("template_stock fallback`);");
    const resume = PIPELINE.indexOf("i -= 1;");
    expect(flip).toBeGreaterThan(-1);
    expect(assertIdx).toBeGreaterThan(flip);
    expect(resume).toBeGreaterThan(assertIdx);
  });

  it("counts the clips the free lane rendered, for settlement", () => {
    expect(PIPELINE).toMatch(/^\s*freeLaneClips \+= 1;$/m);
  });

  it("settles the free clips at the free rate, not the paid provider's", () => {
    // The hazard the reserve() call already warns about: the reservation is
    // priced at enqueue against the SELECTED provider, so "settlement is where
    // actuals must be reconciled". Billing a degraded reel at the paid rate is
    // the same ledger lie the flat-Seedance settle used to tell, and it was
    // fixed once already on the repair lane.
    expect(PIPELINE).toMatch(
      /paidClips \* reelClipCostUsd\(videoProvider\) \+ freeLaneClips \* reelClipCostUsd\("template_stock"\)/,
    );
    // The pre-fallback form billed EVERY clip at the selected provider's rate.
    expect(PIPELINE).not.toMatch(
      /settle\(`reel_job_\$\{job\.id\}`, clipUrls\.length \* reelClipCostUsd\(videoProvider\)\)/,
    );
  });

  it("drives the beat loop from activeProvider, not the frozen selection", () => {
    // If any branch still reads videoProvider, the flip is inert for it.
    expect(PIPELINE).toMatch(/^\s*if \(activeProvider === "template_stock"\) \{$/m);
    expect(PIPELINE).toMatch(/^\s*if \(activeProvider === "higgsfield"\) \{$/m);
    expect(PIPELINE).toMatch(/^\s*if \(activeProvider !== "veo"\) \{$/m);
  });
});
