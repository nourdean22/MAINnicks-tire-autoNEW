/**
 * tests/features/chat-v2/enter-sites-contract.test.ts · audit 09-F9 (task B6).
 *
 * "One shared isSubmitEnter() at every Enter site": a hand-rolled
 * `key === "Enter"` check is how the IME guard went missing in the first
 * place. Scans the chat surface (features/chat-v2) for a raw Enter check.
 * Sites outside chat-v2 (nick-command-line, page-nick, thread-rail,
 * mission-card, ...) belong to other tasks and are listed in the B6 report.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "../../../features/chat-v2");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("chat-v2 Enter sites", () => {
  it("the scan sees the composer (positive control)", () => {
    const composer = sources(ROOT).find((f) => f.endsWith("chat-composer.tsx"));
    expect(composer).toBeDefined();
    expect(readFileSync(composer!, "utf8")).toContain("isSubmitEnter(");
  });

  it("no raw Enter check is left: every site goes through isSubmitEnter()", () => {
    const offenders = sources(ROOT)
      .filter((f) => /\.key\s*===\s*["']Enter["']/.test(readFileSync(f, "utf8")))
      .map((f) => relative(ROOT, f));
    expect(offenders).toEqual([]);
  });
});
