/**
 * Greene corpus · full match-phrase coverage · 2026-07-27.
 *
 * The deterministic path in `greene-message-matcher` scores literal
 * substrings against the operator's message. It was dead for the whole
 * corpus because `triggers` are analyst-facing condition sentences written
 * for the digest cron, not text anyone types. `GREENE_MATCH_PHRASES` gives
 * every entry a real chat-side surface; this file guards that it stays
 * complete and stays usable.
 *
 * Coverage is the load-bearing assertion: a single entry without phrases
 * silently reverts to the dead path and reaches chat only via the vector
 * fallback, which is exactly the failure this work exists to end.
 */

import { describe, expect, it } from "vitest";

import { ALL_GREENE_ENTRIES } from "@/lib/brain/greene-corpus";
import { GREENE_MATCH_PHRASES } from "@/lib/brain/greene/match-phrases";

describe("Greene corpus · match-phrase coverage", () => {
  it("gives every entry a chat-side match surface", () => {
    const missing = ALL_GREENE_ENTRIES.filter((e) => !e.matchPhrases?.length);
    expect(
      missing.map((e) => e.key),
      "entries without matchPhrases fall back to the dead trigger path",
    ).toEqual([]);
  });

  it("has no orphan keys in the phrase map", () => {
    // A typo'd key here is invisible at runtime — the entry just silently
    // keeps no phrases — so it has to fail loudly at test time.
    const keys = new Set(ALL_GREENE_ENTRIES.map((e) => e.key));
    const orphans = Object.keys(GREENE_MATCH_PHRASES).filter((k) => !keys.has(k));
    expect(orphans, "phrase-map keys matching no corpus entry").toEqual([]);
  });

  it("lets an inline matchPhrases win over the map", () => {
    // The nine Book V strategies author phrases next to the entry itself.
    // The merge must not overwrite them from the map.
    const authentic = ALL_GREENE_ENTRIES.find(
      (e) => e.key === "mastery_authentic_voice",
    );
    expect(authentic?.matchPhrases).toContain("sounds like everyone else");
    expect(GREENE_MATCH_PHRASES.mastery_authentic_voice).toBeUndefined();
  });

  it("keeps every phrase matchable", () => {
    for (const e of ALL_GREENE_ENTRIES) {
      for (const p of e.matchPhrases ?? []) {
        // The matcher lowercases the message, never the phrase — an
        // uppercase phrase can never match.
        expect(p, `${e.key}: "${p}" must be lowercase`).toBe(p.toLowerCase());
        expect(p.trim(), `${e.key}: "${p}" has stray padding`).toBe(p);
        // Very short fragments match inside unrelated words and would
        // fire the entry on almost any message.
        expect(p.length, `${e.key}: "${p}" is too short to be diagnostic`).toBeGreaterThan(3);
      }
      const phrases = e.matchPhrases ?? [];
      expect(new Set(phrases).size, `${e.key} has duplicate phrases`).toBe(phrases.length);
    }
  });

  it("bounds how many entries may share one phrase", () => {
    // Overlap is fine — scores do not split, since each entry counts only
    // its own hits. But a phrase claimed by many entries is not diagnostic
    // of any of them and just adds noise to the top-3.
    const owners = new Map<string, string[]>();
    for (const e of ALL_GREENE_ENTRIES) {
      for (const p of e.matchPhrases ?? []) {
        owners.set(p, [...(owners.get(p) ?? []), e.key]);
      }
    }
    const overshared = [...owners.entries()]
      .filter(([, ks]) => ks.length > 2)
      .map(([p, ks]) => `"${p}" → ${ks.join(", ")}`);
    expect(overshared).toEqual([]);
  });

  it("gives most entries enough surface to clear minScore 2", () => {
    // minScore defaults to 2, so an entry with very few phrases is
    // effectively unreachable on the deterministic path. A couple of
    // null-case entries (e.g. mentor_none) legitimately have few.
    const thin = ALL_GREENE_ENTRIES.filter((e) => (e.matchPhrases?.length ?? 0) < 5);
    expect(thin.length, `thin entries: ${thin.map((e) => e.key).join(", ")}`).toBeLessThanOrEqual(1);
  });
});
