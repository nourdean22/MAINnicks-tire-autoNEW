/**
 * reelWindowDisclosure.test.ts · 2026-08-04
 *
 * Two numbers on the Instagram Today screen describe DIFFERENT populations on
 * DIFFERENT clocks, and nothing said so.
 *
 *   reliability panel  — 30 days on `createdAt` (reelReliability.ts:74)
 *   needs attention    — 8 non-terminal statuses with NO window at all, OR
 *                        failed within 14 days on `updatedAt`
 *                        (reelRecoverability.ts:427-430, FAILED_ATTENTION_DAYS)
 *
 * They are disjoint in BOTH directions. A job stuck in `generating` since March
 * counts toward attention forever and is invisible to the panel. A failure created
 * 40 days ago but touched 5 days ago counts for attention and not the panel. A
 * failure created 20 days ago and untouched counts for the panel and not attention.
 *
 * The sharp part is the clock. `reel_jobs.updatedAt` is declared
 * `.defaultNow().onUpdateNow()` (drizzle/schema.ts:3263), so the attention window
 * RESETS on any write to the row — an attempt bump, an error rewrite, an operator
 * closure. `createdAt` never moves. One window is anchored and the other slides
 * under it, which is why no amount of staring reconciles the two figures.
 *
 * This is a DISCLOSURE fix, not a unification: both windows are individually
 * correct for their job. The defect was that the screen presented them as if they
 * measured the same thing.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const today = read("client/src/pages/admin/instagram/Today.tsx");
const reliability = read("server/services/reelReliability.ts");
const recoverability = read("server/services/reelRecoverability.ts");
const schema = read("drizzle/schema.ts");

describe("the two windows still differ — the premise of the disclosure", () => {
  /**
   * If a later change unifies them, these labels become wrong rather than merely
   * unnecessary, so the disclosure must fail loudly instead of rotting quietly.
   */
  it("reliability windows on createdAt", () => {
    expect(reliability).toMatch(/createdAt[\s\S]{0,40}DATE_SUB\(NOW\(\), INTERVAL 30 DAY\)/);
  });

  it("attention windows on updatedAt with its own constant", () => {
    expect(recoverability).toMatch(/FAILED_ATTENTION_DAYS\s*=\s*\d+/);
    expect(recoverability).toMatch(/gte\(\s*reelJobs\.updatedAt/);
  });

  /** The self-resetting clock. Without onUpdateNow the two windows would at least
   *  be measuring from stable anchors, and the disclosure would matter far less. */
  it("updatedAt resets on every row write", () => {
    expect(schema).toMatch(/updatedAt:\s*timestamp\("updatedAt"\)[^,]*onUpdateNow\(\)/);
  });

  it("attention includes non-terminal statuses with no time bound at all", () => {
    expect(recoverability).toMatch(/ATTENTION_STATUSES\s*=/);
    // The unbounded branch is what makes a March-era stuck job count forever.
    expect(recoverability).toMatch(/inArray\(\s*reelJobs\.status,\s*\[?\.\.\.?ATTENTION_STATUSES/);
  });
});

describe("the screen discloses which population each number counts", () => {
  it("the attention row says it is not the panel's population", () => {
    expect(today).toMatch(/Held jobs of any age/);
    expect(today).toMatch(/14 days/);
  });

  it("the panel says it is windowed on creation and is a trailing mean", () => {
    expect(today).toMatch(/CREATION date/);
    expect(today).toMatch(/trailing mean/);
  });

  /**
   * Operator-closed failures are already excluded from the rate server-side, but
   * the count was never shown — so a rate that moved because the operator closed
   * something looked like the pipeline changing on its own.
   */
  it("closed-by-operator failures are surfaced, not silently dropped", () => {
    expect(today).toMatch(/closed by you \(excluded\)/);
    expect(reliability).toMatch(/closedFailures/);
  });
});
