/**
 * Brain follow-up 5 (2026-10-17): the Execution Coach sandbox's "Queue Spaced Review
 * Card" used to write a spaced_review row with no `fsrs` key (reviewAt, interval 1,
 * completed false). The Learn tab forgets such a row on "Got it" instead of grading
 * it (reviewCompletion). It now writes learnReviewRow's FSRS card, so the one reader
 * (mode-learn.tsx -> gradeSpacedReview) schedules it.
 *
 * The component has no render harness (see mode-learn-spaced-review.test.ts), so the
 * call site is pinned from source with comment lines blanked, and the card it
 * writes is pinned from the real builder it calls.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { learnReviewRow, readFsrsState, reviewCompletion } from "@/lib/brain/fsrs-schedule";

const code = readFileSync(join(__dirname, "../../components/goals/execution-coach-sandbox.tsx"), "utf8")
  .split("\n")
  .map((line) => (/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line) ? "" : line))
  .join("\n");

const start = code.indexOf("const handleQueueSpacedReview = async");
const body = code.slice(start, code.indexOf("finally", start));

describe("execution coach sandbox spaced review", () => {
  it("queues the Learn tab's FSRS card (learnReviewRow), never a hand-built fsrs-less row", () => {
    expect(start).toBeGreaterThan(-1);
    expect(body).toMatch(/learnReviewRow\(/);
    expect(body.match(/recordMemoryMut\.mutateAsync\(/g) ?? []).toHaveLength(1);
    expect(body).toMatch(/content:\s*row\.content\b/);
    // The legacy payload: a JSON.stringify of reviewAt / interval / completed with no fsrs key.
    expect(body).not.toMatch(/JSON\.stringify|\binterval\s*:|\bcompleted\s*:|\breviewAt\s*:/);
    expect(body).toMatch(/source:\s*"execution_coach"/);
    expect(body).toMatch(/category:\s*"spaced_review"/);
  });

  it("this file is not a second spaced_review writer: the one category literal is the queue call", () => {
    expect(code.match(/category:\s*"spaced_review"/g) ?? []).toHaveLength(1);
  });

  it("the card it writes is one the Learn tab grades (not forgets), due now, with the topic and summary", () => {
    const now = new Date("2026-10-17T12:00:00.000Z");
    // the sandbox backdates a day because learnReviewRow dates a card one day on; keep the arithmetic pinned
    expect(body).toMatch(/learnReviewRow\(topic,\s*summary,\s*new Date\(Date\.now\(\)\s*-\s*86_400_000\)\)/);
    const row = learnReviewRow("Friction: x", "Nour hit friction.", new Date(now.getTime() - 86_400_000));
    expect(reviewCompletion(row.content)).toBe("grade");
    const card = JSON.parse(row.content);
    expect(readFsrsState(card.fsrs)).not.toBeNull();
    expect(card.reviewAt).toBe(now.toISOString());
    expect(card.topic).toBe("Friction: x");
    expect(card.summary).toBe("Nour hit friction.");
  });
});
