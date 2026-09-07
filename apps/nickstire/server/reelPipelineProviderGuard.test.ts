/**
 * The generation stage is guarded by the ACTIVE provider — not by requiresEnv.
 *
 * SELF-AUDIT CATCH, 2026-09-07. Promoting reel-pipeline with
 * `requiresEnv: ["GEMINI_API_KEY", "HIGGSFIELD_API_KEY_ID"]` looked safe and was
 * (that list is GONE as of review P2 — see the inverted assertion below)
 * not. requiresEnv asks only "is SOME non-interactive lane credentialed", and
 * GEMINI_API_KEY is set in production — so the gate opens. But
 * `selectReelVideoProvider` returns an explicit REEL_VIDEO_PROVIDER pin
 * UNCONDITIONALLY, before any credential check, and prod pins `higgsfield`,
 * whose session credential probes `credsValid:false — Session expired`.
 *
 * So the promoted cron would have generated into a dead provider every 15
 * minutes: the exact failure the staging existed to prevent, and the one that
 * previously produced 296 failed runs in 72 hours. A gate on the union of
 * possible lanes is not a gate on the lane that will actually be used.
 *
 * ASSEMBLY MUST STAY UNGUARDED. It downloads already-rendered clips, generates
 * the voiceover and runs ffmpeg — it never calls a video provider. Guarding it
 * alongside generation would strand every job whose clips already exist, which
 * is precisely the path an externally-rendered clip takes to become a reel.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(path.join(__dirname, "cron", "scheduler.ts"), "utf8");

/** The reel-pipeline handler body, bounded to itself. */
function handler(): string {
  const i = SRC.indexOf('name: "reel-pipeline"');
  expect(i, "reel-pipeline not found").toBeGreaterThan(-1);
  const rest = SRC.slice(i);
  const start = rest.indexOf("handler:");
  expect(start).toBeGreaterThan(-1);
  // Bound at the next job's registration so nothing drifts onto a sibling.
  const end = rest.indexOf('name: "', start);
  return end === -1 ? rest.slice(start) : rest.slice(start, end);
}

describe("generation follows the pin", () => {
  it("resolves the ACTIVE provider before generating", () => {
    expect(handler()).toContain("await selectReelVideoProvider()");
  });

  it("checks that provider's credentials are present", () => {
    expect(handler()).toContain("reelProviderCredentialsPresent(activeProvider)");
  });

  it("skips generation when they are not, instead of calling the provider", () => {
    const h = handler();
    expect(h).toContain("generationReady");
    // The call must be CONDITIONAL. An unconditional processNextReelJob() is
    // the whole defect.
    expect(h).toMatch(/generationReady\s*\?\s*await settle\(processNextReelJob\(\)\)/);
  });

  it("says why in cron_log rather than failing silently", () => {
    expect(handler()).toContain("generation skipped: REEL_VIDEO_PROVIDER=");
  });
});

describe("assembly is deliberately NOT guarded", () => {
  /**
   * The load-bearing half. If a later change "tidies" this by moving assembly
   * inside the same conditional, every job with clips already rendered stops
   * assembling — and it would still pass every test above.
   */
  it("assembly runs unconditionally", () => {
    const h = handler();
    expect(h).toContain("await settle(processNextAssemblyJob())");
    // Assembly must NOT be gated on generationReady.
    expect(h).not.toMatch(/generationReady\s*\?\s*await settle\(processNextAssemblyJob\(\)\)/);
    expect(h).not.toMatch(/generationReady\s*&&\s*.*processNextAssemblyJob/);
  });

  it("recovery of stuck jobs also runs unconditionally", () => {
    expect(handler()).toContain("await recoverStuckReelJobs()");
  });

  it("the negative assertions are not vacuous", () => {
    // Positive control: the same slice DOES contain the conditional it should,
    // so `not.toMatch` above is testing a real, present pattern shape.
    expect(handler()).toMatch(/generationReady\s*\?/);
  });
});

describe("the credential gate is the handler's, and there is no second copy", () => {
  it("does NOT re-declare credentials as a scheduler env list", () => {
    // Bounded on the registration itself, NOT a character count. The first
    // version sliced a fixed 900 chars and broke the moment a comment was added
    // above the line it was looking for — a test that fails for a reason
    // unrelated to its subject is worse than no test.
    //
    // This assertion INVERTED on review P2 of #2170. requiresEnv named a
    // SUBSET of what the providers accept — Veo also takes GOOGLE_AI_API_KEY,
    // GOOGLE_GENAI_API_KEY and a service-account pair, and Higgsfield's
    // resolver also reads DB-backed app_secret_kv rows an env list cannot name.
    // A subset gate false-negatives: dormant while a provider is credentialed.
    // One definition of "credentialed" now, owned by the provider modules.
    const i = SRC.indexOf('name: "reel-pipeline"');
    const block = SRC.slice(i, i + SRC.slice(i).indexOf("handler:"));
    expect(block).not.toContain("requiresEnv:");
    // ...and the positive control: the flag gate IS still there, so the
    // negative above is proving an absence in a block that has content.
    expect(block).toContain('requiresFlag: "REEL_GENERATION_ENABLED"');
  });

  it("but the handler no longer trusts it alone", () => {
    // The handler check is the one that follows
    // REEL_VIDEO_PROVIDER. Both must exist — this asserts they do.
    expect(handler()).toContain("selectReelVideoProvider");
  });
});
