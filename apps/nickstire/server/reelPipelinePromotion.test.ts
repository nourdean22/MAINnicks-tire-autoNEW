/**
 * `reel-pipeline` is enabled, and its safety now lives in a CREDENTIAL rather
 * than in anyone remembering to check.
 *
 * WHAT WAS WRONG WITH `enabled: false`. It was correct — the CLI session lane
 * needs a browser login no cron can perform — but it made promotion depend on a
 * human noticing that the ledger fact had changed and shipping a deploy. That
 * vigilance is exactly what failed: the session died 2026-08-24 and nothing
 * moved for eleven days.
 *
 * So the gate moved to the CREDENTIAL: `requiresEnv: ["GEMINI_API_KEY",
 * "HIGGSFIELD_API_KEY_ID"]` — REMOVED again on review P2 of #2170, because an
 * env-name list cannot express a service-account pair or a DB-backed
 * credential and so false-negatives. requiresEnv was a `.some()` check reading
 * "run when at least one provider that cannot expire mid-week is credentialed".
 * Unset, the scheduler skips with a legible `requiresEnv:… (no env var set)`
 * line in cron_log; set, the job runs with no second deploy and no session.
 *
 * BOTH lanes, not Higgsfield's alone. A first draft named HIGGSFIELD_API_KEY_ID
 * by itself and would have held this cron dormant forever while a funded,
 * authenticated Veo lane sat unused three lines away in the same selector —
 * `selectReelVideoProvider` already auto-prefers `veo`, and GEMINI_API_KEY
 * probed live on 2026-09-07 returns HTTP 200 with
 * `veo-3.1-fast-generate-preview` available.
 *
 * WHY NOT THE SESSION CREDENTIAL. Gating on HIGGSFIELD_CREDENTIALS_JSON would
 * re-create the cron that dies between logins — 296 failed runs in 72h, half of
 * ~50 Telegram alerts in three days. That variable is SET in production right
 * now and probes `credsValid:false — Session expired`, so it would have gated
 * OPEN on a dead credential. Presence is not validity.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MANUAL_TRIGGER_STAGED, extractDisabledTierJobNames } from "./cron/registry-tier-map";

const SCHEDULER = readFileSync(path.join(__dirname, "cron", "scheduler.ts"), "utf8");

/** The reel-pipeline job's registration block, bounded to itself. */
function reelPipelineBlock(): string {
  const i = SCHEDULER.indexOf('name: "reel-pipeline",');
  expect(i, "reel-pipeline registration not found").toBeGreaterThan(-1);
  // Bound at its handler so no assertion can drift onto a sibling job.
  const rest = SCHEDULER.slice(i);
  const end = rest.indexOf("handler:");
  expect(end).toBeGreaterThan(-1);
  return rest.slice(0, end);
}

/** The handler body — where the real credential check lives. */
function handlerOf() {
  const i = SCHEDULER.indexOf('name: "reel-pipeline"');
  const rest = SCHEDULER.slice(i);
  const start = rest.indexOf("handler:");
  const end = rest.indexOf('name: "', start);
  return end === -1 ? rest.slice(start) : rest.slice(start, end);
}

describe("the credential is the gate", () => {
  it("reel-pipeline is enabled", () => {
    expect(reelPipelineBlock()).toContain("enabled: true");
  });

  it("and it cannot generate without the ACTIVE provider being credentialed", () => {
    // The whole point. Enabled without this is an unfunded cron firing every
    // 15 minutes at a provider it cannot authenticate to.
    // EITHER non-interactive lane. requiresEnv is a `.some()` check, so naming
    // both means "at least one provider that cannot expire mid-week". A first
    // draft named Higgsfield's key alone and would have held the cron dormant
    // forever while a live, authenticated Veo lane sat unused.
    // requiresEnv was REMOVED (review P2): an env-name list cannot express a
    // service-account pair or a DB-backed credential, so it false-negatives and
    // holds the cron dormant while a provider is genuinely credentialed. The
    // gate is the handler's reelProviderCredentialsPresent() call on the ACTIVE
    // provider, which uses the real resolvers.
    expect(reelPipelineBlock()).not.toContain("requiresEnv:");
    expect(handlerOf()).toContain("reelProviderCredentialsPresent(activeProvider)");
  });

  it("does NOT gate on the session credential, which is set-but-dead in production", () => {
    // HIGGSFIELD_CREDENTIALS_JSON is present in prod and expired. A requiresEnv
    // check is presence-only, so gating on it would open the gate on a dead
    // credential — the precise failure that produced 296 failed runs in 72h.
    expect(reelPipelineBlock()).not.toContain("HIGGSFIELD_CREDENTIALS_JSON");
  });

  it("keeps the flag gate too — the stages compare against the exact string", () => {
    expect(reelPipelineBlock()).toContain('requiresFlag: "REEL_GENERATION_ENABLED"');
  });
});

describe("the staged registry and the scheduler still agree", () => {
  it("reel-pipeline is no longer listed as staged", () => {
    expect(MANUAL_TRIGGER_STAGED.map((j) => j.name)).not.toContain("reel-pipeline");
  });

  it("and the scheduler no longer disables it", () => {
    expect(extractDisabledTierJobNames(SCHEDULER).has("reel-pipeline")).toBe(false);
  });

  it("the keepalive is promoted alongside it — 2026-09-08 reversed the 09-07 decoupling", () => {
    // This used to assert the keepalive STAYS staged because "reel-pipeline no
    // longer runs the CLI lane unattended". Production disagreed: the
    // 2026-08-30 failures read "Higgsfield CLI exited ... Session expired" and
    // nothing rendered for nine days, because the keepalive is the only
    // in-container refresher of that session. Updated rather than silently
    // outgrown, same as the note it replaced. The full pin — not disabled, not
    // staged, throws on invalid, clears the stale cache first — lives in
    // higgsfieldKeepalivePromoted.test.ts; this only guards the pairing.
    const keepalive = MANUAL_TRIGGER_STAGED.find((j) => j.name === "higgsfield-session-keepalive");
    expect(keepalive, "keepalive must not be re-staged while reel-pipeline runs the CLI lane").toBeUndefined();
    expect(extractDisabledTierJobNames(SCHEDULER).has("higgsfield-session-keepalive")).toBe(false);
  });
});

describe("canary — the assertions are not vacuous", () => {
  /**
   * Three of the checks above are `toContain` on a source slice, and one is a
   * `not.toContain`. Both shapes pass trivially if the slice is empty or points
   * at the wrong thing, so pin the slice itself.
   */
  it("the block really is reel-pipeline's, and really is bounded", () => {
    const block = reelPipelineBlock();
    expect(block).toContain('name: "reel-pipeline"');
    expect(block.length).toBeGreaterThan(200);
    // Bounded: must not have run on into the next job's registration.
    expect(block).not.toContain("higgsfield-session-keepalive");
    expect(block).not.toContain("daily-reel-post");
  });

  it("the negative checks would actually catch the things they forbid", () => {
    // Each `not.toContain` above needs a positive control, or it passes for
    // free on a slice that never could have contained the string.
    //
    // The controls used to be the two env NAMES, which sat in this block until
    // review P2 removed requiresEnv. That made the canary fail for a reason
    // unrelated to its subject — the same anchor-drift shape as the claim it
    // guards. Control on the FORBIDDEN strings themselves instead: each must
    // exist in the file, so its absence from this block is a real finding.
    expect(SCHEDULER.includes("HIGGSFIELD_CREDENTIALS_JSON"), "session env absent from file").toBe(true);
    expect(reelPipelineBlock().includes("HIGGSFIELD_CREDENTIALS_JSON")).toBe(false);
    // requiresEnv is a real field OTHER jobs use — so `not.toContain` on this
    // block is asserting a deliberate absence, not a typo that can never match.
    expect(SCHEDULER.includes("requiresEnv:"), "requiresEnv absent from file").toBe(true);
    expect(reelPipelineBlock().includes("requiresEnv:")).toBe(false);
  });
});
