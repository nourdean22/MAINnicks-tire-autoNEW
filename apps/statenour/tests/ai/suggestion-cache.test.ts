/**
 * heuristicSuggestions tests · v10.0.160
 *
 * Pre-fix the Bay 5 Revive turn got the generic "Top 3 for right now"
 * triple even though "Bay 5 Revive" was right there in Nick's reply.
 * Tests pin the upgraded entity-grounded heuristic against:
 *   · the actual Bay 5 case
 *   · category fallback when no entity present
 *   · proper-noun extraction edge cases
 */

import { describe, it, expect } from "vitest";
import { heuristicSuggestions } from "@/lib/ai/suggestion-cache";

describe("heuristicSuggestions · entity grounding", () => {
  it("references Bay 5 Revive instead of generic 'Top 3' templates", () => {
    const reply =
      "Yes, added the suggested tasks to Bay 5 Revive project. Total tasks now: 15.";
    const r = heuristicSuggestions(reply);
    expect(r).toHaveLength(3);
    // At least one suggestion must reference the entity.
    expect(r.some((s) => s.includes("Bay 5 Revive"))).toBe(true);
    // The pre-fix canned trio should NOT appear.
    expect(r).not.toContain("Top 3 for right now");
  });

  it("references a single-word project name", () => {
    const reply = "I checked the Pulse dashboard and tasks look healthy.";
    const r = heuristicSuggestions(reply);
    expect(r.some((s) => s.includes("Pulse"))).toBe(true);
  });

  it("falls back to category templates when no entity is identifiable", () => {
    const reply =
      "you have a few critical tasks today and one open loop with a deadline.";
    const r = heuristicSuggestions(reply);
    // No proper noun → use the original task-category triple
    expect(r).toContain("Top 3 for right now");
  });

  it("does not extract 'Yes' / 'Nick' / 'Nour' as entities", () => {
    const reply = "Yes Nick agreed and Nour confirmed the plan.";
    const r = heuristicSuggestions(reply);
    // None of the suggestions should reference Nick or Nour or Yes
    expect(r.every((s) => !s.includes("Yes"))).toBe(true);
    expect(r.every((s) => !s.includes("Nick"))).toBe(true);
    expect(r.every((s) => !s.includes("Nour"))).toBe(true);
  });

  it("ranks first entity (typically the topic) over later ones", () => {
    const reply =
      "I sent the Bay 5 Revive update to Dania and CC'd the Tesla team.";
    const r = heuristicSuggestions(reply);
    // Bay 5 Revive is the subject; suggestions should pivot on it
    expect(r.some((s) => s.includes("Bay 5 Revive"))).toBe(true);
  });

  it("handles a revenue-category entity reply", () => {
    const reply =
      "Acme Corp invoices booked $12,400 this week — that's pipeline-weight.";
    const r = heuristicSuggestions(reply);
    // Entity AND revenue category → entity-grounded revenue triple
    expect(r.some((s) => s.includes("Acme Corp"))).toBe(true);
    expect(r.length).toBe(3);
  });
});

describe("heuristicSuggestions · sentence-start capitalization", () => {
  it("does NOT extract sentence-leading common words", () => {
    const reply = "These tasks are blocking the launch. Done planning yet?";
    const r = heuristicSuggestions(reply);
    // 'These' is a sentence-start cap, NOT a real entity
    expect(r.every((s) => !s.includes("These"))).toBe(true);
  });
});
