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
  detectPhantomActionClaims,
  MUTATION_ACTIONS,
} from "../../../lib/ai/chat/action-result-verifier";

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
    const verbs = claims.map((c: any) => c.verb).sort();
    expect(verbs).toEqual(["task.create", "telegram.send"]);
  });

  it("returns [] for empty results", () => {
    expect(detectFailedActionClaims([], "Added it.")).toHaveLength(0);
  });

  it("treats the canonical write actions as mutations", () => {
    const mutations = [
      "task.create", "person.create", "telegram.send", "decision.log",
      "google.proposeEvent", "gmail.draftReply", "gmail.createDraft",
      "gmail.sendDraft", "google.draftReviewResponse", "google.markReviewResponded",
      "arsenal.browserCreateSession", "arsenal.browserCloseSession"
    ];
    for (const a of mutations) {
      expect(MUTATION_ACTIONS.has(a), `${a} should be a mutation`).toBe(true);
    }
    // Pure reads are NOT mutations
    const reads = [
      "task.status", "shop.getRevenue", "system.health", "memory.search",
      "google.getSchedule", "google.getReviewStats", "google.getUnrespondedReviews",
      "arsenal.runPython", "arsenal.browserNavigate", "arsenal.browserObserve"
    ];
    for (const a of reads) {
      expect(MUTATION_ACTIONS.has(a), `${a} should not be a mutation`).toBe(false);
    }
  });
});

describe("detectPhantomActionClaims — claimed but never emitted (the 08-25 person confabulation)", () => {
  // Verbatim from prod, message 2026-08-25 15:17:56Z: zero tool calls, zero
  // action blocks, person_profiles unchanged. Slipped detectFailedActionClaims
  // (no failed row exists when no action was emitted) AND the SDK-side vocab
  // (no person/profile entry). This suite is the canary for the closed hole.
  const VERBATIM_0825 = "Done — both profiles created.";

  it("BREAKS: flags the verbatim prod confabulation with empty results", () => {
    const claims = detectPhantomActionClaims([], VERBATIM_0825);
    expect(claims.length).toBe(1);
    expect(claims[0].expectedTool).toBe("person.create");
    expect(claims[0].snippet).toContain("profiles created");
  });

  it("flags 'added them to your people' phrasing", () => {
    const claims = detectPhantomActionClaims([], "All set. I added both to your people.");
    expect(claims.length).toBe(1);
  });

  it("positive control: an EMITTED person.create (success) is not phantom", () => {
    const claims = detectPhantomActionClaims(
      [{ action: "person.create", success: true }],
      VERBATIM_0825,
    );
    expect(claims.length).toBe(0);
  });

  it("an EMITTED-but-FAILED person.create is not phantom either — detectFailedActionClaims owns it", () => {
    const claims = detectPhantomActionClaims(
      [{ action: "person.create", success: false, error: "boom" }],
      VERBATIM_0825,
    );
    expect(claims.length).toBe(0);
  });

  it("hedged prose is not a claim", () => {
    expect(
      detectPhantomActionClaims([], "I can create profiles for both if you want."),
    ).toEqual([]);
    expect(
      detectPhantomActionClaims([], "Do you want me to add them to your people?"),
    ).toEqual([]);
  });

  it("second-person reflection is not a self-claim", () => {
    expect(
      detectPhantomActionClaims([], "Nice — you added the profiles yourself yesterday."),
    ).toEqual([]);
  });

  it("a hedge in one sentence does not suppress a bare claim in another", () => {
    const text = "I could tune the dossiers later if you want. Both profiles created.";
    expect(detectPhantomActionClaims([], text).length).toBe(1);
  });

  it("one warning per action type, not per matching sentence", () => {
    const text = "Profiles created. Person added to your people.";
    expect(detectPhantomActionClaims([], text).length).toBe(1);
  });

  it("unrelated prose never matches", () => {
    expect(
      detectPhantomActionClaims([], "The workout went well and the BBQ plan is solid."),
    ).toEqual([]);
  });
});
