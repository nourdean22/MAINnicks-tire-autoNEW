/**
 * Action-result verifier tests · action-block fabrication guard.
 *
 * The SDK-tool fabrication guard (action-claim-detector.ts) only sees
 * `capturedToolCalls`. Nick's action BLOCKS (```action {type:...})
 * run via executeActions() in deferred background work and never reach
 * that guard. This module is the action-block analog: when a MUTATION
 * action returns success:false AND Nick's prose claimed a completed
 * side effect, surface it so the existing correction chip can warn.
 *
 * These tests pin:
 *   · failed mutation + completion claim  → warns
 *   · failed mutation + ask-first/hedged prose (people-gate guard) → silent
 *   · successful mutation → silent
 *   · failed READ action → silent (not a fabricated side effect)
 *   · multiple failures → one claim each
 */

import { describe, it, expect } from "vitest";
import {
  detectFailedActionClaims,
  MUTATION_ACTIONS,
} from "@/lib/ai/chat/action-result-verifier";

const FAIL = (action: string, error = "boom") => ({ action, success: false, error });
const OK = (action: string) => ({ action, success: true });

describe("detectFailedActionClaims", () => {
  it("warns when a mutation action fails AND the prose claims completion", () => {
    const claims = detectFailedActionClaims(
      [FAIL("task.create", "DB write timeout")],
      "Done — added that task to your Bay 5 mission.",
    );
    expect(claims).toHaveLength(1);
    expect(claims[0].verb).toBe("task.create");
    expect(claims[0].expectedTool).toBe("task.create");
    expect(claims[0].snippet).toContain("DB write timeout");
  });

  it("stays silent on the people-gate ask-first guard (failure but no completion claim)", () => {
    // handlePersonUpdate returns success:false with an 'ask first' error
    // when no person matches. Nick's prose asks first — no completion verb.
    const claims = detectFailedActionClaims(
      [FAIL("person.update", "not found — ask before creating")],
      "I don't see anyone by that name in your people. Want me to add them?",
    );
    expect(claims).toHaveLength(0);
  });

  it("stays silent when the prose is hedged (would/could/if you want)", () => {
    const claims = detectFailedActionClaims(
      [FAIL("task.create")],
      "I could add that task if you want me to.",
    );
    expect(claims).toHaveLength(0);
  });

  it("stays silent when the mutation succeeded", () => {
    const claims = detectFailedActionClaims(
      [OK("task.create")],
      "Added that task to your list.",
    );
    expect(claims).toHaveLength(0);
  });

  it("stays silent on a failed READ action (not a fabricated side effect)", () => {
    const claims = detectFailedActionClaims(
      [FAIL("shop.getRevenue", "gateway offline")],
      "Pulled the latest — revenue is up.",
    );
    expect(claims).toHaveLength(0);
  });

  it("returns one claim per failed mutation when several fail", () => {
    const claims = detectFailedActionClaims(
      [FAIL("task.create"), FAIL("telegram.send"), OK("memory.remember")],
      "Added the task and sent you a push notification.",
    );
    expect(claims).toHaveLength(2);
    const verbs = claims.map((c) => c.verb).sort();
    expect(verbs).toEqual(["task.create", "telegram.send"]);
  });

  it("returns [] for empty results", () => {
    expect(detectFailedActionClaims([], "Added it.")).toHaveLength(0);
  });

  it("treats the canonical write actions as mutations", () => {
    for (const a of ["task.create", "person.create", "telegram.send", "decision.log"]) {
      expect(MUTATION_ACTIONS.has(a)).toBe(true);
    }
    // Pure reads are NOT mutations
    for (const a of ["task.status", "shop.getRevenue", "system.health", "memory.search"]) {
      expect(MUTATION_ACTIONS.has(a)).toBe(false);
    }
  });
});
