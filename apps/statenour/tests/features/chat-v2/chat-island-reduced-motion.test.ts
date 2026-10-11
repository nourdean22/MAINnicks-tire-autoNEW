/**
 * tests/features/chat-v2/chat-island-reduced-motion.test.ts · audit 09-F13 (task B6).
 *
 * tests/repo/a11y-chrome-contract.test.ts bans the smooth-scroll literal
 * everywhere except chat-island.tsx, which it leaves to the chat task. The
 * CSS reduced-motion kill switch never reaches a JS scrollIntoView, so the
 * island's auto-follow and jump-to-latest animated for everyone.
 * Source scan on purpose: the same instrument the repo-wide rule uses.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const island = readFileSync(join(__dirname, "../../../features/chat-v2/components/chat-island.tsx"), "utf8");

describe("chat-island scrolls respect prefers-reduced-motion", () => {
  it("has no smooth-scroll literal", () => {
    expect(island).not.toMatch(/behavior:\s*["']smooth["']/);
  });

  it("asks the shared scrollBehavior() helper at both scroll sites", () => {
    expect(island.match(/behavior: scrollBehavior\(\)/g)?.length).toBe(2);
  });
});
