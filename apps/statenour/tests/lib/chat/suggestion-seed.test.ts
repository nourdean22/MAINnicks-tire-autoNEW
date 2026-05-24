/**
 * Wave X.b · 2026-05-24 · regression tests for extractEntityFromSuggestion.
 *
 * Pinned because the prefix→entity-id mapping is the contract the
 * chat route relies on to anchor the system prompt's lastTaskId /
 * lastGoalId / lastPinId / lastReflectionId fields. A typo in a
 * prefix string would silently break the suggestion-loop UX without
 * any compile-time signal.
 */

import { describe, it, expect } from "vitest";
import {
  extractEntityFromSuggestion,
  type SuggestionMeta,
} from "@/lib/chat/suggestion-seed";

describe("extractEntityFromSuggestion", () => {
  it("preserves kind + id on the base object regardless of prefix", () => {
    const meta: SuggestionMeta = { kind: "weak-axis", id: "weak-axis-42" };
    const result = extractEntityFromSuggestion(meta);
    expect(result.lastSuggestionKind).toBe("weak-axis");
    expect(result.lastSuggestionId).toBe("weak-axis-42");
    // weak-axis is intentionally not mapped to a specific entity
    expect(result.lastTaskId).toBeUndefined();
    expect(result.lastGoalId).toBeUndefined();
  });

  it("broken-promise → lastTaskId with prefix stripped", () => {
    const result = extractEntityFromSuggestion({
      kind: "broken-promise",
      id: "broken-promise-abc123",
    });
    expect(result.lastTaskId).toBe("abc123");
  });

  it("stalled-goal → lastGoalId", () => {
    const result = extractEntityFromSuggestion({
      kind: "stalled-goal",
      id: "stalled-goal-goal-uuid-9",
    });
    expect(result.lastGoalId).toBe("goal-uuid-9");
  });

  it("stale-pin → lastPinId", () => {
    const result = extractEntityFromSuggestion({
      kind: "stale-pin",
      id: "stale-pin-pin-xyz",
    });
    expect(result.lastPinId).toBe("pin-xyz");
  });

  it("unresolved-reflection → lastReflectionId", () => {
    const result = extractEntityFromSuggestion({
      kind: "unresolved-reflection",
      id: "unresolved-reflection-r-2025-05-20",
    });
    expect(result.lastReflectionId).toBe("r-2025-05-20");
  });

  it("does not set an entity id when the prefix is missing", () => {
    // Older / malformed ids that don't carry the prefix should not
    // populate the typed entity field — better undefined than a
    // misleading id that maps to nothing in the DB.
    const result = extractEntityFromSuggestion({
      kind: "broken-promise",
      id: "abc123-no-prefix",
    });
    expect(result.lastTaskId).toBeUndefined();
    // base passthrough still works
    expect(result.lastSuggestionId).toBe("abc123-no-prefix");
  });

  it("empty stripped id (only prefix) is rejected", () => {
    // If the chip arrived with id = "broken-promise-" we must not set
    // lastTaskId to the empty string · downstream uses truthy checks.
    const result = extractEntityFromSuggestion({
      kind: "broken-promise",
      id: "broken-promise-",
    });
    expect(result.lastTaskId).toBeUndefined();
  });

  it("unknown kind passes through without mapping", () => {
    const result = extractEntityFromSuggestion({
      kind: "future-unknown-kind",
      id: "future-unknown-kind-zzz",
    });
    expect(result.lastSuggestionKind).toBe("future-unknown-kind");
    expect(result.lastSuggestionId).toBe("future-unknown-kind-zzz");
    expect(result.lastTaskId).toBeUndefined();
    expect(result.lastGoalId).toBeUndefined();
    expect(result.lastPinId).toBeUndefined();
    expect(result.lastReflectionId).toBeUndefined();
  });
});
