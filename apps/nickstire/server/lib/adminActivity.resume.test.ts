import { describe, it, expect } from "vitest";
import { isResumeEdge } from "./adminActivity";

const H = 60 * 60 * 1000;

describe("isResumeEdge — session-resume probe trigger", () => {
  const now = 1_800_000_000_000;

  it("first touch ever (prev=0) nominates an edge", () => {
    expect(isResumeEdge(0, now)).toBe(true);
  });

  it("continuous browsing is NOT an edge", () => {
    expect(isResumeEdge(now - 30_000, now)).toBe(false);
    expect(isResumeEdge(now - 10 * 60 * 1000, now)).toBe(false);
  });

  it("post-deploy startup arm (~8min ago) is NOT an edge — deploys must not probe", () => {
    expect(isResumeEdge(now - 8 * 60 * 1000, now)).toBe(false);
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
