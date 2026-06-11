import { describe, it, expect } from "vitest";
import { parseDirectiveLines } from "@/lib/services/journal-directive";

const CANONICAL = [
  "COMPOUNDING: Shop scaling thread is compounding — 11 entries, 4 this week.",
  "STALLED: Health discipline thread silent 18 days.",
  "WATCH: Drift 6.2/10 — late-night captures replacing morning reflections.",
  "MOVE: Answer today's prompt in the health thread before noon.",
].join("\n");

describe("parseDirectiveLines", () => {
  it("parses the canonical 4-line directive in order", () => {
    const lines = parseDirectiveLines(CANONICAL);
    expect(lines).not.toBeNull();
    expect(lines!.map((l) => l.label)).toEqual([
      "COMPOUNDING",
      "STALLED",
      "WATCH",
      "MOVE",
    ]);
    expect(lines![3].text).toBe(
      "Answer today's prompt in the health thread before noon.",
    );
  });

  it("tolerates CRLF, blank lines, and surrounding whitespace", () => {
    const messy = `\r\n  COMPOUNDING: a\r\n\r\n  MOVE: b  \r\n`;
    const lines = parseDirectiveLines(messy);
    expect(lines).toEqual([
      { label: "COMPOUNDING", text: "a" },
      { label: "MOVE", text: "b" },
    ]);
  });

  it("keeps the first occurrence when a label repeats", () => {
    const dup = "MOVE: first\nMOVE: second\nWATCH: w";
    const lines = parseDirectiveLines(dup);
    expect(lines).toEqual([
      { label: "MOVE", text: "first" },
      { label: "WATCH", text: "w" },
    ]);
  });

  it("ignores unknown uppercase labels", () => {
    const extra = "VIBES: great\nCOMPOUNDING: a\nMOVE: b";
    expect(parseDirectiveLines(extra)).toEqual([
      { label: "COMPOUNDING", text: "a" },
      { label: "MOVE", text: "b" },
    ]);
  });

  it("returns null for prose with no labels (raw fallback)", () => {
    expect(
      parseDirectiveLines(
        "You wrote 6 entries this week. The health thread has been quiet.",
      ),
    ).toBeNull();
  });

  it("returns null when fewer than two labels match", () => {
    expect(parseDirectiveLines("MOVE: only one line")).toBeNull();
  });

  it("returns null for empty, null, and undefined", () => {
    expect(parseDirectiveLines("")).toBeNull();
    expect(parseDirectiveLines(null)).toBeNull();
    expect(parseDirectiveLines(undefined)).toBeNull();
  });

  it("skips a label with empty text", () => {
    // "STALLED:" with nothing after it carries no information — only the
    // two real lines survive.
    const lines = parseDirectiveLines("STALLED:\nCOMPOUNDING: a\nMOVE: b");
    expect(lines).toEqual([
      { label: "COMPOUNDING", text: "a" },
      { label: "MOVE", text: "b" },
    ]);
  });

  it("does not match lowercase labels (contract is uppercase)", () => {
    expect(parseDirectiveLines("move: a\nwatch: b")).toBeNull();
  });
});
