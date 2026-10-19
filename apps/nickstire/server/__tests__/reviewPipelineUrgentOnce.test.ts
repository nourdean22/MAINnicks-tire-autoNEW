/**
 * review-pipeline re-sent the same URGENT REVIEWS Telegram every day: prod
 * cron_log said "5 reviews synced, 1 urgent" on each day 2026-10-12..19 and no
 * review_replies row was ever posted, because the only screen that cleared an
 * urgent review (Review Replies) is gone. The alert must fire once per urgent
 * SET, through the same sendOncePerState + stateFingerprint claim promise-risk
 * uses (services/alertClaim.ts), and point at Google, not the admin.
 *
 * Source-shape pin: the handler is an inline closure in scheduler.ts.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sliceBlock } from "../testUtils/sourceBlock";
import { stateFingerprint } from "../services/alertClaim";

const SCHED = readFileSync(path.join(__dirname, "..", "cron", "scheduler.ts"), "utf8");
const handler = () => sliceBlock(SCHED, 'name: "review-pipeline"', 'name: "gsc-pipeline"', { label: "review-pipeline job" });

describe("review-pipeline URGENT REVIEWS alert fires once per urgent set", () => {
  it("claims the send on a fingerprint of the urgent review ids", () => {
    const src = handler();
    expect(src).toContain("stateFingerprint(");
    expect(src).toMatch(/sendOncePerState\(\s*`urgent-reviews:\$\{/);
    expect(src).not.toMatch(/\n\s*await sendTelegram\(\s*\n?\s*`⭐ URGENT/);
  });

  it("the fingerprint is order-insensitive and changes when a new review joins the set", () => {
    expect(stateFingerprint(["a", "b"])).toBe(stateFingerprint(["b", "a"]));
    expect(stateFingerprint(["a", "b", "c"])).not.toBe(stateFingerprint(["a", "b"]));
  });

  it("points the operator at Google, not a removed admin screen", () => {
    const src = handler();
    expect(src).toContain("Reply on Google");
    expect(src).not.toMatch(/Review Replies/);
  });

  it("review-auto-draft is retired: no tier still schedules it", () => {
    expect(SCHED).not.toContain('name: "review-auto-draft"');
  });
});
