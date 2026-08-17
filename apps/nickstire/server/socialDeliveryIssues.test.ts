/**
 * Delivery-issue engine — pure-deriver pins.
 *
 * The rules under test are the operating contract of the Delivery card:
 * blockers name the constrained layer + smallest safe next action, unknown
 * facts surface as WARNINGS (never as calm), and deliberate stops (kill
 * switches) are INFO — an intentional stop painted red trains the operator
 * to ignore red.
 */
import { describe, expect, it } from "vitest";
import {
  deriveDeliveryIssues,
  type DeliveryFacts,
} from "./services/socialDeliveryIssues";

// Every field is spelled out even where a default would do. tsconfig.typecheck
// EXCLUDES **/*.test.ts and vitest only strips types, so an omitted field is not
// a type error here — it silently arrives as `undefined` and a branch keyed on
// it takes neither path, passing while proving nothing. `ephemeralOverride` had
// already drifted out of this literal that way before the fields below were added.
const ALL_GREEN: DeliveryFacts = {
  storageConfigured: true,
  permanentUrls: true,
  ephemeralOverride: false,
  metaConfigured: true,
  metaLive: true,
  metaLiveError: null,
  generatorProvider: "veo",
  generatorConfigured: true,
  generatorSessionHealthy: null,
  generatorSessionReason: null,
  generationEnabled: true,
  reelPublishArmed: true,
  controls: { globalKillSwitch: false, publishingKillSwitch: false, generationKillSwitch: false },
  controlsSource: "storage",
  publishAmbiguousReelJobs: 0,
  jobsNeedingAttention: 0,
};

describe("deriveDeliveryIssues", () => {
  it("a fully healthy system reports ZERO issues — no noise to train the operator to ignore", () => {
    expect(deriveDeliveryIssues(ALL_GREEN)).toEqual([]);
  });

  it("missing bucket is a BLOCKER at asset_hosting whose next action names the env var", () => {
    const issues = deriveDeliveryIssues({ ...ALL_GREEN, storageConfigured: false, permanentUrls: false });
    const hit = issues.find((i) => i.key === "storage_bucket_not_connected");
    expect(hit?.severity).toBe("blocker");
    expect(hit?.layer).toBe("asset_hosting");
    expect(hit?.nextAction).toContain("S3_BUCKET");
  });

  it("S3 set without CloudFront is INFO — prod's measured state serves stable app-proxied URLs; CDN is optional", () => {
    const issues = deriveDeliveryIssues({ ...ALL_GREEN, storageConfigured: true, permanentUrls: false });
    expect(issues.find((i) => i.key === "storage_bucket_not_connected")).toBeFalsy();
    const hit = issues.find((i) => i.key === "storage_urls_not_permanent");
    expect(hit?.severity).toBe("info");
    expect(hit?.nextAction).toContain("CLOUDFRONT_DOMAIN");
  });

  it("Meta REJECTED is a blocker; could-not-ASK is only a warning — a transport blip must not read as a dead token", () => {
    const rejected = deriveDeliveryIssues({ ...ALL_GREEN, metaLive: false, metaLiveError: "expired" });
    expect(rejected.find((i) => i.key === "meta_token_rejected")?.severity).toBe("blocker");

    const unknown = deriveDeliveryIssues({ ...ALL_GREEN, metaLive: null, metaLiveError: "timeout" });
    const hit = unknown.find((i) => i.key === "meta_liveness_unknown");
    expect(hit?.severity).toBe("warning");
    expect(hit?.nextAction).toContain("do not rotate tokens");
  });

  it("an unknown ambiguous-publish count is a WARNING, never treated as zero", () => {
    const issues = deriveDeliveryIssues({ ...ALL_GREEN, publishAmbiguousReelJobs: null });
    const hit = issues.find((i) => i.key === "ambiguous_count_unknown");
    expect(hit?.severity).toBe("warning");
    expect(hit?.reason).toContain("unknown is not zero");
  });

  it("parked ambiguous publishes are a BLOCKER routed to the reconciler, not to a retry", () => {
    const issues = deriveDeliveryIssues({ ...ALL_GREEN, publishAmbiguousReelJobs: 2 });
    const hit = issues.find((i) => i.key === "publish_ambiguous_reel_jobs");
    expect(hit?.severity).toBe("blocker");
    expect(hit?.nextAction).toContain("reconciler");
  });

  it("kill switches ON are INFO (deliberate stops), and unreadable switch state is a WARNING", () => {
    const on = deriveDeliveryIssues({
      ...ALL_GREEN,
      controls: { globalKillSwitch: false, publishingKillSwitch: true, generationKillSwitch: false },
    });
    expect(on.find((i) => i.key === "publishing_kill_switch_on")?.severity).toBe("info");

    const unreadable = deriveDeliveryIssues({ ...ALL_GREEN, controls: null, controlsSource: "fallback_unreachable" });
    const hit = unreadable.find((i) => i.key === "kill_switch_state_unreadable");
    expect(hit?.severity).toBe("warning");
    expect(hit?.reason).toContain("fail CLOSED");
  });

  it("global switch ON suppresses the redundant per-scope rows", () => {
    const issues = deriveDeliveryIssues({
      ...ALL_GREEN,
      controls: { globalKillSwitch: true, publishingKillSwitch: true, generationKillSwitch: true },
    });
    expect(issues.find((i) => i.key === "global_kill_switch_on")).toBeTruthy();
    expect(issues.find((i) => i.key === "publishing_kill_switch_on")).toBeFalsy();
    expect(issues.find((i) => i.key === "generation_kill_switch_on")).toBeFalsy();
  });

  it("disarmed reel publishing is INFO — the default-off gate is by design, not a defect", () => {
    const issues = deriveDeliveryIssues({ ...ALL_GREEN, reelPublishArmed: false });
    expect(issues.find((i) => i.key === "reel_publish_disarmed")?.severity).toBe("info");
  });

  it("orders blockers before warnings before info", () => {
    const issues = deriveDeliveryIssues({
      ...ALL_GREEN,
      storageConfigured: false,
      metaLive: null,
      reelPublishArmed: false,
    });
    const severities = issues.map((i) => i.severity);
    const sorted = [...severities].sort((a, b) =>
      ({ blocker: 0, warning: 1, info: 2 })[a] - ({ blocker: 0, warning: 1, info: 2 })[b]);
    expect(severities).toEqual(sorted);
    expect(severities[0]).toBe("blocker");
  });

  it("every issue carries a non-empty reason, evidence, and next action — no bare failures", () => {
    const issues = deriveDeliveryIssues({
      ...ALL_GREEN,
      storageConfigured: false,
      metaConfigured: false,
      controls: null,
      publishAmbiguousReelJobs: null,
      jobsNeedingAttention: 3,
      generatorConfigured: false,
      generationEnabled: false,
      reelPublishArmed: false,
    });
    expect(issues.length).toBeGreaterThan(4);
    for (const issue of issues) {
      expect(issue.reason.length).toBeGreaterThan(10);
      expect(issue.evidence.length).toBeGreaterThan(5);
      expect(issue.nextAction.length).toBeGreaterThan(10);
    }
  });
});

describe("a stored Higgsfield blob is not a working session", () => {
  // THE FOUR-DAY OUTAGE THIS EXISTS FOR. Verified against production cron_log on
  // 2026-08-17: 332 completed keepalive runs (2026-08-10 08:47 -> 2026-08-13
  // 18:07), then 372 CONSECUTIVE failures (2026-08-13 18:11 -> 2026-08-17), every
  // one `Session expired. Hint: Run: hf auth login`. Cadence was healthy the whole
  // time (largest gap 15.4 min), so nothing was broken except that this surface
  // asked `!!credentialsJson` — a PRESENCE check — and reported the generator as
  // configured. `higgsfieldSessionHealth()` was written for exactly this in the
  // 2026-07-31 incident and had never been wired in here.
  const HF = {
    ...ALL_GREEN,
    generatorProvider: "higgsfield",
    generatorConfigured: true,
  } satisfies DeliveryFacts;

  it("a session PROVEN dead is a BLOCKER, not a warning — the lane produces nothing", () => {
    const issues = deriveDeliveryIssues({
      ...HF,
      generatorSessionHealthy: false,
      generatorSessionReason: "Session expired. Hint: Run: hf auth login",
    });
    const hit = issues.find((i) => i.key === "generator_session_expired");
    expect(hit?.severity).toBe("blocker");
    expect(hit?.layer).toBe("generation");
    // It must quote the cause the keepalive established, not a guess.
    expect(hit?.evidence).toContain("Session expired");
    expect(hit?.evidence).toContain("keepalive");
  });

  it("and it names the ONE recovery path, because no retry can fix a revoked token", () => {
    const hit = deriveDeliveryIssues({ ...HF, generatorSessionHealthy: false, generatorSessionReason: "x" })
      .find((i) => i.key === "generator_session_expired");
    expect(hit?.nextAction).toContain("hf auth login");
    expect(hit?.nextAction).toContain("Settings");
    expect(hit?.nextAction).toMatch(/cannot be restored by any retry/);
  });

  it("does NOT also raise credentials_missing — one fault, one instruction", () => {
    // Presence and liveness are different findings; emitting both would send the
    // operator down two paths at once.
    const keys = deriveDeliveryIssues({ ...HF, generatorSessionHealthy: false, generatorSessionReason: "x" })
      .map((i) => i.key);
    expect(keys).toContain("generator_session_expired");
    expect(keys).not.toContain("generator_credentials_missing");
  });

  it("a HEALTHY session raises no generation issue at all", () => {
    const issues = deriveDeliveryIssues({
      ...HF,
      generatorSessionHealthy: true,
      generatorSessionReason: "keepalive refreshed the session",
    });
    expect(issues.filter((i) => i.layer === "generation")).toHaveLength(0);
  });

  it("UNKNOWN liveness warns — it must not read as healthy, and must not cry blocker", () => {
    const hit = deriveDeliveryIssues({
      ...HF,
      generatorSessionHealthy: null,
      generatorSessionReason: "keepalive has never run",
    }).find((i) => i.key === "generator_session_unknown");
    expect(hit?.severity).toBe("warning");
    expect(hit?.evidence).toContain("never run");
  });

  it("an OMITTED field counts as unknown, not as healthy", () => {
    // The luck this nearly shipped on: with the field absent it is `undefined`,
    // which `=== null` misses, so neither branch fired and a dead session read
    // clean. Spelled with an explicit cast because the type forbids what vitest
    // permits at runtime.
    const partial = { ...HF } as Record<string, unknown>;
    delete partial.generatorSessionHealthy;
    delete partial.generatorSessionReason;
    const keys = deriveDeliveryIssues(partial as unknown as DeliveryFacts).map((i) => i.key);
    expect(keys).toContain("generator_session_unknown");
  });

  it("liveness is only asked of the session provider — veo/template_stock stay silent", () => {
    for (const provider of ["veo", "template_stock"]) {
      const keys = deriveDeliveryIssues({ ...ALL_GREEN, generatorProvider: provider }).map((i) => i.key);
      expect(keys, provider).not.toContain("generator_session_unknown");
      expect(keys, provider).not.toContain("generator_session_expired");
    }
  });

  it("MISSING credentials still points at the paste field, not at Railway", () => {
    // Higgsfield's durable store is app_secret_kv. A static Railway env pair is
    // the design that died ~90 min after login because the CLI rotates tokens,
    // so the old nextAction named the one place that cannot hold a live session.
    const hit = deriveDeliveryIssues({ ...HF, generatorConfigured: false })
      .find((i) => i.key === "generator_credentials_missing");
    expect(hit?.nextAction).toContain("hf auth login");
    expect(hit?.nextAction).not.toContain("Railway");
    // Non-session providers keep the env-var instruction.
    const veo = deriveDeliveryIssues({ ...ALL_GREEN, generatorConfigured: false })
      .find((i) => i.key === "generator_credentials_missing");
    expect(veo?.nextAction).toContain("Railway");
  });
});
