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
  EDGE_CLAIM_PATTERNS,
} from "@/lib/ai/chat/action-claim-detector";
import { ACTION_VOCAB } from "@/lib/ai/action-vocab";
import { TOOL_CATALOG } from "@/lib/ai/tools/catalog";

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
    // Real chat tool is composeEmail (there is no sendEmail chat tool).
    expect(r.claims.some((c) => c.expectedTool.includes("composeEmail"))).toBe(true);
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
    // Real chat tool is pinMemory (there is no updatePinnedMemory).
    expect(r.claims.some((c) => c.expectedTool.includes("pinMemory"))).toBe(true);
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
    // composeEmail OR sendTelegram should satisfy (both are real tools).
    const r1 = detectActionClaimsWithoutTools(text, [{ name: "sendTelegram" }]);
    expect(r1).toHaveLength(0);
    const r2 = detectActionClaimsWithoutTools(text, [{ name: "composeEmail" }]);
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
    expect(result.some((c) => c.expectedTool.includes("composeEmail"))).toBe(true);
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
    expect(result.some((c) => c.expectedTool.includes("composeEmail"))).toBe(true);
  });

  it("detects a claim straddling an 'e.g.' clause", () => {
    const result = detectActionClaimsWithoutTools(
      "Sent it, e.g. the email to the customer.",
      [],
    );
    expect(result.some((c) => c.expectedTool.includes("composeEmail"))).toBe(true);
  });
});

// ── v-truth · the live "POSSIBLY FABRICATED" false-positive family ──
// Reproduced from the bdnick.info screenshot: Nick wrote a reflective
// coaching message citing [brain:recall] and was flagged as having
// fabricated a linkResource + send action — even though he claimed no
// action at all. These pin the fixes (citation strip + first-person
// anchor on relational verbs + second-person reflection hedge).
describe("detectActionClaims · citation + reflection false positives", () => {
  it("does NOT flag a [brain:recall] citation framed as 'Linked to:'", () => {
    // The exact screenshot phrasing. [brain:recall] is sanctioned
    // citation syntax; "Linked to:" is editorial, not a link action.
    const r = detectActionClaimsWithoutTools(
      "Next move: deploy Statenour. Linked to: [brain:recall] (past guilt).",
      [],
    );
    expect(r).toHaveLength(0);
  });

  it("does NOT flag 'linked to your goals' (relational prose)", () => {
    const r = detectActionClaimsWithoutTools(
      "This habit is linked to your goals from last month.",
      [],
    );
    expect(r).toHaveLength(0);
  });

  it("does NOT flag reflecting the user's past send ('you texted Dania')", () => {
    const r = detectActionClaimsWithoutTools(
      "Commitment overdue: you texted Dania tonight but never followed up.",
      [],
    );
    expect(r).toHaveLength(0);
  });

  it("does NOT flag reflecting the user's past completion ('you finished')", () => {
    const r = detectActionClaimsWithoutTools(
      "Last week you finished the brake job ahead of schedule.",
      [],
    );
    expect(r).toHaveLength(0);
  });

  it("STILL flags a real first-person link claim ('I linked it…')", () => {
    // The anchor must not blind us to genuine fabrications.
    const r = detectActionClaimsWithoutTools(
      "I linked it to the Bay 5 project for you.",
      [],
    );
    expect(r.some((c) => c.expectedTool.includes("updateTask"))).toBe(true);
  });

  it("STILL flags a real send when Nick is the subject ('Sent the email')", () => {
    const r = detectActionClaimsWithoutTools("Sent the email to the customer.", []);
    expect(r.length).toBeGreaterThan(0);
  });
});

// ── v-truth · poka-yoke · every expected-tool must be a REAL tool ──
// The bug this prevents: the detector mapped claims to tools that
// don't exist in nourTools (saveToBrain, linkResource, moveTask,
// publishContent, updatePinnedMemory, sendEmail). An unsatisfiable
// expectedTool can NEVER match a fired tool → the claim is flagged as
// fabricated FOREVER, even when the model did the right thing. The
// vocab-parity test only checked regex symmetry, not tool existence —
// this closes that gap. If you rename a tool, this fails until the
// vocab/edge mapping catches up.
describe("action-claim detector · expected tools all exist in the catalog", () => {
  const REAL_TOOLS = new Set(TOOL_CATALOG.map((t) => t.name));

  it("every ACTION_VOCAB tool resolves to a registered chat tool", () => {
    for (const concept of ACTION_VOCAB) {
      for (const tool of concept.tool.split("|")) {
        expect(REAL_TOOLS.has(tool), `vocab "${concept.intent}" → unknown tool "${tool}"`).toBe(true);
      }
    }
  });

  it("every EDGE_CLAIM_PATTERNS mapsToTool resolves to a registered chat tool", () => {
    for (const edge of EDGE_CLAIM_PATTERNS) {
      for (const tool of edge.mapsToTool.split("|")) {
        expect(REAL_TOOLS.has(tool), `edge "${edge.verb}" → unknown tool "${tool}"`).toBe(true);
      }
    }
  });
});
