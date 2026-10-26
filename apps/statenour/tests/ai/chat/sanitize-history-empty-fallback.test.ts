/**
 * 2026-10-26 · the empty-response fallback is system copy, not something the
 * assistant said. Live: two fallback rows sat in the history as assistant turns
 * and the next reply continued them ("The action did go through ...") and
 * echoed the duplicate warning back. History must carry a neutral note instead.
 */
import { describe, it, expect } from "vitest";
import { sanitizeMessageHistory } from "@/lib/ai/chat/sanitize-history";
import { emptyResponseFallback } from "@/lib/ai/chat/empty-response-fallback";

const user = (text: string) => ({ role: "user", parts: [{ type: "text", text }] });
const assistant = (text: string) => ({ role: "assistant", parts: [{ type: "text", text }] });
const assistantText = (m: { parts?: Array<{ text?: string }> }) => (m.parts ?? []).map((p) => p.text ?? "").join("");

describe("fallback rows never reach the model as assistant text", () => {
  for (const finish of ["tool-calls", "length", "content-filter"]) {
    it(`the '${finish}' fallback copy is replaced by a neutral note`, () => {
      const copy = emptyResponseFallback(finish);
      const out = sanitizeMessageHistory([user("synthetic ask"), assistant(copy), user("synthetic follow-up")]);

      const text = assistantText(out[1]!);
      expect(text).not.toContain(copy);
      expect(text).not.toMatch(/duplicate|re-send|went through/i);
      expect(text).toMatch(/^\[removed by system:/);
    });
  }

  it("CONTROL · a real assistant reply that merely quotes part of the copy is left alone", () => {
    const real = "Here is the plan. Check whether it actually went through before you re-send, then we continue.";
    const out = sanitizeMessageHistory([user("synthetic ask"), assistant(real), user("next")]);
    expect(assistantText(out[1]!)).toBe(real);
  });

  it("CONTROL · the live last message is never rewritten", () => {
    const copy = emptyResponseFallback("tool-calls");
    const msgs = [user("a"), assistant(copy)];
    expect(sanitizeMessageHistory(msgs)[1]).toBe(msgs[1]);
  });
});
