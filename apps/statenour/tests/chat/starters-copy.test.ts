/**
 * tests/chat/starters-copy.test.ts · 2026-09-08 (program section 5.5 / 5.10)
 *
 * The empty-chat starters are personal-OS prompts, not shop prompts (the shop
 * surface moved to the Nick's Tire admin with /market), and they carry no
 * decorative icon. Source pins, because the copy is the contract.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("chat starters (section 5.10) and the capability badge (5.5)", () => {
  const src = read("features/chat-v2/components/chat-message-list.tsx");
  const commands = src.slice(src.indexOf("const COMMANDS = ["), src.indexOf("];", src.indexOf("const COMMANDS = [")));

  it("offers the judgment starter and no shop-flavoured one", () => {
    expect(commands).toMatch(/What needs my judgment/);
    expect(commands).not.toMatch(/revenue leaks|Leads, estimates|shop data/i);
  });

  it("renders no wrench (or any lucide icon) on the starter cards", () => {
    expect(src).not.toMatch(/\bWrench\b/);
  });

  it("the badge names health, never a tool count", () => {
    const label = read("features/chat-v2/lib/capability-label.ts");
    expect(label).not.toMatch(/totalTools} catalog tools/);
    expect(label).toMatch(/"ready"/);
    expect(label).toMatch(/"tools limited"/);
  });
});
