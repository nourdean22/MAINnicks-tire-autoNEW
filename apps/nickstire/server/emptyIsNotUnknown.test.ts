/**
 * "Nothing to show" and "we could not look" must never share a sentence.
 *
 * Five more screens carried the defect this whole arc is about. Each one turned a
 * failed read into an editorial fact:
 *
 *   Queue.tsx                  failed getAllDrafts    -> "No drafts found"
 *   QueueV2.tsx                failed list query      -> "No Studio V2 drafts match"
 *   DraftBoardPanel.tsx        DB + Sheet both down   -> an empty board
 *   Settings.tsx               failedJobs === null    -> banner never renders
 *   AutonomyCommandCenter.tsx  table unavailable      -> "No reel jobs yet"
 *
 * The Settings one is the sharpest: `(failedJobs ?? 0) > 0` means an UNCOUNTABLE
 * number of held reels renders as an all-clear, on the very screen that warns
 * "review the Reel queue before enabling any autonomous publishing."
 *
 * Asserted against source: what must not regress is one branch in each file, and
 * mounting five screens against five faulted transports would test the harness.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("every list screen distinguishes empty from unreadable", () => {
  it("Queue branches on isError BEFORE the empty state", () => {
    const s = read("client/src/pages/admin/instagram/Queue.tsx");
    expect(s).toMatch(/isError \?/);
    expect(s).toMatch(/unknown, not empty/i);
    // Order matters: an isError branch after the empty check never renders.
    expect(s.indexOf("isError ?")).toBeLessThan(s.indexOf("filteredDrafts.length === 0"));
  });

  it("QueueV2 branches on isError BEFORE the empty state", () => {
    const s = read("client/src/pages/admin/instagram/QueueV2.tsx");
    expect(s).toMatch(/list\.isError \?/);
    expect(s.indexOf("list.isError ?")).toBeLessThan(s.indexOf("rows.length === 0"));
  });

  it("DraftBoardPanel surfaces a read failure as its own banner", () => {
    const s = read("client/src/pages/admin/DraftBoardPanel.tsx");
    expect(s).toMatch(/readFailure/);
    expect(s).toMatch(/UNKNOWN, not empty/);
  });

  it("AutonomyCommandCenter no longer shares one sentence for two facts", () => {
    const s = read("client/src/components/admin/AutonomyCommandCenter.tsx");
    // The defect was `!available || rows.length === 0` collapsing into one message.
    expect(s).not.toMatch(/!s\.recentJobs\.available \|\| s\.recentJobs\.rows\.length === 0/);
    expect(s).toMatch(/Recent renders unavailable/);
  });

  it("Settings warns when the held-reel count could not be READ, not just when it is high", () => {
    const s = read("client/src/pages/admin/instagram/Settings.tsx");
    expect(s).toMatch(/failedJobs === null/);
    expect(s).toMatch(/Unable to determine held Reel jobs/);
  });
});

describe("the server stops manufacturing an empty list", () => {
  const s = read("server/routers/content.ts");

  it("throws when NEITHER the database nor the sheet could be read", () => {
    expect(s).toMatch(/dbFailed && sheetFailed/);
    expect(s).toMatch(/this is not an empty board/i);
  });

  it("lets that throw ESCAPE the outer catch", () => {
    // The outer catch returned [] for everything. A throw it swallows is a fix
    // that fixes nothing — the screen still renders an outage as an empty board.
    expect(s).toMatch(/if \(err instanceof TRPCError\) throw err;/);
  });

  it("still returns data when only ONE source failed — a partial is real information", () => {
    // The guard is an AND, deliberately. One live source is worth showing.
    expect(s).not.toMatch(/dbFailed \|\| sheetFailed/);
  });
});
