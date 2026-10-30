/**
 * data/wisdom/maxims/greene-maxims.json · Robert Greene's six books as one-line maxims
 * for the bdnick.info Home rotation (Nour 2026-10-29: "for the green books turn
 * them into maxims for the rotation on the homepage"). Read by Home from the
 * file; not ingested into the brain. It lives in maxims/ on purpose: the pack
 * loader ingests every *.json directly under data/wisdom/.
 *
 * Copyright: every line is our own wording. Only law and strategy titles may be
 * named. The copy guard below fails if a maxim shares an 8-word run with the
 * seed's own summary or full text (lib/brain/greene/*).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ALL_GREENE_ENTRIES, GREENE_CORPUS_COUNTS } from "@/lib/brain/greene-corpus";

type Entry = { text: string; book: string; ref: string };
const pack = JSON.parse(
  readFileSync(resolve(__dirname, "../../data/wisdom/maxims/greene-maxims.json"), "utf8"),
) as { pack: string; source_credit: string; entries: Entry[] };

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);
function shingles(s: string, n = 8): Set<string> {
  const w = words(s);
  const out = new Set<string>();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(" "));
  return out;
}
const seedText = new Map(ALL_GREENE_ENTRIES.map((e) => [e.key, `${e.summary ?? ""} ${e.fullText ?? ""}`]));
function copiedRun(entry: Entry): string | null {
  const src = shingles(seedText.get(entry.ref) ?? "");
  for (const s of shingles(entry.text)) if (src.has(s)) return s;
  return null;
}

describe("greene-maxims pack", () => {
  it("is the greene-maxims pack and credits all six books", () => {
    expect(pack.pack).toBe("greene-maxims");
    for (const book of ["48 Laws of Power", "33 Strategies of War", "Art of Seduction", "Laws of Human Nature", "Mastery", "50th Law"]) {
      expect(pack.source_credit).toContain(book);
    }
  });

  it("has one maxim per seed entry, per book (counts match lib/brain/greene)", () => {
    const byBook: Record<string, number> = {};
    for (const e of pack.entries) byBook[e.book] = (byBook[e.book] ?? 0) + 1;
    expect(byBook).toEqual(GREENE_CORPUS_COUNTS.byBook);
    expect(pack.entries).toHaveLength(GREENE_CORPUS_COUNTS.total);
  });

  it("every ref is a real seed key, used once, with the seed's own book", () => {
    const seeds = new Map(ALL_GREENE_ENTRIES.map((e) => [e.key, e.book]));
    const refs = pack.entries.map((e) => e.ref);
    expect(new Set(refs).size).toBe(refs.length);
    for (const e of pack.entries) expect(seeds.get(e.ref), e.ref).toBe(e.book);
  });

  it("one line each, house style: no em or en dashes, no exclamation marks, under 160 chars", () => {
    for (const e of pack.entries) {
      expect(e.text, e.ref).not.toMatch(/[–—!\n]/);
      expect(e.text.length, e.ref).toBeLessThanOrEqual(160);
      expect(e.text.length, e.ref).toBeGreaterThanOrEqual(30);
    }
  });

  it("POSITIVE CONTROL: the copy guard flags a line lifted from the seed text", () => {
    const seed = ALL_GREENE_ENTRIES.find((e) => (e.summary ?? "").split(/\s+/).length >= 10)!;
    const lifted = { text: seed.summary!, book: seed.book, ref: seed.key };
    expect(copiedRun(lifted)).not.toBeNull();
  });

  it("the copy guard had seed text to compare for nearly every maxim (no silent instrument)", () => {
    const covered = pack.entries.filter((e) => shingles(seedText.get(e.ref) ?? "").size > 0).length;
    expect(covered / pack.entries.length).toBeGreaterThan(0.9);
  });

  it("no maxim shares an 8-word run with its seed's summary or full text", () => {
    const copied = pack.entries.map((e) => [e.ref, copiedRun(e)]).filter(([, run]) => run !== null);
    expect(copied).toEqual([]);
  });
});
