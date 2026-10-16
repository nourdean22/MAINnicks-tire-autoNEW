/**
 * tests/brain/arbiter-judge-split-readonly.test.ts · 2026-10-16 (Brain W1)
 *
 * scripts/arbiter-judge-split.ts points at whatever DATABASE_URL the shell
 * holds (every worktree binds prod), so it is SELECT-only by construction and
 * that is pinned here, the same scan tests/observability/otel-export.test.ts
 * runs on export-otel-traces.ts. Method-call shapes, so the file's own prose
 * cannot satisfy or trip the scan.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../../scripts/arbiter-judge-split.ts", import.meta.url), "utf8");

describe("the arbiter judge-split CLI is read-only by construction", () => {
  it.each([
    ["create", /\.create(Many)?\s*\(/],
    ["update", /\.update(Many)?\s*\(/],
    ["delete", /\.delete(Many)?\s*\(/],
    ["upsert", /\.upsert\s*\(/],
    ["raw execute", /\$executeRaw/],
    ["raw query", /\$queryRaw/],
  ])("contains no %s call", (_label, pattern) => {
    expect(src).not.toMatch(pattern);
  });

  it("still actually reads judge rows and chat messages (the scan above is not passing by vacuity)", () => {
    expect(src).toMatch(/brainMemory\.findMany\s*\(/);
    expect(src).toMatch(/chatMessage\.findMany\s*\(/);
    expect(src).toMatch(/reply_judgment/);
  });

  it("splits by the persisted contextReceipt.arbiter into true / false / unknown, 7-day default window", () => {
    expect(src).toMatch(/contextReceipt/);
    expect(src).toMatch(/"unknown"/);
    expect(src).toMatch(/--days/);
    expect(src).toMatch(/\?\?\s*7\b/);
    expect(src).toMatch(/p50/);
    expect(src).toMatch(/mean/);
  });

  it("refuses to run without a DATABASE_URL rather than defaulting", () => {
    expect(src).toMatch(/DATABASE_URL/);
    expect(src).toMatch(/process\.exit\(1\)/);
  });
});
