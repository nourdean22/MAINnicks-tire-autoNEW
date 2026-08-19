/**
 * Telemetry quarantine · 2026-08-19 (memory truth wave).
 *
 * The 08-16 embedding policy kept telemetry categories out of the vector
 * index, but the Prisma recall lane (contextual-recall's top-300
 * confidence pool, floor 0.3) had no category gate — and telemetry
 * writers stamp confidence freely. Measured on prod 2026-08-19:
 * nick_quality rows at 0.9, task_completion at 1.0, i.e. eligible to
 * outrank real knowledge in the pool. One list must gate both lanes.
 */

import { describe, it, expect } from "vitest";
import { RECALL_EXCLUDE_CATEGORIES } from "@/lib/brain/categories";
import { TELEMETRY_CATEGORIES } from "@/lib/brain/embedding-policy";

describe("telemetry categories are quarantined from recall", () => {
  it("every embedding-policy telemetry category is recall-excluded", () => {
    for (const cat of TELEMETRY_CATEGORIES) {
      expect(RECALL_EXCLUDE_CATEGORIES).toContain(cat);
    }
  });

  it("pins the measured worst offenders by name — the high-confidence leaks", () => {
    // These sailed over the 0.3 confidence floor on prod:
    //   nick_quality 0.9 (output_critic) · task_completion 1.0 (brain-bus)
    //   · mastery_xp_event 0.5 · memory_gateway_shadow (1,575 rows/window)
    for (const cat of [
      "nick_quality",
      "task_completion",
      "mastery_xp_event",
      "memory_gateway_shadow",
    ]) {
      expect(RECALL_EXCLUDE_CATEGORIES).toContain(cat);
    }
  });

  it("does not quarantine knowledge categories by accident", () => {
    for (const cat of [
      "insight",
      "wisdom",
      "belief",
      "decision_log",
      "conversation_summary",
    ]) {
      expect(RECALL_EXCLUDE_CATEGORIES).not.toContain(cat);
      expect(TELEMETRY_CATEGORIES as readonly string[]).not.toContain(cat);
    }
  });
});
