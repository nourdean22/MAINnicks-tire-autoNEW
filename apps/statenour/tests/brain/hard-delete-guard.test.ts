/**
 * Canaries · the hard-delete guards (2026-09-01 data-loss incident).
 *
 * Receipt the guards exist for — AuditEvent "cron:data_cleanup_completed",
 * 2026-08-28T07:01:07Z: "Pruned 55944 rows across 29 tables",
 * deletedByTable.brain_memories_gc = 54107, run status "success",
 * cron_job_logs.resultCount NULL. Neighbouring nights: 187/449/505/322/281.
 *
 * These assert BEHAVIOUR (what the breaker decides, what the list covers),
 * with positive controls on both sides — a guard that only ever says "no" is
 * as useless as one that only ever says "yes".
 */
import { describe, it, expect } from "vitest";
import {
  NEVER_HARD_DELETE_CATEGORIES,
  MAX_HARD_DELETE_PER_SWEEP,
  judgeSweep,
} from "@/lib/brain/hard-delete-guard";
import { DURABLE_PERSONAL_CATEGORIES } from "@/lib/brain/memory-recall";
import { BRAIN_MEMORY_RETENTION } from "@/config/retention";

describe("judgeSweep · the circuit breaker", () => {
  it("BREAKS: a sweep the size of the 2026-08-28 incident is refused", () => {
    const v = judgeSweep(54_107);
    expect(v.allowed).toBe(false);
    expect(v.reason).toMatch(/54107|54,107|BLOCKED/);
  });

  it("positive control: normal measured nightly volume passes untouched", () => {
    // Every observed brain_memories_gc count, 2026-08-26..09-01.
    for (const n of [187, 281, 322, 449, 505]) {
      expect(judgeSweep(n).allowed, `${n} is a normal night and must not be blocked`).toBe(true);
    }
  });

  it("the boundary is exact: cap passes, cap+1 is refused", () => {
    expect(judgeSweep(MAX_HARD_DELETE_PER_SWEEP).allowed).toBe(true);
    expect(judgeSweep(MAX_HARD_DELETE_PER_SWEEP + 1).allowed).toBe(false);
  });

  it("zero is allowed — 'nothing to do' is not a failure", () => {
    expect(judgeSweep(0).allowed).toBe(true);
  });

  it("BREAKS: fails CLOSED on a broken pre-count (a broken counter must not authorise a delete)", () => {
    for (const bad of [-1, NaN, Infinity]) {
      const v = judgeSweep(bad as number);
      expect(v.allowed, `${bad} must not authorise a delete`).toBe(false);
      expect(v.reason).toMatch(/invalid pre-count/);
    }
  });

  it("the cap sits above normal volume and far below the incident", () => {
    expect(MAX_HARD_DELETE_PER_SWEEP).toBeGreaterThan(505);
    expect(MAX_HARD_DELETE_PER_SWEEP).toBeLessThan(54_107);
  });
});

describe("NEVER_HARD_DELETE_CATEGORIES · what a TTL sweep may never touch", () => {
  it("BREAKS: every durable personal category is protected", () => {
    for (const c of DURABLE_PERSONAL_CATEGORIES) {
      expect(NEVER_HARD_DELETE_CATEGORIES.includes(c), `${c} must never be hard-deleted`).toBe(true);
    }
  });

  it("enforces config/retention.ts's 'compounds forever' comment, which no code enforced", () => {
    for (const c of ["identity_snapshot", "belief", "contradiction", "decision_pattern", "anti_pattern"]) {
      expect(NEVER_HARD_DELETE_CATEGORIES.includes(c), `${c} is named 'NEVER in this list' in retention.ts`).toBe(true);
    }
  });

  it("positive control: pure telemetry stays sweepable — the guard is not a blanket 'never delete'", () => {
    for (const c of ["memory_gateway_shadow", "nick_quality", "reply_quality", "mastery_xp_event"]) {
      expect(NEVER_HARD_DELETE_CATEGORIES.includes(c), `${c} is telemetry and must remain collectable`).toBe(false);
    }
  });

  it("no category is both scheduled for retention AND protected (a contradiction the route resolves conservatively)", () => {
    // Documents the current state rather than asserting a wish: if a future
    // edit puts one in both lists, the route SKIPS it — this pins that the
    // overlap is deliberate and visible, not accidental.
    const overlap = BRAIN_MEMORY_RETENTION
      .map((r) => r.category)
      .filter((c) => NEVER_HARD_DELETE_CATEGORIES.includes(c));
    expect(overlap).toEqual([]);
  });

  /**
   * ── CANARY · the operator's own record ──────────────────────────────
   *
   * Measured against production 2026-09-17, before these were protected: a
   * sweep would have hard-deleted 274 rows across these six — 53 wins, 86
   * concerns, 59 emotional_state, 52 prediction_lesson, 17 learning_journal,
   * 7 business_event — while the REST of each category survived (158, 373,
   * 438, 240, 98, 47 total). Only a fraction of each was dying, which is what
   * made it invisible: the categories never emptied.
   *
   * ★★★ ALL OF THEM CAME FROM A DELIBERATELY-SET `expiresAt` — 2,911 of 2,912
   * candidates arrived via the TTL arm, exactly ONE via the low-confidence
   * heuristic. But `config/retention.ts`, the one place that decides what
   * expires, covers five categories and NONE of these. So each TTL was chosen
   * by whatever happened to write the row, and nobody ever decided a `win`
   * should die.
   *
   * The asymmetry settles it: keeping a stale win costs one row; losing a real
   * one is irreversible. Removing any name below re-arms a silent, permanent
   * delete of the operator's own history.
   */
  it("CANARY — the operator's own record is never hard-deletable", () => {
    for (const c of [
      "win",
      "concern",
      "emotional_state",
      "prediction_lesson",
      "learning_journal",
      "business_event",
    ]) {
      expect(
        NEVER_HARD_DELETE_CATEGORIES.includes(c),
        `${c} is the operator's own record — removing it re-arms a permanent delete`,
      ).toBe(true);
    }
  });
});
