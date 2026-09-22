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

describe("detectActionClaims - production false positives (2026-09-22 banner audit)", () => {
  // Every L2 verifier banner in 60 days of production replies (52) was read
  // against L2's own diagnostic line. `pinned` drove 15 banners with 3 real
  // claims; bare `sent` drove 10 with none. The patterns matched adjectives,
  // quoted labels, metaphors and recaps of OTHER people's actions - and a false
  // banner is not cosmetic: L3 replaces that turn in the model's history, so a
  // legitimate reply is erased. Each case below is a production shape with the
  // names swapped. The detector must stay quiet here AND (next block) keep
  // firing on the real claims from the same audit.
  const quiet = (text: string) =>
    expect(detectActionClaims(text).claims.map((c) => c.verb), text).toEqual([]);

  it.each([
    "Pain is the mirror. [Pinned by the operator] 2. Boredom = phase-1 drift signal.",
    "Constrain the surface. A lofi pinned tab. Strip the homepage by clearing watch history.",
    "and read your own pinned rule right now: when something hurts, that's my own insecurity.",
    "First impression - bio, pic, grid, highlights, pinned posts.",
    "Why this fits you: your pinned pattern is avoidance and anxiety.",
    "The origin story from pinned memory: he never got the attention he needed.",
    "What I have is scattered across pinned memories, journal dumps, and brain logs (founding year not pinned).",
    'Pinned notes tagged "oldest_brother" and "st_mark" (early 20s).',
    "What I do well: I remember pinned context. I track commitments.",
    "That's being pinned between hurting someone you care about and facing a fear.",
    "Want me to pull what I can from this week - wisdom memories, pinned items, and other artifacts?",
  ])("pinned as an adjective, label or metaphor is not a claim: %s", quiet);

  it.each([
    "Heavy bag day, sent the landlord money, did the walk, talked to a stranger - that's a full day.",
    "**Sent 400 dollars to the supplier** - committed and cleared. That's a solid one.",
    "Alright. Then it's already done - text sent, commitment made.",
    "Has she ever texted you first since February, even small stuff?",
    "- Sam sent a text that wasn't the issue. You're right that he sent the text.",
    "Week 3: 3 collab DMs sent, 5 local accounts engaged daily.",
    "The user is reflecting on a replay loop - a customer he sent to jail.",
    "The second joint is biting the hand that sent you to the gym.",
    '"I\'ve missed two weeks and the coach texted me. If I don\'t show my face I\'m gonna hear about it."',
    '- Past chat: "just texted her i just got done working out" - 27d ago, waiting on response',
  ])("someone else's send is not Nick's claim: %s", quiet);

  it.each([
    "Smoke, eat early, sleep by 11. Want me to set a 6pm food reminder?",
    "want me to set a 90-minute reminder so you actually pull yourself out of there?",
    "Pick the spot - I'll log it and set the reminder.",
    "Want me to build this as a saved queue in your brain so you can cycle through them?",
  ])("an offer or a promise is not a claim: %s", quiet);
});

describe("detectActionClaims - the real claims from the same audit still fire (positive controls)", () => {
  // Silencing and fixing produce the same green suite unless the true case is
  // pinned alongside the false one. These are the audit's real fabrications
  // plus the terse confirmation shapes Nick actually uses.
  it.each([
    ["Pinned. I'll surface it every time something lands hard.", "pinMemory"],
    ["All entries pinned. Every insight, every raw line - now in the brain.", "pinMemory"],
    ["Synced. Wisdom memories stored, and the pattern is pinned so it surfaces.", "pinMemory"],
    ["Pinned that to the brain so I'll remember next time.", "pinMemory"],
    ["I've pinned that.", "pinMemory"],
    ["Sent it.", "composeEmail"],
    ["Done - sent the email to the customer.", "composeEmail"],
    ["I sent it over a minute ago.", "composeEmail"],
    ["I've already texted him the address.", "composeEmail"],
    ["Texted her. She'll confirm by 6.", "composeEmail"],
    ["- Sent. Both invoices went out at 9.", "composeEmail"],
  ])("%s -> %s", (text, tool) => {
    const r = detectActionClaims(text);
    expect(r.claims.some((c) => c.expectedTool.includes(tool)), text).toBe(true);
  });
});

describe("detectActionClaims - the remaining vocab false positives (2026-09-22 survivor audit)", () => {
  // After the pinned/sent fix, 17 of 52 production banners still fired. Read
  // by hand: 3 real pinned claims, 5 "Task created" confirmations with no tool
  // evidence on the row either way, and 8 more false positives from three
  // vocabulary concepts that had no subject requirement at all - an adjective
  // ("closed job"), a negation ("isn't marked done", "haven't been ingested"),
  // a third person ("she finished the job"), a passive description ("gets
  // logged as a remembered note") and a you-hedge with two words in the gap
  // ("you've already bookmarked or saved"). Production shapes, names swapped.
  const quiet = (text: string) =>
    expect(detectActionClaims(text).claims.map((c) => c.verb), text).toEqual([]);

  it.each([
    "Log that closed job. Then the invoices.",
    "What's the closed job worth, and are those 6 invoices getting called today?",
    "The system can't give you credit for what isn't marked done.",
    "Either way, she finished the job.",
  ])("task-complete: an adjective, a negation or someone else's completion is not a claim: %s", quiet);

  it.each([
    "Search your journal entries for anything you've already bookmarked or saved on this topic.",
    "The right move: this turn gets logged as a remembered note.",
  ])("memory-write: a passive description or the user's own saving is not a claim: %s", quiet);

  it.each([
    "Your phone notes haven't been ingested - the Google Drive sync has been broken since June.",
    "Nothing was pulled from the calendar this morning; the token expired.",
    "I haven't synced the calendar yet.",
  ])("data-sync: a broken or negated sync is not a claim: %s", quiet);
});

describe("detectActionClaims - the confirmations Nick actually uses still fire (positive controls)", () => {
  // The vocab's verb-to-object gap is 30 chars (15 for data-sync); every
  // control below sits inside it, so a miss is the subject rule, not the gap.
  it.each([
    ["Completed both tasks.", "completeTask"],
    ["Marked the top one done and moved on.", "completeTask"],
    ["Done - closed the job and logged it.", "completeTask"],
    ["I finished the brake job write-up.", "completeTask"],
    ["Saved that to the brain.", "pinMemory"],
    ["I've noted that for tomorrow's brief.", "pinMemory"],
    ["Synced your calendar - 3 new events.", "syncCalendar"],
    ["I just pulled Drive again.", "syncDriveMemory"],
    ["Ingested the knowledge base folder.", "syncDriveMemory"],
  ])("%s -> %s", (text, tool) => {
    const r = detectActionClaims(text);
    expect(r.claims.some((c) => c.expectedTool.includes(tool)), text).toBe(true);
  });
});

describe("detectActionClaims - 'pinned to <surface>' is a UI noun, not a memory write (2026-09-22, sibling audit)", () => {
  // The sibling session classified all 41 chat_claim_warn rows of 60 days: 8
  // genuine, 32 false positives, 1 ambiguous. Today's detector flags the 8 real
  // ones plus ONE residual - "Story highlights pinned to the shop" (trace
  // t_msuu1c9w, 2026-08-15): "pinned" followed by an external surface is
  // describing a profile or a feed, not claiming a pinMemory call.
  const quiet = (text: string) =>
    expect(detectActionClaims(text).claims.map((c) => c.verb), text).toEqual([]);

  it.each([
    "Story highlights pinned to the shop - service walkthroughs, customer wins, Cleveland moments.",
    "Keep the address pinned to the profile page so first-time visitors see it.",
    "That note is pinned to the top of the channel.",
    "Pinned to the board for the whole crew to see.",
  ])("quiet: %s", quiet);

  it("positive controls: a pin INTO the brain still fires", () => {
    for (const text of ["Pinned that to the brain so I'll remember next time.", "Pinned. I'll surface it every time something lands hard."]) {
      expect(detectActionClaims(text).claims.some((c) => c.expectedTool.includes("pinMemory")), text).toBe(true);
    }
  });
});

/**
 * 2026-09-22 · Codex follow-ups on #2513 and #2522 (review threads on merged PRs).
 * Each block: the production-shaped false negative or false positive the review
 * named, plus the positive control that must keep firing.
 */
describe("negation hedges are scoped to their clause, not the sentence (Codex on #2513)", () => {
  it("a negated clause does not hide a positive completion claim after a contrast conjunction", () => {
    const r = detectActionClaims("I haven't synced the calendar, but I completed both tasks.");
    expect(r.claims.some((c) => c.expectedTool.includes("completeTask"))).toBe(true);
    expect(r.hedged).toBe(true); // the sentence still reports its hedge for telemetry
  });
  it("the same clause order reversed also keeps the claim", () => {
    const r = detectActionClaims("I completed both tasks, but I haven't synced the calendar yet.");
    expect(r.claims.some((c) => c.expectedTool.includes("completeTask"))).toBe(true);
    expect(r.claims.some((c) => c.expectedTool.includes("syncCalendar"))).toBe(false);
  });
  it("POSITIVE CONTROL: a purely negated sentence is still quiet", () => {
    expect(detectActionClaims("I haven't synced the calendar.").claims).toHaveLength(0);
    expect(detectActionClaims("Nothing was pulled from Gmail, and no tasks were closed.").claims).toHaveLength(0);
  });
  it("POSITIVE CONTROL: a hedge in one sentence still does not leak into the next", () => {
    const r = detectActionClaims("I'll send the recap later. Completed the task.");
    expect(r.claims.some((c) => c.expectedTool.includes("completeTask"))).toBe(true);
  });
});

describe("`pinned to the top of the brain` is a memory-write claim, not a UI surface (Codex on #2522)", () => {
  const pinned = EDGE_CLAIM_PATTERNS.find((p) => p.verb === "pinned")!.regex;
  it("fires on a brain or memory qualifier after `top`", () => {
    expect(pinned.test("Pinned to the top of the brain.")).toBe(true);
    expect(pinned.test("Pinned to the top of long-term memory.")).toBe(true);
    expect(pinned.test("Pinned to the top of your memory so it surfaces first.")).toBe(true);
  });
  it("POSITIVE CONTROL: a UI top stays quiet", () => {
    expect(pinned.test("Pinned to the top of your profile.")).toBe(false);
    expect(pinned.test("Pinned to the top of the feed.")).toBe(false);
    expect(pinned.test("Pinned to the top.")).toBe(false);
    expect(pinned.test("The pinned tab stays open.")).toBe(false);
  });
});
