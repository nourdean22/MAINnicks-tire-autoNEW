import { beforeEach, describe, expect, it, vi } from "vitest";

const findUnreconciledAttempts = vi.fn();
const recordPublishOutcome = vi.fn();
const reconcileAttempt = vi.fn();
const applyReconciliation = vi.fn();

vi.mock("./services/publishAttemptLedger", () => ({
  findUnreconciledAttempts,
  recordPublishOutcome,
  OUTCOME: {
    attempted: "ATTEMPTED",
    confirmed: "CONFIRMED",
    failed: "FAILED",
    ambiguous: "AMBIGUOUS",
    operatorRequired: "OPERATOR_REQUIRED",
  },
}));

vi.mock("./services/publishReconciler", () => ({
  reconcileAttempt,
  applyReconciliation,
}));

import { reconcileAmbiguousPublishes } from "./services/publishReconcileLane";

const attempt = (over: Record<string, unknown> = {}) => ({
  attemptId: "pub_1",
  occurredAt: new Date("2026-09-28T00:00:00.000Z"),
  kind: "reel_job",
  jobId: 41,
  scheduledPostId: null,
  inventoryId: "inv_1",
  platforms: ["instagram"],
  expectedCaption: "Exact caption dispatched",
  operatorRequired: false,
  handoffCandidates: [],
  handoffDetail: null,
  ageMinutes: 120,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  findUnreconciledAttempts.mockResolvedValue([attempt()]);
  recordPublishOutcome.mockResolvedValue(undefined);
  applyReconciliation.mockResolvedValue({ ok: true, detail: "ok" });
});

describe("reconcileAmbiguousPublishes behavior", () => {
  it("persists candidates before permanently handing a judgement case to the operator", async () => {
    reconcileAttempt.mockResolvedValue({
      status: "needs_operator",
      detail: "two plausible posts",
      candidates: [
        { igPostId: "ig_a", permalink: "https://instagram.com/p/a", caption: "a", postedAt: "2026-09-28T00:05:00Z", minutesFromAttempt: 5, reasoning: "candidate", confident: false },
      ],
    });

    const result = await reconcileAmbiguousPublishes();

    expect(result.checked).toBe(1);
    expect(recordPublishOutcome).toHaveBeenCalledWith(
      "pub_1",
      "OPERATOR_REQUIRED",
      expect.objectContaining({
        platformResults: expect.objectContaining({
          detail: "two plausible posts",
          candidates: [expect.objectContaining({ igPostId: "ig_a" })],
          handoffReason: "needs_operator",
        }),
      }),
    );
    expect(applyReconciliation).not.toHaveBeenCalled();
  });

  it("marks exhausted history for one-time operator handoff without inventing candidates", async () => {
    reconcileAttempt.mockResolvedValue({
      status: "cannot_check",
      reason: "history_window_exhausted",
      detail: "recent-media page no longer reaches the attempt",
    });

    await reconcileAmbiguousPublishes();

    expect(recordPublishOutcome).toHaveBeenCalledWith(
      "pub_1",
      "OPERATOR_REQUIRED",
      expect.objectContaining({
        platformResults: expect.objectContaining({
          candidates: [],
          handoffReason: "history_window_exhausted",
        }),
      }),
    );
  });

  it("does not persist a handoff for transient Meta failure, so a future pulse can retry", async () => {
    reconcileAttempt.mockResolvedValue({
      status: "cannot_check",
      reason: "meta_unavailable",
      detail: "token refresh in progress",
    });

    const result = await reconcileAmbiguousPublishes();

    expect(result.leftForOperator).toEqual([{ jobId: 41, why: "retry_later" }]);
    expect(recordPublishOutcome).not.toHaveBeenCalled();
    expect(applyReconciliation).not.toHaveBeenCalled();
  });

  it("skips an attempt already durably handed to the operator", async () => {
    findUnreconciledAttempts.mockResolvedValue([attempt({ operatorRequired: true })]);

    const result = await reconcileAmbiguousPublishes();

    expect(result.checked).toBe(0);
    expect(reconcileAttempt).not.toHaveBeenCalled();
    expect(recordPublishOutcome).not.toHaveBeenCalled();
  });

  it("applies only an evidenced published verdict", async () => {
    reconcileAttempt.mockResolvedValue({
      status: "resolved_published",
      igPostId: "ig_exact",
      permalink: "https://instagram.com/p/exact",
      detail: "full normalized caption matched",
    });

    const result = await reconcileAmbiguousPublishes();

    expect(applyReconciliation).toHaveBeenCalledWith(expect.objectContaining({
      kind: "reel_job",
      jobId: 41,
      attemptId: "pub_1",
      decision: "published",
      igPostId: "ig_exact",
    }));
    expect(result.resolvedPublished).toEqual([41]);
    expect(recordPublishOutcome).not.toHaveBeenCalled();
  });
});

describe("an attempt that also went to the Facebook Page is never auto-released (review of #2865)", () => {
  const notOnInstagram = { status: "resolved_not_published", detail: "No post appeared on the account within 30 minutes of the attempt." };

  it("hands it to the operator: Instagram's silence says nothing about the Page", async () => {
    findUnreconciledAttempts.mockResolvedValue([attempt({ platforms: ["instagram", "facebook"] })]);
    reconcileAttempt.mockResolvedValue(notOnInstagram);

    const result = await reconcileAmbiguousPublishes();

    expect(applyReconciliation).not.toHaveBeenCalled();
    expect(result.resolvedNotPublished).toEqual([]);
    expect(result.leftForOperator).toEqual([{ jobId: 41, why: "facebook_unverifiable" }]);
    expect(recordPublishOutcome).toHaveBeenCalledWith("pub_1", "OPERATOR_REQUIRED", expect.objectContaining({
      platformResults: expect.objectContaining({ handoffReason: "facebook_unverifiable" }),
    }));
  });

  it("control: an Instagram-only attempt with no post is still released for a retry", async () => {
    findUnreconciledAttempts.mockResolvedValue([attempt({ platforms: ["instagram"] })]);
    reconcileAttempt.mockResolvedValue(notOnInstagram);

    const result = await reconcileAmbiguousPublishes();

    expect(applyReconciliation).toHaveBeenCalledWith(expect.objectContaining({ jobId: 41, decision: "not_published" }));
    expect(result.resolvedNotPublished).toEqual([41]);
  });
});
