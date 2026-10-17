/**
 * Learn tab (components/actions/mode-learn.tsx) writes ONE spaced_review row per
 * learned item, a new FSRS card due tomorrow, instead of four pre-made Day 1/3/7/30
 * rows (deep scout v2 item 4, 2026-10-17). The row itself is pinned by
 * tests/brain/fsrs-schedule.test.ts (learnReviewRow); this pins the call site,
 * since the component has no render harness. Comment lines are blanked first, so
 * a comment that names the old ladder cannot satisfy or break it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const code = readFileSync(join(__dirname, "../../components/actions/mode-learn.tsx"), "utf8")
  .split("\n")
  .map((line) => (/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line) ? "" : line))
  .join("\n");

describe("mode-learn spaced review scheduling", () => {
  it("(f) scheduleSpacedReview asks the server to ensure the card (ensureLearnCard), with no client-built row and no interval loop", () => {
    const start = code.indexOf("const scheduleSpacedReview = useCallback(");
    expect(start).toBeGreaterThan(-1);
    const body = code.slice(start, code.indexOf("[ensureLearnCardMut]", start));
    expect(body.match(/ensureLearnCardMut\.mutateAsync\(/g) ?? []).toHaveLength(1);
    expect(body).toMatch(/ensureLearnCardMut\.mutateAsync\(\{\s*topic,\s*summary:\s*mvuSummary\s*\}\)/);
    // The old path upserted a NEW card by key and reset a mature one: it must be gone.
    expect(body).not.toMatch(/recordMemoryMut|learnReviewRow\(|category:\s*"spaced_review"/);
    expect(body).not.toMatch(/\bfor\s*\(|\bwhile\s*\(|\.forEach\(|\.map\(|\[\s*1\s*,\s*3\s*,\s*7\s*,\s*30\s*\]/);
    expect(code).toMatch(/const ensureLearnCardMut = trpc\.brain\.ensureLearnCard\.useMutation\(\)/);
    expect(code).not.toMatch(/\blearnReviewRow\b/);
  });

  it("round 2: Got it grades an FSRS row (gradeSpacedReview good) and forgets only a legacy row", () => {
    const start = code.indexOf("const completeReview = useCallback(");
    expect(start).toBeGreaterThan(-1);
    const body = code.slice(start, code.indexOf("\n  );", start));
    const grade = body.indexOf('reviewCompletion(');
    const gradeCall = body.search(/gradeSpacedReviewMut\.mutateAsync\(\{\s*key,\s*rating:\s*"good"\s*\}\)/);
    const forgetCall = body.indexOf("forgetMemoryMut.mutateAsync(");
    expect(grade).toBeGreaterThan(-1);
    expect(body).toMatch(/reviewCompletion\([^)]*\)\s*===\s*"grade"/);
    expect(gradeCall).toBeGreaterThan(grade);
    // The forget call sits in the else branch, after the grade call, and appears once.
    // The grade branch returns before the legacy forget call, which appears once.
    expect(forgetCall).toBeGreaterThan(gradeCall);
    expect(body.slice(gradeCall, forgetCall)).toMatch(/\breturn;/);
    expect(body.match(/forgetMemoryMut\.mutateAsync\(/g) ?? []).toHaveLength(1);
    // Hidden locally at once.
    expect(body).toMatch(/setDismissedReviewKeys\(/);
    expect(code).toMatch(/const gradeSpacedReviewMut = trpc\.brain\.gradeSpacedReview\.useMutation\(\)/);
  });

  it("round 3 (P2-8): after any grade the spaced_review list is refetched; a card that was not rescheduled comes back", () => {
    const start = code.indexOf("const completeReview = useCallback(");
    const body = code.slice(start, code.indexOf("\n  );", start));
    const gradeCall = body.indexOf("gradeSpacedReviewMut.mutateAsync(");
    const ret = body.indexOf("return;", gradeCall);
    const gradeBranch = body.slice(gradeCall, ret);
    expect(gradeBranch).toMatch(/utils\.brain\.memories\.invalidate\(/);
    // Not rescheduled (lost / unreadable / threw): un-hide the key so the card reappears.
    expect(gradeBranch).toMatch(/"lost"/);
    expect(gradeBranch).toMatch(/"unreadable"/);
    expect(gradeBranch).toMatch(/\.delete\(key\)/);
    expect(code).toMatch(/const utils = trpc\.useUtils\(\)/);
  });

  it("this file no longer writes a spaced_review row itself: the one category literal is the due-list read", () => {
    expect(code.match(/category:\s*"spaced_review"/g) ?? []).toHaveLength(1);
  });
});
