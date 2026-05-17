/**
 * v10.0.18 · Tests for slow-query tracker.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  recordSlowQuery,
  getTopSlowQueries,
  getSlowQueryStats,
  _resetSlowQueryBuffer,
} from "@/lib/db/slow-query-tracker";

beforeEach(() => {
  _resetSlowQueryBuffer();
});

describe("v10.0.18 · slow-query tracker", () => {
  it("returns empty stats + top when nothing recorded", () => {
    expect(getTopSlowQueries()).toEqual([]);
    const s = getSlowQueryStats();
    expect(s.trackedShapes).toBe(0);
    expect(s.totalHits).toBe(0);
    expect(s.slowestMs).toBeNull();
  });

  it("ignores queries below the threshold (250ms)", () => {
    recordSlowQuery("SELECT * FROM users", 100);
    recordSlowQuery("SELECT * FROM users", 200);
    expect(getTopSlowQueries().length).toBe(0);
  });

  it("dedupes by shape and tracks max + count", () => {
    recordSlowQuery("SELECT * FROM users", 600);
    recordSlowQuery("SELECT * FROM users", 800);
    recordSlowQuery("SELECT * FROM users", 700);
    const top = getTopSlowQueries();
    expect(top.length).toBe(1);
    expect(top[0].maxMs).toBe(800);
    expect(top[0].hitCount).toBe(3);
  });

  it("sorts top by maxMs descending", () => {
    recordSlowQuery("A", 600);
    recordSlowQuery("B", 1500);
    recordSlowQuery("C", 900);
    const top = getTopSlowQueries();
    expect(top.map((t) => t.shape)).toEqual(["B", "C", "A"]);
  });

  it("clamps limit to [1, 50]", () => {
    for (let i = 0; i < 60; i++) recordSlowQuery(`shape_${i}`, 600 + i);
    expect(getTopSlowQueries(0).length).toBe(1); // clamped to 1
    expect(getTopSlowQueries(100).length).toBeGreaterThan(0); // clamped to 50
    expect(getTopSlowQueries(100).length).toBeLessThanOrEqual(50);
  });

  it("truncates very long shapes to keep memory bounded", () => {
    const long = "SELECT".repeat(100); // 600 chars
    recordSlowQuery(long, 800);
    const top = getTopSlowQueries();
    expect(top[0].shape.length).toBeLessThan(long.length);
    expect(top[0].shape.endsWith("…")).toBe(true);
  });

  it("stats roll up correctly across multiple shapes", () => {
    recordSlowQuery("A", 600);
    recordSlowQuery("A", 700);
    recordSlowQuery("B", 1200);
    const s = getSlowQueryStats();
    expect(s.trackedShapes).toBe(2);
    expect(s.totalHits).toBe(3);
    expect(s.slowestMs).toBe(1200);
  });
});
