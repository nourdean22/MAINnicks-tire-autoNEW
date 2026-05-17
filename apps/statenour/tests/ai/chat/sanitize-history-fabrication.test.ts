/**
 * Sanitize-history fabrication-neutralization tests · v10.0.163
 *
 * Verifies the L3 anti-fabrication defense: when a prior assistant
 * turn was rewritten by the v10.0.162 verifier (banner with
 * VERIFIER_MARKER prefix), the history loader REPLACES the text with
 * an explicit "[VERIFIER NOTE: my previous response was flagged as
 * fabricated]" so the model can't compound the lie next turn.
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
    expect(assistantText).toMatch(/VERIFIER NOTE/);
    expect(assistantText).toMatch(/disregard it/i);
    // Original fabricated content should NOT survive into history
    expect(assistantText).not.toMatch(/added the suggested tasks/);
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
    expect(out[1].parts[0].text).toMatch(/VERIFIER NOTE/);
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
