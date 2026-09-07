/**
 * Delivery eligibility — approving something for the 14th, and the bytes trap.
 *
 * THE PROBLEM. `reel_publish_approvals` carries a rolling 72h TTL, adopted from
 * the Studio lane. That is the right question for an unattended door ("is this
 * yes still fresh?") and the wrong one for scheduling: an approval granted today
 * expires four days before a slot two weeks out, so approving ahead is
 * structurally impossible. Deleting the TTL would solve the wrong problem — it
 * exists because nobody is watching when this fires.
 *
 * So creative approval (a human read THESE bytes) and delivery eligibility (that
 * human also authorized WHEN) are separated. A window GOVERNS when present; the
 * TTL applies when it is absent, unchanged.
 *
 * BOTH DIRECTIONS ARE ASSERTED. A queue that blocks everything is exactly as
 * broken as one that blocks nothing, and far easier to ship by accident — the
 * module's own header says so, and this file honours it: every "blocks" test has
 * a matching "still publishes" test.
 *
 * These are pure-function tests. `approvalProblem` takes `now` as a parameter
 * precisely so time can be asserted without a clock.
 */
import { describe, it, expect } from "vitest";
import {
  approvalProblem,
  isApprovedToPublish,
  APPROVAL_BLOCK,
  REEL_APPROVAL_TTL_HOURS,
  type ReelApprovalRecord,
  type ReelPublishCandidate,
} from "@shared/reelApproval";

const NOW = new Date("2026-09-07T12:00:00Z");
const hours = (n: number) => new Date(NOW.getTime() + n * 3600_000);
const days = (n: number) => hours(n * 24);

const candidate: ReelPublishCandidate = {
  jobId: 42,
  captionFingerprint: "cap-fingerprint",
  videoUrl: "https://nickstire.org/generated/reels/reel-42.mp4",
};

const base: ReelApprovalRecord = {
  reelJobId: 42,
  captionFingerprint: "cap-fingerprint",
  videoUrl: "https://nickstire.org/generated/reels/reel-42.mp4",
  approvedBy: "nour@nickstire.org",
  approvedAt: NOW,
  expiresAt: hours(REEL_APPROVAL_TTL_HOURS),
};

describe("the case that was impossible: approve on day 0, publish on day 14", () => {
  const scheduled: ReelApprovalRecord = {
    ...base,
    // The TTL would have lapsed 11 days before the slot.
    expiresAt: hours(REEL_APPROVAL_TTL_HOURS),
    publishWindowStart: days(14),
    publishWindowEnd: days(15),
  };

  it("does not publish before the window opens — not blocked, not due", () => {
    const p = approvalProblem(candidate, scheduled, days(13));
    expect(p?.code).toBe(APPROVAL_BLOCK.notYetDue);
  });

  it("PUBLISHES inside the window, even though the rolling TTL lapsed on day 3", () => {
    // The whole point. Without the window the 72h TTL would refuse this.
    expect(isApprovedToPublish(candidate, scheduled, days(14.5))).toBe(true);
  });

  it("does not publish after the window closes", () => {
    const p = approvalProblem(candidate, scheduled, days(16));
    expect(p?.code).toBe(APPROVAL_BLOCK.windowPassed);
  });

  it("a passed window is not a licence to post late", () => {
    const p = approvalProblem(candidate, scheduled, days(30));
    expect(p?.code).toBe(APPROVAL_BLOCK.windowPassed);
    expect(p?.reason).toMatch(/not a licence to post late/);
  });
});

describe("the window governs, but never weakens anything else", () => {
  const open: ReelApprovalRecord = { ...base, publishWindowStart: days(-1), publishWindowEnd: days(1) };

  it("revocation still wins inside an open window", () => {
    const p = approvalProblem(candidate, { ...open, revokedAt: NOW }, NOW);
    expect(p?.code).toBe(APPROVAL_BLOCK.revoked);
  });

  it("a changed caption still voids it inside an open window", () => {
    const p = approvalProblem({ ...candidate, captionFingerprint: "edited" }, open, NOW);
    expect(p?.code).toBe(APPROVAL_BLOCK.captionChanged);
  });

  it("a changed asset URL still voids it inside an open window", () => {
    const p = approvalProblem({ ...candidate, videoUrl: "https://other/x.mp4" }, open, NOW);
    expect(p?.code).toBe(APPROVAL_BLOCK.videoChanged);
  });

  it("an anonymous approval is still refused inside an open window", () => {
    const p = approvalProblem(candidate, { ...open, approvedBy: "  " }, NOW);
    expect(p?.code).toBe(APPROVAL_BLOCK.anonymous);
  });

  it("an approval for another job is still not transferable", () => {
    const p = approvalProblem(candidate, { ...open, reelJobId: 99 }, NOW);
    expect(p?.code).toBe(APPROVAL_BLOCK.wrongJob);
  });
});

describe("with no window, behaviour is exactly what it was", () => {
  it("still publishes inside the 72h TTL", () => {
    expect(isApprovedToPublish(candidate, base, hours(1))).toBe(true);
  });

  it("still expires after the TTL", () => {
    const p = approvalProblem(candidate, base, hours(REEL_APPROVAL_TTL_HOURS + 1));
    expect(p?.code).toBe(APPROVAL_BLOCK.expired);
  });

  it("still honours a legacy row with no expiry at all", () => {
    // A migration must not brick a queue — the same tolerance 0112 applied.
    expect(isApprovedToPublish(candidate, { ...base, expiresAt: null }, days(365))).toBe(true);
  });

  it("an open-ended window (start only) publishes forever once it opens", () => {
    const openEnded: ReelApprovalRecord = { ...base, publishWindowStart: days(2), publishWindowEnd: null };
    expect(isApprovedToPublish(candidate, openEnded, days(1))).toBe(false);
    expect(isApprovedToPublish(candidate, openEnded, days(400))).toBe(true);
  });

  it("an unparseable window date does not silently block", () => {
    // toTime returns null for garbage, and null never blocks by itself —
    // otherwise a bad string would hold the queue with no readable reason.
    const bad: ReelApprovalRecord = { ...base, publishWindowStart: "not-a-date", publishWindowEnd: null };
    expect(isApprovedToPublish(candidate, bad, NOW)).toBe(true);
  });
});

describe("a stable URL is not proof of unchanged bytes", () => {
  const withDigest: ReelApprovalRecord = { ...base, assetSha256: "a".repeat(64) };

  it("publishes when the digest matches", () => {
    expect(isApprovedToPublish({ ...candidate, assetSha256: "a".repeat(64) }, withDigest, NOW)).toBe(true);
  });

  it("REFUSES when the bytes changed but the URL did not", () => {
    // storagePut writes to a deterministic key (reels/reel-<jobId>.mp4), so a
    // re-render or a beat repair yields the same URL with different content.
    const p = approvalProblem({ ...candidate, assetSha256: "b".repeat(64) }, withDigest, NOW);
    expect(p?.code).toBe(APPROVAL_BLOCK.assetBytesChanged);
    expect(p?.reason).toMatch(/even though the URL\s+did not|even though the URL did not/);
  });

  it("REFUSES when it cannot verify — 'could not check' is not 'unchanged'", () => {
    const p = approvalProblem(candidate, withDigest, NOW);
    expect(p?.code).toBe(APPROVAL_BLOCK.assetDigestUnverifiable);
  });

  it("skips the check for approvals recorded before digests existed", () => {
    expect(isApprovedToPublish({ ...candidate, assetSha256: null }, base, NOW)).toBe(true);
  });
});

describe("fail-closed still holds", () => {
  it("no approval at all still blocks", () => {
    expect(approvalProblem(candidate, null, NOW)?.code).toBe(APPROVAL_BLOCK.missing);
  });

  it("every block code is a distinct, stable string the cron can write", () => {
    const codes = Object.values(APPROVAL_BLOCK);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of codes) {
      // Written into reel_jobs.error as "HELD awaiting approval [code]" and that
      // column is varchar(1000); a code must stay short and machine-readable.
      expect(c).toMatch(/^[a-z_]+$/);
      expect(c.length).toBeLessThan(48);
    }
  });
});
