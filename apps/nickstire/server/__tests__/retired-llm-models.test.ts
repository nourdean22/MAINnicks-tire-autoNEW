import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Guard against RETIRED LLM model IDs pinned in code (audit follow-up,
 * 2026-07-16): reel brief generation was dead in prod because two defaults
 * still said "gemini-1.5-pro" — Google 404s it ("not found for API version").
 * statenour hit the same class with gemini-2.0-flash (#544). Model names in
 * comments are fine; QUOTED literals are what ship.
 */
const RETIRED = /["'`]gemini-(1\.[05]|2\.0)[a-z0-9.-]*["'`]/;

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (entry.name.endsWith(".ts") && !entry.name.includes(".test.")) yield p;
  }
}

describe("retired LLM model IDs", () => {
  it("no server source pins a retired Gemini model in a string literal", () => {
    const offenders: string[] = [];
    for (const file of walk(SERVER_DIR)) {
      const src = fs.readFileSync(file, "utf8");
      const m = src.match(RETIRED);
      if (m) offenders.push(`${path.relative(SERVER_DIR, file)} → ${m[0]}`);
    }
    expect(offenders, `Retired Gemini models pinned in code (Google 404s these):\n${offenders.join("\n")}`).toEqual([]);
  });
});
