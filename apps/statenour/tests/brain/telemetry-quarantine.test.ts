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

describe("the 2026-09-22 brain audit: machine categories that were still recall-visible", () => {
  // Measured read-only on prod (42,129 live memories, 190 categories): recall hid
  // 6,080 rows across 13 telemetry categories, but these five machine categories
  // were still in the pool. semantic_edge alone is 18,358 live rows (44% of the
  // live brain) whose text is "[cat] <-> [cat] . score=0.82" - graph edges written
  // by lib/brain/semantic-link.ts, each carrying ~3 vectors, 64% of all
  // brain_memory vectors. The graph API reads them by category; recall and the
  // embedding backfill must not.
  it("quarantines the five audited categories from recall AND from embedding", () => {
    for (const cat of ["semantic_edge", "reply_judgment", "chat_importance", "crons", "mission_surface_telemetry"]) {
      expect(TELEMETRY_CATEGORIES as readonly string[], cat).toContain(cat);
      expect(RECALL_EXCLUDE_CATEGORIES, cat).toContain(cat);
    }
  });

  it("leaves tool_embedding visible on purpose - tool search reads those rows (lib/ai/tool-embeddings.ts)", () => {
    expect(TELEMETRY_CATEGORIES as readonly string[]).not.toContain("tool_embedding");
    expect(RECALL_EXCLUDE_CATEGORIES).not.toContain("tool_embedding");
  });
});
