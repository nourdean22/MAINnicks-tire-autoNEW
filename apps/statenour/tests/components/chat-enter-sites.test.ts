/**
 * tests/components/chat-enter-sites.test.ts · task P2-B6 item 6.
 *
 * The chat inputs outside features/chat-v2 that send to Nick on plain Enter
 * hand-rolled `key === "Enter"`, so an IME confirm (Japanese, Chinese,
 * Korean input; Safari reports it as keyCode 229) sent a half-typed message.
 * Each must go through the shared isSubmitEnter(). features/chat-v2 itself is
 * pinned by tests/features/chat-v2/enter-sites-contract.test.ts.
 *
 * Reviewed and left alone (not a plain-Enter send to Nick): ultron/today/
 * active-task-companion.tsx and brain-dump-modal.tsx (Cmd/Ctrl+Enter only;
 * operator/nick-reasoner.tsx was the third until the Brain Reason tab was cut
 * 2026-10-19 and the file deleted). journal/thread-rail.tsx
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

  // The control proves the scan can see a raw check at all. Its target is a live file that still has one
  // (Cmd/Ctrl+Enter capture); the negative half proves the same scan is quiet on a file that lacks one, so
  // a scan that matched everything (or nothing) cannot pass both.
  it("CONTROL: the scan sees a raw check where one exists", () => {
    expect(code("components/brain-dump-modal.tsx")).toMatch(/\.key\s*===\s*["']Enter["']/);
  });

  it("CONTROL: and the same scan finds none in a file that has none", () => {
    expect(code(CHAT_SITES[0])).not.toMatch(/\.key\s*===\s*["']Enter["']/);
  });

  it("CONTROL: the shared rule refuses an IME confirm and still sends a plain Enter", () => {
    expect(isSubmitEnter({ key: "Enter", shiftKey: false, keyCode: 229 })).toBe(false);
    expect(isSubmitEnter({ key: "Enter", shiftKey: false, nativeEvent: { isComposing: true } })).toBe(false);
    expect(isSubmitEnter({ key: "Enter", shiftKey: false })).toBe(true);
  });
});
