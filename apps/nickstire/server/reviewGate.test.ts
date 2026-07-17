/**
 * Review-aware completion gate — the classifier over GitHub GraphQL shapes.
 * (The CLI was ALSO live-verified against real PRs #820/#824 this session —
 * it reproduced the 3 known findings and surfaced 2 unknown ones.)
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs module, no type declarations by design
import { classifyReviewState } from "../scripts/check-review-gate.mjs";

const thread = (severity: string | null, resolved = false) => ({
  isResolved: resolved,
  comments: { nodes: [{ body: severity ? `![${severity} Badge](x) Finding text here` : "just an observation, no badge" }] },
});

const pr = (over: Record<string, unknown> = {}) => ({
  merged: false,
  headRefOid: "headsha00000000",
  reviewThreads: { nodes: [] },
  reviews: { nodes: [] },
  commits: { nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS" } } }] },
  ...over,
});

describe("classifyReviewState", () => {
  it("unresolved P0/P1/P2 threads block; resolved and informational threads do not", () => {
    const r = classifyReviewState(pr({ reviewThreads: { nodes: [thread("P1"), thread("P2", true), thread(null)] } }));
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]).toContain("unresolved P1");
    expect(r.advisories).toHaveLength(1);
  });

  it("pending CI blocks pre-merge, except in skip-ci mode (a job cannot demand its own completion)", () => {
    const pending = pr({ commits: { nodes: [{ commit: { statusCheckRollup: { state: "PENDING" } } }] } });
    expect(classifyReviewState(pending).violations[0]).toContain("PENDING");
    expect(classifyReviewState(pending, { skipCiCheck: true }).violations).toHaveLength(0);
  });

  it("a stale approval (head moved after review) blocks; a current one does not", () => {
    const stale = pr({ reviews: { nodes: [{ state: "APPROVED", author: { login: "rev" }, commit: { oid: "oldsha000000000" } }] } });
    expect(classifyReviewState(stale).violations[0]).toContain("STALE approval");
    const current = pr({ reviews: { nodes: [{ state: "APPROVED", author: { login: "rev" }, commit: { oid: "headsha00000000" } }] } });
    expect(classifyReviewState(current).violations).toHaveLength(0);
  });

  it("only the LATEST review per author counts — a superseded CHANGES_REQUESTED clears", () => {
    const superseded = pr({
      reviews: { nodes: [
        { state: "CHANGES_REQUESTED", author: { login: "rev" }, commit: { oid: "a" } },
        { state: "APPROVED", author: { login: "rev" }, commit: { oid: "headsha00000000" } },
      ] },
    });
    expect(classifyReviewState(superseded).violations).toHaveLength(0);
    const outstanding = pr({ reviews: { nodes: [{ state: "CHANGES_REQUESTED", author: { login: "rev" }, commit: { oid: "a" } }] } });
    expect(classifyReviewState(outstanding).violations[0]).toContain("CHANGES_REQUESTED");
  });

  it("merged PRs report post-merge mode and skip the CI condition", () => {
    const merged = pr({ merged: true, reviewThreads: { nodes: [thread("P2")] }, commits: { nodes: [{ commit: { statusCheckRollup: { state: "PENDING" } } }] } });
    const r = classifyReviewState(merged);
    expect(r.mode).toBe("post-merge");
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]).toContain("unresolved P2");
  });
});
