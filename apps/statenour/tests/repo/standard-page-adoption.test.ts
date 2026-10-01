/**
 * Canonical mastery page shell gate · 2026-10-01 UI convergence.
 *
 * Every real mastery page uses StandardPage unless the page is an explicit,
 * architecture-level exception. This prevents the old failure mode where
 * independently-authored pages drift in header grammar, width, rhythm,
 * loading/error presentation, and parent navigation.
 *
 * Exceptions are intentionally tiny:
 * - / delegates its entire surface to HomeConsole (the command surface).
 * - /chat is a fixed viewport application canvas whose safe-area/spine
 *   geometry deliberately escapes the normal feed/page shell.
 * - /goals and /scoreboard are compatibility redirect stubs.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const MASTERY_ROOT = resolve(APP_ROOT, "app/(mastery)");

const EXCEPTIONS: Record<string, string> = {
  "app/(mastery)/page.tsx":
    "Home delegates to HomeConsole, which owns the command-surface composition.",
  "app/(mastery)/chat/page.tsx":
    "Chat is a fixed viewport application canvas with explicit safe-area and desktop-spine geometry.",
  "app/(mastery)/goals/page.tsx":
    "Compatibility redirect stub to /stats?tab=goals.",
  "app/(mastery)/scoreboard/page.tsx":
    "Compatibility redirect stub to /stats.",
};

function walkPages(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = resolve(dir, name);
    if (statSync(full).isDirectory()) walkPages(full, out);
    else if (name === "page.tsx") out.push(full);
  }
  return out;
}

function rel(path: string): string {
  return relative(APP_ROOT, path).split(/[\\/]/).join("/");
}

describe("mastery pages use the canonical StandardPage shell", () => {
  const pages = walkPages(MASTERY_ROOT).map(rel).sort();

  it("discovers the mastery route tree", () => {
    expect(pages.length).toBeGreaterThanOrEqual(35);
  });

  it("keeps the exception list explicit and valid", () => {
    for (const [path, reason] of Object.entries(EXCEPTIONS)) {
      expect(pages, `exception no longer exists: ${path}`).toContain(path);
      expect(reason.trim().length, `${path} needs a real exception reason`).toBeGreaterThan(20);
    }
  });

  it("all non-exception mastery pages import and render StandardPage", () => {
    const drift = pages
      .filter((path) => !(path in EXCEPTIONS))
      .filter((path) => {
        const source = readFileSync(resolve(APP_ROOT, path), "utf8");
        return !source.includes('from "@/components/layout/standard-page"') ||
          !source.includes("<StandardPage");
      });

    expect(
      drift,
      `mastery pages bypassing StandardPage — converge them or add a narrowly justified exception:\n${drift.join("\n")}`,
    ).toEqual([]);
  });

  it("exceptions do not silently start using StandardPage", () => {
    const stale = Object.keys(EXCEPTIONS).filter((path) => {
      const source = readFileSync(resolve(APP_ROOT, path), "utf8");
      return source.includes("<StandardPage");
    });
    expect(stale, `remove these now-converged pages from EXCEPTIONS:\n${stale.join("\n")}`).toEqual([]);
  });
});
