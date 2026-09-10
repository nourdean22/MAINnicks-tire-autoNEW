/**
 * Sanitize-history fabrication-neutralization tests · v10.0.163
 *
 * Verifies the L3 anti-fabrication defense: when a prior assistant
 * turn was rewritten by the verifier (banner with VERIFIER_MARKER
 * prefix), the history loader REPLACES the text so the model can't
 * compound the lie next turn.
 *
 * 2026-09-10 · these assertions used to pin the literal string
 * "[VERIFIER NOTE: my previous response was flagged as fabricated...]".
 * That note was written in the FIRST PERSON and handed to the model as
 * its own prior assistant turn -- so the model had a ready-made sentence
 * in its own voice saying "disregard my previous response", and
 * reproduced that register in the next reply. That is how a raw system
 * trace ended up printed mid-conversation in NICK's voice, explaining
 * itself to itself.
 *
 * The note is now third-person metadata about a REMOVED turn. These
 * tests assert the BEHAVIOUR that matters -- the turn is neutralized,
 * the fabricated content does not survive, and there is no first-person
 * sentence available to parrot -- rather than the exact wording, which
 * is what made them break on a correct fix.
 */

import { describe, it, expect } from "vitest";
import { sanitizeMessageHistory } from "@/lib/ai/chat/sanitize-history";
import { rewriteForFabrication } from "@/lib/ai/chat/fabrication-rewriter";
import type { ActionClaim } from "@/lib/ai/chat/action-claim-detector";

const claim = (over: Partial<ActionClaim> = {}): ActionClaim => ({
  verb: "added/created task",
  snippet: "added the suggested tasks",
  expectedTool: "createTask",
  ...over,
});

interface Msg {
  role: "user" | "assistant";
  parts: Array<{ type: "text"; text: string }>;
}

describe("sanitizeMessageHistory · fabrication neutralization", () => {
  it("replaces verifier-marked assistant turn with a neutralization note", () => {
    const fabricated = rewriteForFabrication(
      "Yes, added the suggested tasks to Bay 5 Revive.",
      [claim()],
    ).text;
    const msgs: Msg[] = [
      { role: "user", parts: [{ type: "text", text: "did u add the tasks?" }] },
      { role: "assistant", parts: [{ type: "text", text: fabricated }] },
      { role: "user", parts: [{ type: "text", text: "show me the tasks then" }] },
    ];
    const out = sanitizeMessageHistory(msgs);
    const assistantText = out[1].parts[0].text;
    // Neutralized, and unmistakably system metadata rather than speech.
    expect(assistantText).toMatch(/removed by system/i);
    expect(assistantText).toMatch(/must not be referenced/i);
    // Original fabricated content should NOT survive into history
    expect(assistantText).not.toMatch(/added the suggested tasks/);
    // And nothing the model can copy as its own voice.
    expect(assistantText).not.toMatch(/my previous response/i);
    expect(assistantText).not.toMatch(/^\s*I/m);
  });

  it("leaves untouched assistant text alone", () => {
    const msgs: Msg[] = [
      { role: "user", parts: [{ type: "text", text: "hi" }] },
      { role: "assistant", parts: [{ type: "text", text: "Hello, what can I help with?" }] },
      { role: "user", parts: [{ type: "text", text: "what's next" }] },
    ];
    const out = sanitizeMessageHistory(msgs);
    expect(out[1].parts[0].text).toBe("Hello, what can I help with?");
  });

  it("does NOT touch the most recent user message", () => {
    const msgs: Msg[] = [
      { role: "user", parts: [{ type: "text", text: "hi" }] },
      { role: "user", parts: [{ type: "text", text: "newest user prompt" }] },
    ];
    const out = sanitizeMessageHistory(msgs);
    expect(out[1].parts[0].text).toBe("newest user prompt");
  });

  it("neutralizes verifier-marked turn even if buried mid-history", () => {
    const fabricated = rewriteForFabrication("Sent the email.", [
      claim({ verb: "sent/emailed/messaged", expectedTool: "sendEmail" }),
    ]).text;
    const msgs: Msg[] = [
      { role: "user", parts: [{ type: "text", text: "u still there?" }] },
      { role: "assistant", parts: [{ type: "text", text: fabricated }] },
      { role: "user", parts: [{ type: "text", text: "ok cool" }] },
      { role: "assistant", parts: [{ type: "text", text: "yep, all set" }] },
      { role: "user", parts: [{ type: "text", text: "and now this" }] },
    ];
    const out = sanitizeMessageHistory(msgs);
    expect(out[1].parts[0].text).toMatch(/removed by system/i);
    // The OTHER assistant turn (clean one) should be untouched
    expect(out[3].parts[0].text).toBe("yep, all set");
  });

  it("idempotent — re-running sanitization on already-neutralized history is a no-op", () => {
    const fabricated = rewriteForFabrication("Saved that to brain.", [
      claim({ verb: "saved to brain", expectedTool: "saveToBrain" }),
    ]).text;
    const msgs: Msg[] = [
      { role: "user", parts: [{ type: "text", text: "remember X" }] },
      { role: "assistant", parts: [{ type: "text", text: fabricated }] },
      { role: "user", parts: [{ type: "text", text: "next" }] },
    ];
    const once = sanitizeMessageHistory(msgs);
    const firstNeutralized = once[1].parts[0].text;
    const twice = sanitizeMessageHistory(once);
    expect(twice[1].parts[0].text).toBe(firstNeutralized);
  });
});
