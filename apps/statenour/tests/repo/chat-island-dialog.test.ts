/**
 * tests/repo/chat-island-dialog.test.ts - audit 09-F4, task R3-05.
 *
 * The conversation-history drawer was a plain div over the chat: no dialog
 * role, focus never moved in, was never trapped and never came back, and a
 * document-level Escape listener stood in for the dialog contract. It now uses
 * the Base UI Dialog primitive (nick-side-pane.tsx is the in-repo pattern).
 * Source scan on purpose: rendering chat-island needs the whole streaming stack.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const island = readFileSync(join(__dirname, "../../features/chat-v2/components/chat-island.tsx"), "utf8");

describe("chat-island history drawer is a real dialog", () => {
  it("uses the Dialog primitive", () => {
    expect(island).toContain('from "@/components/ui/dialog"');
    expect(island).toContain("<DialogContent");
  });

  it("returns focus to the control that opened it", () => {
    expect(island).toContain("finalFocus={historyButtonRef}");
    expect(island).toMatch(/ref=\{historyButtonRef\}/);
  });

  it("is named for screen readers", () => {
    expect(island).toMatch(/<DialogContent[\s\S]*?aria-label="Conversation history"/);
  });

  it("no hand-rolled Escape listener (the Dialog owns Escape)", () => {
    expect(island).not.toMatch(/event\.key === ["']Escape["']/);
  });
});
