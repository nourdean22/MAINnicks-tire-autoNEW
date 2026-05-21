/**
 * Action-claim detector tests · v10.0.160
 *
 * Built off the actual Bay 5 Revive hallucination diagnosed via
 * /api/system/agent-traces[traceId] envelope (messageId
 * cmopt9mkl000404l5qfz1g4rj). The smoking gun: text said "Yes, added
 * the suggested tasks · Total tasks now: 15" but envelope.toolsCalled
 * was empty.
 *
 * These tests pin the detector against:
 *   · the exact Bay 5 hallucination phrasing
 *   · common task-claim variants
 *   · hedged phrasing that should NOT trigger
 *   · false positives (analytical verbs like "noticed")
 */

import { describe, it, expect } from "vitest";
import {
  detectActionClaims,
  detectActionClaimsWithoutTools,
} from "@/lib/ai/chat/action-claim-detector";

describe("detectActionClaims · the Bay 5 case", () => {
  it("flags the exact Bay 5 fabrication phrasing", () => {
    const text =
      "Yes, added the suggested tasks to Bay 5 Revive project. Total tasks now: 15.";
    const r = detectActionClaims(text);
    expect(r.claims.length).toBeGreaterThan(0);
    expect(r.claims.some((c) => c.expectedTool.includes("createTask"))).toBe(true);
  });

  it("flags 'I've added X tasks'", () => {
    const r = detectActionClaims("I've added 3 follow-up tasks to your inbox.");
    expect(r.claims.length).toBeGreaterThan(0);
  });

  it("flags 'sent the email'", () => {
    const r = detectActionClaims("Done — sent the email to the customer.");
    expect(r.claims.some((c) => c.expectedTool.includes("sendEmail"))).toBe(true);
  });

  it("flags 'scheduled follow-up'", () => {
    const r = detectActionClaims("Scheduled a follow-up for 3 days from now.");
    // tool name is scheduleFollowUp (capital U) per catalog.ts
    expect(r.claims.some((c) => c.expectedTool.toLowerCase().includes("schedulefollowup"))).toBe(true);
  });

  it("flags 'marked done' completions", () => {
    const r = detectActionClaims("Marked the top one done and moved on.");
    expect(r.claims.length).toBeGreaterThan(0);
  });

  it("flags 'pinned' memory writes", () => {
    const r = detectActionClaims("Pinned that to the brain so I'll remember next time.");
    expect(r.claims.some((c) => c.expectedTool.includes("updatePinnedMemory"))).toBe(true);
  });
});

describe("detectActionClaims · hedged phrases (should NOT trigger)", () => {
  it("does not flag 'I can add the tasks if you want'", () => {
    const r = detectActionClaims("I can add the tasks if you want me to.");
    // claims may still be present from the verb scan, but hedged=true
    expect(r.hedged).toBe(true);
  });

  it("does not flag 'Do you want me to add them?'", () => {
    const r = detectActionClaims("Do you want me to add them as tasks now?");
    expect(r.hedged).toBe(true);
  });

  it("does not flag 'Please add them'", () => {
    const r = detectActionClaims("Please add them and let me know.");
    expect(r.hedged).toBe(true);
  });

  it("does not flag 'I'll add them' (future tense)", () => {
    const r = detectActionClaims("I'll add them next time we sync.");
    expect(r.hedged).toBe(true);
  });

  it("does not flag 'I recommend adding'", () => {
    const r = detectActionClaims("I recommend adding three more tasks here.");
    expect(r.hedged).toBe(true);
  });

  it("does not flag 'I cannot add' refusals", () => {
    const r = detectActionClaims("I can't add tasks without more info.");
    expect(r.hedged).toBe(true);
  });
});

describe("detectActionClaims · false positives", () => {
  it("does not flag analysis verbs like 'noticed', 'saw', 'found'", () => {
    const r = detectActionClaims(
      "I noticed three patterns in the data and saw a clear trend.",
    );
    expect(r.claims).toHaveLength(0);
  });

  it("does not flag a substring match — 'saved' inside 'unsaved'", () => {
    const r = detectActionClaims("The unsaved draft is in the editor.");
    // Word-boundary regex should not match "saved" inside "unsaved".
    // The phrase doesn't include "saved + brain/note/memory" so no claim.
    expect(r.claims).toHaveLength(0);
  });
});

describe("detectActionClaimsWithoutTools · the gate behavior", () => {
  it("returns the Bay 5 fabricated claim when no tools fired", () => {
    const text =
      "Yes, added the suggested tasks to Bay 5 Revive project. Total tasks now: 15.";
    const result = detectActionClaimsWithoutTools(text, []);
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns empty when createTask actually fired", () => {
    const text =
      "Yes, added the suggested tasks to Bay 5 Revive project. Total tasks now: 15.";
    const result = detectActionClaimsWithoutTools(text, [
      { name: "createTask" },
    ]);
    expect(result).toHaveLength(0);
  });

  it("returns empty when text is hedged (no fabrication possible)", () => {
    const text = "I can add those tasks if you'd like me to.";
    const result = detectActionClaimsWithoutTools(text, []);
    expect(result).toHaveLength(0);
  });

  it("matches multiple acceptable tools via pipe alternation", () => {
    const text = "Sent it to the customer.";
    // sendEmail OR sendTelegram should satisfy
    const r1 = detectActionClaimsWithoutTools(text, [{ name: "sendTelegram" }]);
    expect(r1).toHaveLength(0);
    const r2 = detectActionClaimsWithoutTools(text, [{ name: "sendEmail" }]);
    expect(r2).toHaveLength(0);
    const r3 = detectActionClaimsWithoutTools(text, []);
    expect(r3.length).toBeGreaterThan(0);
  });

  it("tool names are case-insensitive (createtask matches createTask)", () => {
    const text = "Added 3 tasks.";
    const r = detectActionClaimsWithoutTools(text, [{ name: "createtask" }]);
    expect(r).toHaveLength(0);
  });
});

describe("detectActionClaims · per-sentence hedge isolation", () => {
  it("detects a fabrication even when a LATER sentence is hedged", () => {
    // Pre-fix bug: `hedged` was document-wide, so the future-tense
    // second sentence suppressed the real fabrication in the first.
    const text = "Added the tasks to Bay 5 Revive. I'll send a recap later.";
    const result = detectActionClaimsWithoutTools(text, []);
    expect(result.length).toBeGreaterThan(0);
    expect(result.some((c) => c.expectedTool.includes("createTask"))).toBe(true);
  });

  it("still suppresses a claim hedged within its own sentence", () => {
    const text = "I would add those tasks if you want.";
    const result = detectActionClaimsWithoutTools(text, []);
    expect(result).toHaveLength(0);
  });

  it("a hedge in one sentence does not suppress a real claim in another", () => {
    const text =
      "I can add more later. Sent the email to the customer just now.";
    const result = detectActionClaimsWithoutTools(text, []);
    expect(result.some((c) => c.expectedTool.includes("sendEmail"))).toBe(true);
  });
});

describe("detectActionClaims · abbreviation-safe sentence split", () => {
  it("detects a claim straddling an 'i.e.' clause", () => {
    // Pre-fix splitSentences broke on the "i.e." period — "sent"
    // landed in one fragment and "the email" in the next, so the
    // claim was visible in neither.
    const result = detectActionClaimsWithoutTools(
      "Sent it, i.e. the email to the customer.",
      [],
    );
    expect(result.some((c) => c.expectedTool.includes("sendEmail"))).toBe(true);
  });

  it("detects a claim straddling an 'e.g.' clause", () => {
    const result = detectActionClaimsWithoutTools(
      "Sent it, e.g. the email to the customer.",
      [],
    );
    expect(result.some((c) => c.expectedTool.includes("sendEmail"))).toBe(true);
  });
});
