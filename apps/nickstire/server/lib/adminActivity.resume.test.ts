import { describe, it, expect } from "vitest";
import { isResumeEdge, AUTH_ATTEMPTING_OUTCOMES } from "./adminActivity";

const H = 60 * 60 * 1000;

describe("isResumeEdge — session-resume probe trigger (real-touch semantics)", () => {
  const now = 1_800_000_000_000;

  it("no REAL touch since boot (prevReal=0) nominates an edge — the DB throttle decides", () => {
    // Strike-1 fix: the synthetic startup arm never writes lastRealTouchMs,
    // so the operator's first real touch after a deploy is an edge even when
    // the arm back-dated lastTouchMs minutes earlier. Pre-fix, a deploy
    // shortly before the morning open erased the overnight human gap.
    expect(isResumeEdge(0, now)).toBe(true);
  });

  it("continuous browsing is NOT an edge", () => {
    expect(isResumeEdge(now - 30_000, now)).toBe(false);
    expect(isResumeEdge(now - 10 * 60 * 1000, now)).toBe(false);
  });

  it("gap just under 6h is NOT an edge", () => {
    expect(isResumeEdge(now - (6 * H - 1), now)).toBe(false);
  });

  it("gap of 6h+ IS an edge (morning open after overnight)", () => {
    expect(isResumeEdge(now - 6 * H, now)).toBe(true);
    expect(isResumeEdge(now - 14 * H, now)).toBe(true);
  });

  it("custom gap override respected", () => {
    expect(isResumeEdge(now - 2 * H, now, 1 * H)).toBe(true);
    expect(isResumeEdge(now - 2 * H, now, 3 * H)).toBe(false);
  });
});

describe("AUTH_ATTEMPTING_OUTCOMES — throttle counts every counter-kicking outcome", () => {
  it("includes every outcome that attempted an ALG authentication", () => {
    // `empty` is the load-bearing member: the probe authenticated (kicked
    // the counter's session) and found nothing new. Pre-fix the throttle
    // only counted `success`, so an empty probe minutes ago did not
    // suppress the next resume probe.
    expect(AUTH_ATTEMPTING_OUTCOMES).toContain("success");
    expect(AUTH_ATTEMPTING_OUTCOMES).toContain("empty");
    expect(AUTH_ATTEMPTING_OUTCOMES).toContain("auth_failed");
    expect(AUTH_ATTEMPTING_OUTCOMES).toContain("error");
  });

  it("excludes outcomes that never reach authentication", () => {
    const list = AUTH_ATTEMPTING_OUTCOMES as readonly string[];
    expect(list).not.toContain("dedup");
    expect(list).not.toContain("skipped_recent");
  });
});
