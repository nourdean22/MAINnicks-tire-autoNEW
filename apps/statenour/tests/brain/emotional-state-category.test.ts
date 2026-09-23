/**
 * emotional_state is a registered brain category (2026-09-23).
 *
 * journal-ingest and pipeline-controller have written hourly mood rows under
 * "emotional_state" since v10.0.232, but the category was never added to
 * BRAIN_CATEGORIES. So every write took memory-manager's unknown-category path:
 * a log.warn("unknown_category") (5 in production on 09-23, one per chat turn
 * with a mood signal), review_required stamped on the row, and the memory
 * commit gateway's "unknown_category" verdict instead of its normal rules.
 */
import { describe, it, expect } from "vitest";
import { BRAIN_CATEGORIES, isKnownCategory } from "@/lib/brain/categories";

describe("emotional_state category", () => {
  it("is registered, so its writes stop taking the unknown-category path", () => {
    expect(isKnownCategory("emotional_state")).toBe(true);
    expect(BRAIN_CATEGORIES.EMOTIONAL_STATE).toBe("emotional_state");
  });

  // Control: the check still rejects a category nobody registered.
  it("an unregistered category is still unknown", () => {
    expect(isKnownCategory("definitely_not_a_category_2026")).toBe(false);
  });
});

/**
 * 18 more categories with live writers that were never registered
 * (registered 2026-09-23). Each writer is pinned by file, so a writer that
 * moves or stops writing fails here instead of leaving a stale registry row.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const LIVE_WRITERS: ReadonlyArray<[category: string, writer: string]> = [
  ["action_outcome", "lib/brain/pipeline-controller.ts"],
  ["business_alert", "lib/brain/pipeline-controller.ts"],
  ["business_event", "lib/brain/pipeline-controller.ts"],
  ["camera_alert", "lib/brain/camera-intelligence.ts"],
  ["concern", "lib/brain/journal-ingest.ts"],
  ["deep_research", "lib/ai/deep-research.ts"],
  ["deep_scan", "lib/brain/deep-scan.ts"],
  ["employee_attendance", "lib/brain/camera-intelligence.ts"],
  ["improvement_hypothesis", "lib/brain/improve-agent.ts"],
  ["lead_intent", "lib/integrations/gmail-sync.ts"],
  ["link_analysis", "app/api/telegram/webhook/route.ts"],
  ["meta_pattern", "lib/brain/memory-consolidation.ts"],
  ["operating_rhythm", "lib/brain/operating-rhythm.ts"],
  ["pricing_intelligence", "lib/brain/autonomous-engine.ts"],
  ["revenue_playbook", "lib/brain/drive-ingest.ts"],
  ["routine", "lib/integrations/gmail-sync.ts"],
  ["shop_traffic", "lib/brain/camera-intelligence.ts"],
  ["visual_input", "app/api/telegram/webhook/route.ts"],
];

describe("live-writer categories registered 2026-09-23", () => {
  it.each(LIVE_WRITERS)("%s is registered", (category) => {
    expect(isKnownCategory(category)).toBe(true);
  });

  it.each(LIVE_WRITERS)("%s is still written by %s", (category, writer) => {
    const src = readFileSync(resolve(__dirname, "../..", writer), "utf8");
    expect(src).toContain(`"${category}"`);
  });
});
