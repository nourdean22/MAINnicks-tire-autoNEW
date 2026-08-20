/**
 * needs_regen surfaces — round 2, workflow-confirmed.
 *
 * 2026-08-20 · Higgsfield stock-fallback remediation. A hostile multi-lens
 * review of the round-1 self-audit (reelStockFallbackDead.test.ts) found six
 * MORE independent places that either hand-copied a status list without
 * needs_regen, or computed a metric that went blind to it once terminal
 * paid-provider failures stopped landing on "failed". Two were P0:
 * regenerateReelFromBrief reproduced a previously-fixed stuck-job + ledger-
 * leak defect (docs/NICKSTIRE-SCAN-LEDGER.md) via the newly-opened
 * needs_regen→regenerate path, and the 30-day reliability card + Telegram
 * /ig digest silently deflated the displayed failure rate.
 *
 * These are source-text assertions, not behavioral mocks, for the same
 * reason the round-1 file used them: each fix is a one- or two-token change
 * to a hand-copied literal (an allowlist entry, a WHERE clause, a strip
 * list), and proving the literal is actually present in the live file is a
 * direct, non-vacuous proof of the fix — independent of whatever mock shape
 * a DB-level test would need to construct.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const CONTENT = fs.readFileSync(path.join(__dirname, "routers", "content.ts"), "utf8");
const ADMIN_ROUTES = fs.readFileSync(path.join(__dirname, "routes", "adminRoutes.ts"), "utf8");
const QUALITY_GATE = fs.readFileSync(path.join(__dirname, "services", "qualityGate.ts"), "utf8");
const RELIABILITY = fs.readFileSync(path.join(__dirname, "services", "reelReliability.ts"), "utf8");
const SOCIAL_PIPELINE = fs.readFileSync(path.join(__dirname, "routers", "socialPipeline.ts"), "utf8");

describe("content.ts getReelJob — the Studio wizard's poll no longer sticks on needs_regen", () => {
  it("maps needs_regen into the same terminal bucket as failed, not the queued default", () => {
    expect(CONTENT).toMatch(/if \(row\.status === "failed" \|\| row\.status === "needs_regen"\) \{/);
  });
});

describe("content.ts discardReelJob — CLOSEABLE includes needs_regen", () => {
  it("the allowlist that gates the Discard/Archive mutation's UPDATE", () => {
    expect(CONTENT).toMatch(
      /const CLOSEABLE = \["assembled", "queued", "generating", "assets_ready", "assembling", "repair_rendering", "failed", "needs_regen"\];/,
    );
  });
});

describe("content.ts regenerateReelFromBrief — stale veoOperationName is stripped per beat", () => {
  it("deletes veoOperationName from every storyboard beat before enqueueing the new job", () => {
    expect(CONTENT).toMatch(
      /for \(const beat of beats\) \{\s*if \(beat && typeof beat === "object"\) delete \(beat as Record<string, unknown>\)\.veoOperationName;/,
    );
  });
  it("the strip happens before THIS function's own enqueueReelJob call, not after", () => {
    // content.ts imports enqueueReelJob in more than one procedure — anchor the
    // search to regenerateReelFromBrief's own body (from its CLOSEABLE-sibling
    // entry guard onward) so an unrelated earlier import elsewhere in the file
    // can't produce a false pass.
    const fnStart = CONTENT.indexOf("REGENERABLE_STATUSES, isRegenerable } = await import(\"../services/reelRecoverability\");");
    expect(fnStart).toBeGreaterThan(-1);
    const stripIdx = CONTENT.indexOf('delete (beat as Record<string, unknown>).veoOperationName;', fnStart);
    const enqueueIdx = CONTENT.indexOf('const { enqueueReelJob } = await import("../services/reelPipeline");', fnStart);
    expect(stripIdx).toBeGreaterThan(fnStart);
    expect(enqueueIdx).toBeGreaterThan(fnStart);
    expect(stripIdx).toBeLessThan(enqueueIdx);
  });
});

describe("adminRoutes.ts — the /api/admin/reel-jobs/attention REST endpoint's own ATTENTION list includes needs_regen", () => {
  it("a second, independently-maintained status array now agrees with the canonical predicate", () => {
    expect(ADMIN_ROUTES).toMatch(
      /const ATTENTION = \["assembled", "publishing", "publish_ambiguous", "queued", "generating", "assets_ready", "assembling", "repair_rendering", "needs_regen"\];/,
    );
  });
});

describe("qualityGate.ts — the paid-repair circuit breaker counts needs_regen alongside failed", () => {
  it("providerHealthy's hourly count is no longer blind to the outage population this remediation creates", () => {
    expect(QUALITY_GATE).toMatch(
      /\.where\(and\(inArray\(reelJobs\.status, \["failed", "needs_regen"\]\), gte\(reelJobs\.updatedAt, since\)\)\);/,
    );
  });
});

describe("reelReliability.ts — the 30-day failure rate counts open needs_regen rows as failures", () => {
  it("failed now includes byStatus.needs_regen, not just the closed-adjusted failed bucket", () => {
    expect(RELIABILITY).toMatch(
      /const failed = Math\.max\(0, \(byStatus\.failed \?\? 0\) - closedFailures\) \+ \(byStatus\.needs_regen \?\? 0\);/,
    );
  });
});

describe("socialPipeline.ts — the kill-switch panel no longer describes a dead flag as live", () => {
  it("REEL_FALLBACK_TO_TEMPLATE_STOCK's description now says DEFUNCT", () => {
    const match = SOCIAL_PIPELINE.match(/key: "REEL_FALLBACK_TO_TEMPLATE_STOCK", description: "([^"]*)"/);
    expect(match).not.toBeNull();
    expect(match?.[1]).toMatch(/^DEFUNCT/);
  });
});
