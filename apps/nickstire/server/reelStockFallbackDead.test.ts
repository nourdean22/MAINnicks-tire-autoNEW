/**
 * The silent stock fallback is DEAD — at the source, not just at the door.
 *
 * 2026-08-20 · Higgsfield stock-fallback remediation, Phase 2. This REPLACES
 * reelFreeLaneFallback.test.ts, which pinned the exact behavior being removed:
 * when a paid provider failed, the pipeline substituted free template-stock
 * footage and published it (7 stock reels reached Instagram). The operator
 * reversed that tradeoff — silence over stock. A paid-provider failure now
 * routes the job to `needs_regen` (non-publishable, surfaced, regenerated),
 * and the keystone publish guard (reelStockPublishGuard.test.ts) is the
 * backstop.
 *
 * Two proofs: the routing unit, and source-assertions that the degrade wiring
 * is GONE — the inverse of the assertions the old file made.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { terminalPaidFailureIsNeedsRegen, REEL_GENERATION_TERMINAL_STATUSES } from "./services/reelPipeline";

describe("terminalPaidFailureIsNeedsRegen — the routing that replaced the stock rescue", () => {
  it("routes a terminal higgsfield failure to needs_regen (was: rescued to stock + published)", () => {
    expect(terminalPaidFailureIsNeedsRegen(true, "higgsfield")).toBe(true);
  });
  it("routes a terminal veo failure to needs_regen too", () => {
    expect(terminalPaidFailureIsNeedsRegen(true, "veo")).toBe(true);
  });
  it("does NOT touch template_stock — it has nowhere lower to fall, keeps its own terminal status", () => {
    expect(terminalPaidFailureIsNeedsRegen(true, "template_stock")).toBe(false);
  });
  it("does NOT route a NON-terminal (retryable) failure — those still retry", () => {
    expect(terminalPaidFailureIsNeedsRegen(false, "higgsfield")).toBe(false);
  });
  it("is safe when the provider is unknown", () => {
    expect(terminalPaidFailureIsNeedsRegen(true, undefined)).toBe(false);
  });
});

describe("REEL_GENERATION_TERMINAL_STATUSES — the shared list that closed the content.ts gap", () => {
  // Self-audit 2026-08-20: adding "needs_regen" without updating every caller
  // that polled processNextReelJob for one job left server/routers/content.ts's
  // admin-triggered generation loop unable to recognize the new terminal
  // status — it matched neither the success branch nor (then-only) "failed",
  // looped with no sleep/break, then burned its remaining attempts on 2s
  // no-op sleeps once the job left "queued", surfacing a BLANK
  // "Reel clip generation failed or timed out: " error with the real reason
  // lost. This constant is what content.ts now checks instead of a literal
  // string, so the next status addition can't repeat the same miss silently.
  it("contains both terminal generation statuses", () => {
    expect(REEL_GENERATION_TERMINAL_STATUSES.has("failed")).toBe(true);
    expect(REEL_GENERATION_TERMINAL_STATUSES.has("needs_regen")).toBe(true);
  });
  it("does NOT contain a non-terminal or success status", () => {
    for (const s of ["queued", "generating", "assets_ready", "assembling", "assembled", "posted"]) {
      expect(REEL_GENERATION_TERMINAL_STATUSES.has(s)).toBe(false);
    }
  });
  it("content.ts consults the shared constant, not a hardcoded status literal", () => {
    const CONTENT = fs.readFileSync(path.join(__dirname, "routers", "content.ts"), "utf8");
    expect(CONTENT).toMatch(/REEL_GENERATION_TERMINAL_STATUSES\.has\(res\.status\)/);
    // The narrower, now-replaced form must be gone — its absence is the proof
    // the loop no longer silently drops any status not in a stale hardcoded list.
    expect(CONTENT).not.toMatch(/res\.status === "failed" \|\| res\.status === "needs_regen"/);
  });
});

const PIPELINE = fs.readFileSync(path.join(__dirname, "services", "reelPipeline.ts"), "utf8");

describe("the degrade wiring is GONE from the pipeline (inverse of the old contract)", () => {
  it("never flips a job to template_stock mid-render", () => {
    // The old inline degrade: `activeProvider = "template_stock";` then `i -= 1`
    // to re-run the beat on the free lane. Both must be absent now.
    expect(PIPELINE).not.toMatch(/^\s*activeProvider = "template_stock";$/m);
  });
  it("never force-rescues a terminally-failed paid job onto the free lane", () => {
    expect(PIPELINE).not.toMatch(/forceProvider = "template_stock"/);
    expect(PIPELINE).not.toMatch(/forcedFreeLane/);
  });
  it("the removed predicate shouldDegradeToFreeLane is gone", () => {
    expect(PIPELINE).not.toMatch(/export async function shouldDegradeToFreeLane/);
    expect(PIPELINE).not.toMatch(/await shouldDegradeToFreeLane\(/);
  });
  it("routes terminal paid failures to needs_regen instead", () => {
    expect(PIPELINE).toMatch(/terminalPaidFailureIsNeedsRegen\(decided\.terminal, activeProvider\)/);
    expect(PIPELINE).toMatch(/^\s*if \(routedToNeedsRegen\) nextStatus = "needs_regen";$/m);
  });
  it("still settles the generation ledger on a needs_regen terminal (spend may have partially burned)", () => {
    expect(PIPELINE).toMatch(/nextStatus === "failed" \|\| nextStatus === "needs_regen"/);
  });
  it("alerts loudly when a reel is NOT published (the 2026-08-03/08-07 lesson: a cron_log line reaches no one)", () => {
    expect(PIPELINE).toMatch(/REEL PROVIDER DOWN — reel NOT published/);
  });
});

describe("adminRoutes.ts's own TERMINAL set — a third caller polling job.status directly", () => {
  // Self-audit 2026-08-20: this endpoint doesn't consult processNextReelJob's
  // return value at all — it re-reads the job row and checks job.status
  // against its OWN hardcoded terminal set. needs_regen being absent wasn't
  // a data-loss bug like content.ts's (the final status was still reported
  // correctly), but it meant the "advance" admin action polled pointlessly
  // for the full ~100s deadline instead of returning the instant a dead
  // provider routed the job to needs_regen.
  const ADMIN_ROUTES = fs.readFileSync(path.join(__dirname, "routes", "adminRoutes.ts"), "utf8");
  it("includes needs_regen in its TERMINAL set", () => {
    expect(ADMIN_ROUTES).toMatch(
      /const TERMINAL = new Set\(\["assembled", "posted", "failed", "needs_regen"\]\);/,
    );
  });
});
