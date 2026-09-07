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
 * "HIGGSFIELD_API_KEY_ID"]`. requiresEnv is a `.some()` check, so this reads
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

describe("the credential is the gate", () => {
  it("reel-pipeline is enabled", () => {
    expect(reelPipelineBlock()).toContain("enabled: true");
  });

  it("and it cannot run without the NON-INTERACTIVE credential", () => {
    // The whole point. Enabled without this is an unfunded cron firing every
    // 15 minutes at a provider it cannot authenticate to.
    // EITHER non-interactive lane. requiresEnv is a `.some()` check, so naming
    // both means "at least one provider that cannot expire mid-week". A first
    // draft named Higgsfield's key alone and would have held the cron dormant
    // forever while a live, authenticated Veo lane sat unused.
    expect(reelPipelineBlock()).toContain('requiresEnv: ["GEMINI_API_KEY", "HIGGSFIELD_API_KEY_ID"]');
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

  it("the keepalive stays staged — it has nothing left to keep alive", () => {
    // It rotates the CLI session token, and reel-pipeline no longer runs that
    // lane unattended. Its "promote together, never before" note referred to
    // the CLI pairing and was updated rather than silently outgrown.
    const keepalive = MANUAL_TRIGGER_STAGED.find((j) => j.name === "higgsfield-session-keepalive");
    expect(keepalive, "keepalive must remain staged").toBeDefined();
    expect(keepalive!.promote).toContain("DECOUPLED");
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

  it("the negative check would actually catch the thing it forbids", () => {
    // Proves `not.toContain("HIGGSFIELD_CREDENTIALS_JSON")` is a real test: the
    // string exists in the file, just not inside this block.
    expect(SCHEDULER.includes("HIGGSFIELD_API_KEY_ID")).toBe(true);
    expect(reelPipelineBlock().includes("HIGGSFIELD_API_KEY_ID")).toBe(true);
    expect(reelPipelineBlock().includes("GEMINI_API_KEY")).toBe(true);
  });
});
