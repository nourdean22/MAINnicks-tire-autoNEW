/**
 * The /ig formatters must never render UNKNOWN as ZERO.
 *
 * nickstire pays real complexity to distinguish "we could not read this" from
 * "there were none" — nullable counts in DeliveryFacts and an all-null
 * ReelReliability on an unreadable table. A single `?? 0` on the Telegram side
 * would convert a database outage into a clean bill of health and throw that
 * discipline away. These are the pins that stop it.
 */
import { describe, it, expect } from "vitest";
import {
  formatDeliveryIssues,
  formatReelReliability,
  formatAutopostLane,
  igNum,
  type IgDeliveryFacts,
  type IgDeliveryIssue,
  type IgReelReliability,
} from "@/lib/telegram/ig-format";

const FACTS: IgDeliveryFacts = {
  generatorProvider: "veo",
  generatorConfigured: true,
  generationEnabled: true,
  reelPublishArmed: true,
  metaLive: true,
  publishAmbiguousReelJobs: 0,
  jobsNeedingAttention: 0,
};

const BLOCKER: IgDeliveryIssue = {
  key: "storage",
  layer: "asset_hosting",
  severity: "blocker",
  reason: "S3_BUCKET is not set",
  evidence: "env read",
  nextAction: "Set S3_BUCKET on Railway",
};

const HEALTHY_REELS: IgReelReliability = {
  windowDays: 30,
  total: 50,
  byStatus: { posted: 30, published: 5, failed: 15 },
  succeeded: 35,
  failed: 10,
  closedFailures: 5,
  ambiguous: 0,
  failureRate: 0.22,
};

describe("igNum — unknown is not zero", () => {
  it("renders null and undefined as unknown", () => {
    expect(igNum(null)).toBe("unknown");
    expect(igNum(undefined)).toBe("unknown");
  });

  it("still renders a real zero as 0", () => {
    expect(igNum(0)).toBe("0");
  });
});

describe("formatReelReliability", () => {
  it("says UNKNOWN, not healthy, when the table could not be read", () => {
    const unreadable: IgReelReliability = {
      windowDays: 30,
      total: null,
      byStatus: {},
      succeeded: null,
      failed: null,
      closedFailures: null,
      ambiguous: null,
      failureRate: null,
    };
    const out = formatReelReliability(unreadable);
    expect(out).toContain("UNKNOWN, not healthy");
    // The failure mode being prevented: an outage rendering as a clean zero.
    expect(out).not.toContain("0 jobs");
  });

  it("renders the counts and the closed-excluded rate", () => {
    const out = formatReelReliability(HEALTHY_REELS);
    expect(out).toContain("50 jobs");
    expect(out).toContain("35 ok");
    expect(out).toContain("10 unresolved");
    expect(out).toContain("5 closed by you");
    expect(out).toContain("22%");
    expect(out).toContain("closed excluded both sides");
  });

  it("warns not to retry an ambiguous publish blind", () => {
    const out = formatReelReliability({ ...HEALTHY_REELS, ambiguous: 2 });
    expect(out).toContain("2 ambiguous");
    expect(out).toContain("do not retry blind");
  });

  it("renders an unknown failure rate rather than inventing 0%", () => {
    const out = formatReelReliability({ ...HEALTHY_REELS, failureRate: null });
    expect(out).toContain("failure rate unknown");
    expect(out).not.toContain("failure rate 0%");
  });
});

describe("formatDeliveryIssues", () => {
  it("renders unreadable facts as unknown, never as zero", () => {
    const out = formatDeliveryIssues({
      issues: [],
      facts: { ...FACTS, jobsNeedingAttention: null, publishAmbiguousReelJobs: null },
    });
    expect(out).toContain("attention: unknown");
    expect(out).toContain("ambiguous: unknown");
    expect(out).not.toContain("attention: 0");
  });

  it("distinguishes meta unknown from meta down", () => {
    expect(formatDeliveryIssues({ issues: [], facts: { ...FACTS, metaLive: null } })).toContain(
      "meta unknown",
    );
    expect(formatDeliveryIssues({ issues: [], facts: { ...FACTS, metaLive: false } })).toContain(
      "meta DOWN",
    );
  });

  it("counts blockers and shows the smallest next action", () => {
    const out = formatDeliveryIssues({ issues: [BLOCKER], facts: FACTS });
    expect(out).toContain("1 blocker");
    expect(out).toContain("S3_BUCKET is not set");
    expect(out).toContain("Set S3_BUCKET on Railway");
  });

  it("collapses deliberate control state to a count instead of painting it red", () => {
    const info: IgDeliveryIssue = {
      ...BLOCKER,
      key: "kill",
      severity: "info",
      layer: "kill_switch",
      reason: "publishing kill switch is ON",
      nextAction: "turn it off when ready",
    };
    const out = formatDeliveryIssues({ issues: [BLOCKER, info], facts: FACTS });
    expect(out).toContain("1 info item");
    expect(out).toContain("deliberate control state");
    // The info item's prose must not appear as its own red stanza.
    expect(out).not.toContain("publishing kill switch is ON");
  });

  it("reports missing generator credentials rather than hiding them", () => {
    const out = formatDeliveryIssues({
      issues: [],
      facts: { ...FACTS, generatorConfigured: false },
    });
    expect(out).toContain("creds MISSING");
  });

  it("escapes HTML so a hostile reason cannot break the message", () => {
    const out = formatDeliveryIssues({
      issues: [{ ...BLOCKER, reason: "<b>boom</b> & <script>" }],
      facts: FACTS,
    });
    expect(out).toContain("&lt;b&gt;boom&lt;/b&gt; &amp; &lt;script&gt;");
  });
});

describe("formatAutopostLane", () => {
  it("treats BOTH posted and published as success", () => {
    // Prod carries both spellings; counting only one is a documented bug class.
    const out = formatAutopostLane({
      livePostingEnabled: true,
      latestLogs: [
        { archetype: "a", status: "posted", createdAt: "2026-08-01T12:00:00Z", error: null },
        { archetype: "b", status: "published", createdAt: "2026-08-02T12:00:00Z", error: null },
      ],
    });
    expect(out.match(/✅/g)).toHaveLength(2);
    expect(out).not.toContain("⚪");
  });

  it("names the lane so an empty log is not read as 'nothing posted'", () => {
    const out = formatAutopostLane({ livePostingEnabled: false, latestLogs: [] });
    expect(out).toContain("autopost lane");
    expect(out).toContain("No autopost runs recorded.");
    expect(out).toContain("Reels publish separately");
  });

  it("says UNKNOWN when the log table could not be read, not 'no runs'", () => {
    // An empty log and an unreadable one are not the same thing. Three
    // independent reviewers flagged this as the one path that could still
    // render an outage as calm.
    const out = formatAutopostLane({ livePostingEnabled: true, latestLogs: [], dbReadable: false });
    expect(out).toContain("UNKNOWN, not healthy");
    expect(out).not.toContain("No autopost runs recorded.");
  });

  it("treats an absent dbReadable as readable, so older producers behave as before", () => {
    const out = formatAutopostLane({ livePostingEnabled: false, latestLogs: [] });
    expect(out).toContain("No autopost runs recorded.");
    expect(out).not.toContain("UNKNOWN");
  });

  it("surfaces the error text on a failed run", () => {
    const out = formatAutopostLane({
      livePostingEnabled: true,
      latestLogs: [
        { archetype: "seasonal", status: "failed", createdAt: null, error: "provider 402" },
      ],
    });
    expect(out).toContain("❌");
    expect(out).toContain("provider 402");
  });
});
