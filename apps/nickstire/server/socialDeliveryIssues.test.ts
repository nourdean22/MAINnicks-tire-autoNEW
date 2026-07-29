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

const ALL_GREEN: DeliveryFacts = {
  storageConfigured: true,
  permanentUrls: true,
  metaConfigured: true,
  metaLive: true,
  metaLiveError: null,
  generatorProvider: "veo",
  generatorConfigured: true,
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

  it("S3 set without CloudFront is a WARNING, not a blocker — prod's measured 2026-07-29 state must not false-alarm", () => {
    const issues = deriveDeliveryIssues({ ...ALL_GREEN, storageConfigured: true, permanentUrls: false });
    expect(issues.find((i) => i.key === "storage_bucket_not_connected")).toBeFalsy();
    const hit = issues.find((i) => i.key === "storage_urls_not_permanent");
    expect(hit?.severity).toBe("warning");
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
