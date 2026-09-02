/**
 * tests/ai/tool-mutation-single-source.test.ts
 * 2026-09-02 self-audit of the same day's C-5 fix.
 *
 * "Does this tool mutate?" used to be answered in TWO places:
 *
 *   · lib/ai/tools/catalog.ts  — consulted by classifyTool(), and therefore
 *                                by read-mode stripping. This one is SAFETY.
 *   · lib/ai/tool-families.ts  — a hand-maintained `mutates` field feeding
 *                                /system/tools' mutatingCount. This one is
 *                                what the operator is TOLD.
 *
 * Nothing asserted they agreed, and they had drifted on 22 of ~181 tools in
 * both directions: `proposeCalendarEvent` sat in tool-families as
 * `mutates: false` on a line whose own description said it "writes the event
 * direc[tly]", while `endOfDay` and `weeklyReview` were flagged as mutating
 * and write nothing. Neither registry was reliably right, which is where a
 * duplicated fact always ends up.
 *
 * The first attempt at fixing this was an agreement test — assert the two
 * copies match. That was the wrong shape: it institutionalises the
 * duplication and asks a gate to hold two hand-edited lists in sync forever.
 * The field is DELETED instead, and /system/tools derives the value from the
 * same classifier read mode uses. This test guards that deletion: the cheap,
 * plausible regression is someone re-adding `mutates` to a registry entry
 * "for the display", which would silently restore the second source.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TOOL_FAMILIES } from "@/lib/ai/tool-families";
import { TOOL_CATALOG } from "@/lib/ai/tools/catalog";
import { classifyTool } from "@/lib/ai/capability-registry";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel: string) => readFileSync(resolve(APP_ROOT, rel), "utf8");

describe("tool mutation status has exactly one source", () => {
  it("no tool-families entry carries its own mutation verdict", () => {
    // Structural, because the field is gone from the TYPE too: a re-added
    // `mutates:` would be a TS error today, and this catches the case where
    // someone re-adds it to the interface as well.
    const offenders = Object.entries(TOOL_FAMILIES as Record<string, Record<string, unknown>>)
      .filter(([, meta]) => "mutates" in meta)
      .map(([name]) => name);
    expect(
      offenders,
      "tool-families entries must not re-declare mutation status — " +
        "lib/ai/tools/catalog.ts is the single source, read via classifyTool()",
    ).toEqual([]);
  });

  it("the operator-facing surface derives mutation from the safety classifier", () => {
    // The subject is the CONSUMER, not the registry: the defect was that
    // /system/tools reported a number nobody had reconciled with the gate
    // that actually strips tools. Reading the source is deliberate — the
    // alternative is booting the whole system-pages service with a database.
    const src = read("lib/services/system-pages-b.ts");
    expect(src, "system-pages-b must import the classifier").toContain(
      'from "@/lib/ai/capability-registry"',
    );
    expect(src, "mutates must be derived, not read from a second registry").toContain(
      "mutates: !classifyTool(name).readSafe",
    );
    // Matched as an ASSIGNMENT at the start of a line, not as a substring.
    // The first version of this assertion used `.not.toContain("meta?.mutates")`
    // and failed against the explanatory comment directly above the fix, which
    // quotes the old code — a source-text assertion tripping over prose is the
    // brittleness this repo warns about, caught here by its own test.
    const codeLines = src
      .split("\n")
      .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"));
    expect(
      codeLines.filter((l) => /^\s*mutates:\s*meta\?\.mutates/.test(l)),
      "the old hand-maintained read must be gone from the code",
    ).toEqual([]);
  });

  it("positive control · the classifier separates tools, it does not answer a constant", () => {
    // A classifier stuck on one verdict would make the derivation useless
    // while every assertion above still passed.
    const verdicts = new Set(TOOL_CATALOG.map((m) => classifyTool(m.name).readSafe));
    expect(verdicts).toEqual(new Set([true, false]));
    expect(TOOL_CATALOG.length).toBeGreaterThan(100);
  });

  it("the two tools this audit found writing to the brain are classified as writers", () => {
    // buildArchitectureMemory and learnCodingPreference both call
    // brainMemory.remember() (lib/ai/tools/brain.ts) yet sat in category
    // "files" with no mutating name prefix — the same three-tripwire miss as
    // proposeCalendarEvent, surfaced only once the two registries were
    // compared. Pinned here so a catalog edit cannot quietly undo it.
    for (const name of ["buildArchitectureMemory", "learnCodingPreference", "proposeCalendarEvent"]) {
      expect(classifyTool(name).readSafe, `${name} writes; read mode must strip it`).toBe(false);
    }
  });
});
