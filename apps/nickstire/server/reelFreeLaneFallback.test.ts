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
    expect(PIPELINE).toMatch(/^\s*if \(!\(await shouldDegradeToFreeLane\(genErr\)\)\) throw genErr;$/m);
  });

  it("re-throws anything it does not handle, so no failure is swallowed", () => {
    // The `throw genErr` above is the whole reason this is not a silent
    // catch-all. If it is ever dropped, every provider error becomes a
    // downgraded reel instead of a reported failure.
    expect(PIPELINE).toMatch(/shouldDegradeToFreeLane\(genErr\)\)\) throw genErr;/);
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

  it("drives the beat loop from activeProvider, not the frozen selection", () => {
    // If any branch still reads videoProvider, the flip is inert for it.
    expect(PIPELINE).toMatch(/^\s*if \(activeProvider === "template_stock"\) \{$/m);
    expect(PIPELINE).toMatch(/^\s*if \(activeProvider === "higgsfield"\) \{$/m);
    expect(PIPELINE).toMatch(/^\s*if \(activeProvider !== "veo"\) \{$/m);
  });
});
