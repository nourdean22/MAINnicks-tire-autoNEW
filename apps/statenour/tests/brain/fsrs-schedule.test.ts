/**
 * FSRS spaced-review scheduler (deep scout v2 item 4, 2026-10-17). ts-fsrs is the
 * oracle: our wrapper must give exactly what ts-fsrs gives for the fixed params,
 * and one hard-coded number pins the behaviour so a ts-fsrs upgrade that changes
 * it turns this file red instead of silently moving Nour's review dates.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createEmptyCard, fsrs, generatorParameters, Rating } from "ts-fsrs";
import { fsrsStateProblem, learnReviewRow, nextReview, ratingFor, readFsrsState, reviewCompletion } from "@/lib/brain/fsrs-schedule";

const T0 = new Date("2026-10-16T12:05:00.000Z");
const DAY = 86_400_000;
const days = (due: Date, from: Date) => Math.round((due.getTime() - from.getTime()) / DAY);

describe("nextReview: ts-fsrs is the oracle", () => {
  it("(a) a new card graded Good equals ts-fsrs's own output for the same params", () => {
    const oracle = fsrs(
      generatorParameters({ request_retention: 0.9, maximum_interval: 365, enable_fuzz: false, enable_short_term: false }),
    ).next(createEmptyCard(T0), T0, Rating.Good).card;
    const { state, due } = nextReview(null, Rating.Good, T0);
    expect(due.toISOString()).toBe(oracle.due.toISOString());
    expect(state).toEqual({
      due: oracle.due.toISOString(),
      stability: oracle.stability,
      difficulty: oracle.difficulty,
      elapsed_days: oracle.elapsed_days,
      scheduled_days: oracle.scheduled_days,
      learning_steps: oracle.learning_steps,
      reps: oracle.reps,
      lapses: oracle.lapses,
      state: oracle.state,
      last_review: T0.toISOString(),
    });
    // Pinned: a ts-fsrs upgrade that changes the first interval must fail here.
    expect(state.scheduled_days).toBe(3);
    expect(days(due, T0)).toBe(3);
  });

  it("(a) deterministic: no fuzz, so the same input always gives the same date", () => {
    const runs = Array.from({ length: 5 }, () => {
      let s = nextReview(null, Rating.Good, T0);
      for (let k = 0; k < 3; k++) s = nextReview(s.state, Rating.Good, s.due);
      return s.due.toISOString();
    });
    expect(new Set(runs).size).toBe(1);
    // Pinned 4th Good from T0 (fuzz on would move it).
    let s = nextReview(null, Rating.Good, T0);
    for (let k = 0; k < 3; k++) s = nextReview(s.state, Rating.Good, s.due);
    expect(s.state.scheduled_days).toBe(196);
  });

  it("(a) day granularity: a new card's Again is tomorrow, never minutes (short-term steps are off)", () => {
    const { state, due } = nextReview(null, Rating.Again, T0);
    expect(state.scheduled_days).toBe(1);
    expect(days(due, T0)).toBe(1);
  });

  it("(b) four consecutive Goods grow strictly; an Again after them shrinks the interval and adds a lapse", () => {
    let s = nextReview(null, Rating.Good, T0);
    const intervals = [s.state.scheduled_days];
    for (let k = 0; k < 3; k++) {
      s = nextReview(s.state, Rating.Good, s.due);
      intervals.push(s.state.scheduled_days);
    }
    for (let k = 1; k < intervals.length; k++) expect(intervals[k]).toBeGreaterThan(intervals[k - 1]);
    expect(s.state.lapses).toBe(0);
    const lapsed = nextReview(s.state, Rating.Again, s.due);
    expect(lapsed.state.scheduled_days).toBeLessThan(intervals[3]);
    expect(lapsed.state.lapses).toBe(1);
    expect(days(lapsed.due, s.due)).toBe(lapsed.state.scheduled_days);
  });

  it("(b) the stored state round-trips through JSON and schedules the same as the live card", () => {
    const a = nextReview(null, Rating.Good, T0);
    const stored = readFsrsState(JSON.parse(JSON.stringify(a.state)));
    expect(stored).toEqual(a.state);
    expect(nextReview(stored, Rating.Good, a.due)).toEqual(nextReview(a.state, Rating.Good, a.due));
  });
});

describe("ratingFor: only unaided recall is Good (scout 9)", () => {
  it("(c) unaided correct -> Good; unaided miss -> Again; hinted correct -> Again; hinted wrong -> Again", () => {
    expect(ratingFor(true, true)).toBe(Rating.Good);
    expect(ratingFor(true, false)).toBe(Rating.Again);
    expect(ratingFor(false, true)).toBe(Rating.Again);
    expect(ratingFor(false, false)).toBe(Rating.Again);
  });
});

describe("readFsrsState: legacy and malformed rows start as a new card", () => {
  it("(e) no fsrs field, or a malformed one, reads as null (nextReview then makes a new card)", () => {
    expect(readFsrsState(undefined)).toBeNull();
    expect(readFsrsState({ stability: "x" })).toBeNull();
    expect(readFsrsState({ ...nextReview(null, Rating.Good, T0).state, due: "not a date" })).toBeNull();
    expect(nextReview(readFsrsState(undefined), Rating.Good, T0)).toEqual(nextReview(null, Rating.Good, T0));
  });

  it("(P2-3) states ts-fsrs would throw on or mis-schedule are rejected, with a reason; a valid New card passes", () => {
    const review = nextReview(null, Rating.Good, T0).state; // state Review, stability ~2.3, difficulty ~2.1
    const cases: Array<[string, Record<string, unknown>]> = [
      ["stability below S_MIN on a reviewed card", { ...review, stability: 0.0001 }],
      ["difficulty below 1 on a reviewed card", { ...review, difficulty: 0.5 }],
      ["negative elapsed_days", { ...review, elapsed_days: -1 }],
      ["negative scheduled_days", { ...review, scheduled_days: -2 }],
      ["negative reps", { ...review, reps: -1 }],
      ["unknown state", { ...review, state: 9 }],
    ];
    for (const [label, raw] of cases) {
      expect(readFsrsState(raw), label).toBeNull();
      expect(fsrsStateProblem(raw), label).toEqual(expect.any(String));
    }
    expect(fsrsStateProblem(review)).toBeNull();
    // A brand-new card legitimately has stability 0 and difficulty 0.
    const fresh = JSON.parse(learnReviewRow("t", "s", T0).content).fsrs;
    expect(fresh.stability).toBe(0);
    expect(readFsrsState(fresh)).not.toBeNull();
    // Rejected means reset: nextReview of null is a new card, and does not throw.
    expect(() => nextReview(readFsrsState({ ...review, stability: 0.0001 }), Rating.Good, T0)).not.toThrow();
  });
});

describe("learnReviewRow: one FSRS card per learned item (mode-learn.tsx)", () => {
  it("(f) one row, due in exactly one day, a new FSRS card, and the fields the Learn tab reads", () => {
    const row = learnReviewRow("Opportunity cost", "x".repeat(400), T0);
    expect(row.key).toBe("review_Opportunity_cost");
    const content = JSON.parse(row.content);
    expect(content).toMatchObject({ topic: "Opportunity cost", interval: 1, completed: false });
    expect(content.summary).toHaveLength(300);
    expect(new Date(content.reviewAt).getTime()).toBe(T0.getTime() + DAY);
    expect(content.fsrs).toMatchObject({ due: content.reviewAt, reps: 0, lapses: 0, state: 0, last_review: null });
    expect(readFsrsState(content.fsrs)).not.toBeNull();
  });
});

describe("reviewCompletion: what the Learn tab's Got it does to a row", () => {
  it("an FSRS row is graded; a legacy ladder row (no fsrs key) or unreadable content is forgotten as before", () => {
    expect(reviewCompletion(learnReviewRow("t", "s", T0).content)).toBe("grade");
    const legacy = JSON.stringify({ topic: "t", summary: "s", reviewAt: T0.toISOString(), interval: 7, completed: false });
    expect(reviewCompletion(legacy)).toBe("forget");
    expect(reviewCompletion("not json")).toBe("forget");
  });

  it("(P2-4) a row whose fsrs state is unreadable is still graded: the server resets it, so client and server agree", () => {
    expect(reviewCompletion(JSON.stringify({ topic: "t", fsrs: { stability: "x" } }))).toBe("grade");
    expect(reviewCompletion(JSON.stringify({ topic: "t", fsrs: null }))).toBe("grade");
  });
});

describe("fsrs-schedule.ts ships in the client bundle (mode-learn.tsx)", () => {
  it("imports nothing but ts-fsrs (type-only imports allowed): no prisma, no server module", () => {
    const src = readFileSync(join(__dirname, "../../lib/brain/fsrs-schedule.ts"), "utf8");
    const specifiers = [...src.matchAll(/^\s*(import|export)\s+(type\s+)?[^;]*?\sfrom\s+["']([^"']+)["']/gm)]
      .filter((m) => !m[2])
      .map((m) => m[3]);
    const dynamic = [...src.matchAll(/\b(?:import|require)\s*\(\s*["']([^"']+)["']/g)].map((m) => m[1]);
    expect(specifiers.length).toBeGreaterThan(0);
    expect([...new Set([...specifiers, ...dynamic])]).toEqual(["ts-fsrs"]);
  });
});
