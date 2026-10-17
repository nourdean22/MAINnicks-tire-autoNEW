/**
 * FSRS spaced-review scheduler (deep scout v2 item 4, 2026-10-17), over
 * open-spaced-repetition/ts-fsrs (MIT). The interval is solved for a target
 * retention from each card's stability and difficulty, so it stretches for what
 * Nour knows and shrinks for what he misses; it replaces the fixed 1/3/7/30 ladder.
 *
 * Pure: no I/O, safe to import from client components (mode-learn.tsx).
 * Card state is plain JSON on the spaced_review row's content under `fsrs`.
 */
import { createEmptyCard, fsrs, generatorParameters, Rating, S_MIN, State, type Card } from "ts-fsrs";

export { Rating };

/**
 * Fixed params, default FSRS weights. No fuzz, so a date is reproducible from its inputs.
 * Short-term steps are off: with them a new card's Good is due in 10 minutes and its
 * Again in 1, and the tutor asks at most once a day, so every interval is whole days.
 */
const scheduler = fsrs(
  generatorParameters({ request_retention: 0.9, maximum_interval: 365, enable_fuzz: false, enable_short_term: false }),
);

/** ts-fsrs Card as stored JSON: dates are ISO strings. */
export type FsrsState = {
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: State;
  last_review: string | null;
};

export type ReviewRating = Rating.Again | Rating.Good;

/** Only an unaided correct answer is Good; a miss or any hinted answer is Again (scout 9: a hint is a miss). */
export function ratingFor(unaided: boolean, correct: boolean): ReviewRating {
  return unaided && correct ? Rating.Good : Rating.Again;
}

function toState(c: Card): FsrsState {
  return {
    due: c.due.toISOString(),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state,
    last_review: c.last_review ? c.last_review.toISOString() : null,
  };
}

const NUMBER_FIELDS = ["stability", "difficulty", "elapsed_days", "scheduled_days", "learning_steps", "reps", "lapses"] as const;
const isDate = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));

/**
 * Why a stored state cannot be scheduled, or null when it can. Beyond shape, this
 * rejects what ts-fsrs throws on ("Invalid memory state": a reviewed card with
 * stability below S_MIN or difficulty below 1) and negative counters.
 */
export function fsrsStateProblem(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return "not an object";
  const r = raw as Record<string, unknown>;
  if (!isDate(r.due)) return "due is not a date";
  if (!(r.last_review === null || isDate(r.last_review))) return "last_review is not a date";
  const bad = NUMBER_FIELDS.find((k) => typeof r[k] !== "number" || !Number.isFinite(r[k]) || (r[k] as number) < 0);
  if (bad) return `${bad} is not a non-negative number`;
  if (typeof r.state !== "number" || !(r.state in State)) return "unknown state";
  if (r.state !== State.New) {
    if ((r.stability as number) < S_MIN) return `stability below S_MIN (${S_MIN})`;
    if ((r.difficulty as number) < 1) return "difficulty below 1";
  }
  return null;
}

/** Stored JSON -> state, or null when absent or unschedulable (that card then starts new). */
export function readFsrsState(raw: unknown): FsrsState | null {
  if (fsrsStateProblem(raw)) return null;
  const r = raw as Record<string, unknown>;
  return {
    due: r.due as string,
    stability: r.stability as number,
    difficulty: r.difficulty as number,
    elapsed_days: r.elapsed_days as number,
    scheduled_days: r.scheduled_days as number,
    learning_steps: r.learning_steps as number,
    reps: r.reps as number,
    lapses: r.lapses as number,
    state: r.state as State,
    last_review: r.last_review as string | null,
  };
}

/** Grade one review. A null state (new, legacy or malformed row) is a new card. */
export function nextReview(state: FsrsState | null, rating: ReviewRating, now: Date): { state: FsrsState; due: Date } {
  const card: Card = state
    ? { ...state, due: new Date(state.due), last_review: state.last_review ? new Date(state.last_review) : undefined }
    : createEmptyCard(now);
  const { card: next } = scheduler.next(card, now, rating);
  return { state: toState(next), due: next.due };
}

/**
 * The Learn tab's "Got it" on a row: any row carrying an `fsrs` key is graded
 * (brain.gradeSpacedReview), even an unreadable state, which the server resets to a
 * new card, so both sides agree. A legacy ladder row (no fsrs key) or unreadable
 * content is forgotten as before.
 */
export function reviewCompletion(content: string): "grade" | "forget" {
  try {
    const v = JSON.parse(content) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) && "fsrs" in v ? "grade" : "forget";
  } catch {
    return "forget";
  }
}

const DAY_MS = 86_400_000;

/** The one spaced_review row mode-learn.tsx writes per learned item: a new FSRS card due in 1 day. */
export function learnReviewRow(topic: string, summary: string, now: Date): { key: string; content: string } {
  const due = new Date(now.getTime() + DAY_MS);
  return {
    key: `review_${topic.slice(0, 40).replace(/\s+/g, "_")}`,
    content: JSON.stringify({
      topic,
      summary: summary.slice(0, 300),
      reviewAt: due.toISOString(),
      interval: 1,
      completed: false,
      fsrs: toState(createEmptyCard(due)),
    }),
  };
}
