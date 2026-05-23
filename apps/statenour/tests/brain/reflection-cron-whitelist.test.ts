/**
 * tests/brain/reflection-cron-whitelist.test.ts · task #17.
 *
 * Locks the contract of `/api/cron/reflect-categories` REFLECT_CATEGORIES:
 *   1. Every entry must be a registered BRAIN_CATEGORIES value · the
 *      cron should NEVER reflect on a hand-typed string.
 *   2. The reflection sink itself must never appear (would compound
 *      noise — reflections of reflections).
 *   3. Task-pattern lanes (task_insight + task_pattern) are present ·
 *      this is the deliverable for #17.
 *
 * Why a test · the cron uses a hardcoded array, easy to drift. A
 * contract test catches if someone adds an unregistered category or
 * accidentally removes the task-pattern lanes the brain/reflections
 * viewer depends on.
 */

import { describe, it, expect } from "vitest";

import { REFLECT_CATEGORIES } from "@/app/api/cron/reflect-categories/route";
import {
  BRAIN_CATEGORIES,
  isKnownCategory,
} from "@/lib/brain/categories";

describe("reflection cron whitelist · contract", () => {
  it("every category in the whitelist is registered in BRAIN_CATEGORIES", () => {
    const unregistered = REFLECT_CATEGORIES.filter((c) => !isKnownCategory(c));
    expect(unregistered).toEqual([]);
  });

  it("does NOT include `reflection` itself (would compound noise)", () => {
    expect(REFLECT_CATEGORIES).not.toContain(BRAIN_CATEGORIES.REFLECTION);
  });

  it("does NOT include `wisdom` (already meta-tier)", () => {
    expect(REFLECT_CATEGORIES).not.toContain(BRAIN_CATEGORIES.WISDOM);
  });

  it("does NOT include `domain_knowledge` (curated facts, not raw obs)", () => {
    expect(REFLECT_CATEGORIES).not.toContain(BRAIN_CATEGORIES.DOMAIN_KNOWLEDGE);
  });

  it("includes the task-insight lane (task #17 deliverable)", () => {
    expect(REFLECT_CATEGORIES).toContain(BRAIN_CATEGORIES.TASK_INSIGHT);
  });

  it("includes the task-pattern lane (task #17 deliverable)", () => {
    expect(REFLECT_CATEGORIES).toContain(BRAIN_CATEGORIES.TASK_PATTERN);
  });

  it("preserves the original 5 #12 categories", () => {
    // Lock the foundational 5 from task #12 · removing any of these
    // breaks the established reflection cadence.
    const original5 = [
      BRAIN_CATEGORIES.DECISION_LOG,
      BRAIN_CATEGORIES.PATTERN,
      BRAIN_CATEGORIES.BELIEF,
      BRAIN_CATEGORIES.LESSON,
      BRAIN_CATEGORIES.LEARNING_JOURNAL,
    ];
    for (const c of original5) {
      expect(REFLECT_CATEGORIES).toContain(c);
    }
  });
});

describe("BRAIN_CATEGORIES · task-pattern lane registration (task #17)", () => {
  it("registers TASK_INSIGHT as a known category", () => {
    expect(BRAIN_CATEGORIES.TASK_INSIGHT).toBe("task_insight");
    expect(isKnownCategory("task_insight")).toBe(true);
  });

  it("registers TASK_PATTERN as a known category", () => {
    expect(BRAIN_CATEGORIES.TASK_PATTERN).toBe("task_pattern");
    expect(isKnownCategory("task_pattern")).toBe(true);
  });

  it("registers ORPHAN_TASKS_NUDGE as a known category", () => {
    expect(BRAIN_CATEGORIES.ORPHAN_TASKS_NUDGE).toBe("orphan_tasks_nudge");
    expect(isKnownCategory("orphan_tasks_nudge")).toBe(true);
  });
});
