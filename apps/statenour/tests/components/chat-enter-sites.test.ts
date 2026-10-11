/**
 * tests/components/chat-enter-sites.test.ts · task P2-B6 item 6.
 *
 * The chat inputs outside features/chat-v2 that send to Nick on plain Enter
 * hand-rolled `key === "Enter"`, so an IME confirm (Japanese, Chinese,
 * Korean input; Safari reports it as keyCode 229) sent a half-typed message.
 * Each must go through the shared isSubmitEnter(). features/chat-v2 itself is
 * pinned by tests/features/chat-v2/enter-sites-contract.test.ts.
 *
 * Reviewed and left alone (not a plain-Enter send to Nick): operator/
 * nick-reasoner.tsx and ultron/today/active-task-companion.tsx (Cmd/Ctrl+Enter
 * only), brain-dump-modal.tsx (Cmd/Ctrl+Enter capture). journal/thread-rail.tsx
 * (thread name) and missions/mission-card.tsx (add task) are not sends to Nick
 * either, but R3-06 moved both onto isSubmitEnter() too.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isSubmitEnter } from "@/features/chat-v2/lib/submit-enter";

const ROOT = join(__dirname, "../..");
const CHAT_SITES = ["components/home/nick-command-line.tsx", "components/ai/page-nick.tsx"];

/** Code only: a comment that mentions the old check is not a site. */
const code = (file: string) =>
  readFileSync(join(ROOT, file), "utf8")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line))
    .join("\n");

describe("chat Enter sites outside chat-v2", () => {
  it.each(CHAT_SITES)("%s sends through isSubmitEnter(), with no raw Enter check", (file) => {
    const src = code(file);
    expect(src).toContain("isSubmitEnter(");
    expect(src).not.toMatch(/\.key\s*===\s*["']Enter["']/);
  });

  it("CONTROL: the scan sees a raw check where one exists", () => {
    expect(code("components/operator/nick-reasoner.tsx")).toMatch(/\.key\s*===\s*["']Enter["']/);
  });

  it("CONTROL: the shared rule refuses an IME confirm and still sends a plain Enter", () => {
    expect(isSubmitEnter({ key: "Enter", shiftKey: false, keyCode: 229 })).toBe(false);
    expect(isSubmitEnter({ key: "Enter", shiftKey: false, nativeEvent: { isComposing: true } })).toBe(false);
    expect(isSubmitEnter({ key: "Enter", shiftKey: false })).toBe(true);
  });
});
