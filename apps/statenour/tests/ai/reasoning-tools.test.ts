/**
 * tests/ai/reasoning-tools.test.ts
 *
 * Tests for the reasoning engine's tool-access feature.
 *
 * Covers:
 *   1. getReasoningTools() returns only whitelisted read-safe tools
 *   2. No write-capable tools leak into the reasoning subset
 *   3. WHITELIST_KEYS are all real tool names (no stale entries)
 */
import { describe, it, expect } from "vitest";
import {
  getReasoningTools,
  WHITELIST_KEYS,
  REASONING_TOOL_COUNT,
} from "@/lib/ai/reasoning/reasoning-tools";

// Known write-capable tools that must NEVER appear in the reasoning subset.
// If any of these leak through, the engine could mutate state during reasoning.
const FORBIDDEN_WRITE_TOOLS = [
  "createTask",
  "updateTask",
  "sendSMS",
  "createQuickQuote",
  "triageStaleLead",
  "archiveGoal",
  "completeGoal",
  "createGoal",
  "logDecision",
  "generateImage",
  "createJournalEntry",
  "scoreLocation",
];

describe("reasoning-tools", () => {
  it("delivers EXACTLY the whitelist — a silent drop is a red test, not a shrunken toolbox", () => {
    // 2026-08-19: this was `toBeLessThanOrEqual`, which passed on any
    // silent drop — and draftOpportunitySms had been silently dropped
    // (whitelisted, but its source module wasn't spread) with the count
    // constant overreporting by one the whole time.
    const tools = getReasoningTools();
    const keys = Object.keys(tools);
    expect(keys.length).toBe(REASONING_TOOL_COUNT);
    expect([...keys].sort()).toEqual([...WHITELIST_KEYS].sort());
  });

  it("returns only whitelisted tools", () => {
    const tools = getReasoningTools();
    const keys = Object.keys(tools);
    const whitelistSet = new Set(WHITELIST_KEYS);
    for (const key of keys) {
      expect(whitelistSet.has(key)).toBe(true);
    }
  });

  it("excludes all write-capable tools", () => {
    const tools = getReasoningTools();
    const keys = new Set(Object.keys(tools));
    for (const forbidden of FORBIDDEN_WRITE_TOOLS) {
      expect(keys.has(forbidden)).toBe(false);
    }
  });

  it("whitelist count matches the constant", () => {
    expect(WHITELIST_KEYS.length).toBe(REASONING_TOOL_COUNT);
  });

  it("each returned tool has the expected AI SDK shape", () => {
    const tools = getReasoningTools();
    for (const [name, tool] of Object.entries(tools)) {
      // AI SDK tools have a type + parameters property at minimum
      expect(tool).toBeDefined();
      expect(typeof tool).toBe("object");
      // The tool should not be null
      expect(tool).not.toBeNull();
    }
  });
});
