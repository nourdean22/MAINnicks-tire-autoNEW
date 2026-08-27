/**
 * Canary · memory-recall CONTEXT_CATEGORIES admits the durable personal layer
 * (2026-08-27 retrieval baseline, docs/RETRIEVAL-BASELINE-2026-08-27.md F1).
 *
 * The measured defect: the whitelist contained NO durable personal category,
 * so the lane KNN'd the corpus correctly and then deleted the answers —
 * hit@5 = 0/28 on the labelled corpus while dense rank was #1 on several
 * cases. This pins the fix in both directions:
 *   · every durable personal category is recallable (positive), and
 *   · telemetry categories stay OUT (negative control — the filter must
 *     still filter; a whitelist that admits everything is no whitelist).
 */
import { describe, expect, it } from "vitest";
import {
  CONTEXT_CATEGORIES,
  DURABLE_PERSONAL_CATEGORIES,
} from "../../lib/brain/memory-recall";

describe("memory-recall · durable personal categories are recallable", () => {
  it("admits every durable personal category", () => {
    for (const cat of DURABLE_PERSONAL_CATEGORIES) {
      expect(CONTEXT_CATEGORIES.has(cat), `${cat} must be context-recallable`).toBe(true);
    }
    // The operator's real query classes from the eval corpus, asserted
    // individually so a future trim of the shared list names the casualty.
    for (const cat of ["relationships", "health", "identity", "event", "biography"]) {
      expect(CONTEXT_CATEGORIES.has(cat), `${cat} is a measured operator query class`).toBe(true);
    }
  });

  it("negative control: telemetry categories are still filtered", () => {
    for (const cat of ["memory_gateway_shadow", "nick_quality", "mastery_xp_event", "persona_drift"]) {
      expect(CONTEXT_CATEGORIES.has(cat), `${cat} is telemetry — must never spend a recall slot`).toBe(false);
    }
  });

  it("regression: the legacy whitelist survives the extension", () => {
    for (const cat of ["wisdom", "insight", "domain_knowledge", "chat_summary", "task_lesson"]) {
      expect(CONTEXT_CATEGORIES.has(cat), `${cat} was recallable before this wave`).toBe(true);
    }
  });
});
