/**
 * data/wisdom/maxims/*.json · one plain, practical maxim per curated wisdom
 * entry, for the bdnick.info Home rotation. Nour 2026-10-29: "I want the maxim
 * simpler so I can understand better and more practical for real world. but
 * all 5" (Greene, Gracián, Naval, Munger, Bezos). Home reads these files; they
 * are not ingested into the brain (the pack loader reads only *.json directly
 * under data/wisdom/, so maxims/ keeps them out of it).
 *
 * Every line: at most 16 words, Flesch-Kincaid grade 8 or lower, no colons,
 * semicolons, dashes or exclamation marks, 1-3 tags from a fixed list, and our
 * own words (no 8-word run shared with the source text). Greene's books are
 * copyrighted; only the idea is used.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ALL_GREENE_ENTRIES, GREENE_CORPUS_COUNTS } from "@/lib/brain/greene-corpus";

type Maxim = { text: string; source: string; ref: string; tags: string[] };
const DIR = resolve(__dirname, "../../data/wisdom");
const load = (name: string) =>
  (JSON.parse(readFileSync(resolve(DIR, "maxims", `${name}-maxims.json`), "utf8")) as { entries: Maxim[] }).entries;

const TAGS = ["customers", "people", "money", "timing", "focus", "conflict", "hiring", "reputation", "learning", "decisions", "health"];
const BANNED = [/;/, /:/, /—/, /–/, /!/, /\bthus\b/i, /\bhence\b/i, /\bone must\b/i, /\bshall\b/i, /\bought\b/i, /\bwhilst\b/i, /\btherefore\b/i];

const words = (s: string) => s.replace(/[^A-Za-z0-9' -]/g, " ").split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w));
function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length <= 3) return 1;
  const groups = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "").match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}
/** Flesch-Kincaid grade level, with a simple vowel-group syllable count. */
function grade(s: string): number {
  const w = words(s);
  const sentences = Math.max(1, (s.match(/[.?]+(\s|$)/g) ?? []).length);
  const syl = w.reduce((n, x) => n + syllables(x), 0);
  return 0.39 * (w.length / sentences) + 11.8 * (syl / w.length) - 15.59;
}
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);
function shingles(s: string, n = 8): Set<string> {
  const w = norm(s);
  const out = new Set<string>();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(" "));
  return out;
}

const GREENE_LABEL: Record<string, string> = {
  "48LP": "Greene · 48 Laws",
  "33SW": "Greene · 33 Strategies",
  Seduction: "Greene · Seduction",
  HN: "Greene · Human Nature",
  Mastery: "Greene · Mastery",
  "50L": "Greene · 50th Law",
};
const PACKS = [
  { name: "gracian", pack: "baltasar-gracian", source: "Gracián" },
  { name: "naval", pack: "naval-ravikant", source: "Naval" },
  { name: "munger", pack: "charlie-munger", source: "Munger" },
  { name: "bezos", pack: "bezos-letters", source: "Bezos" },
];
const packText = (pack: string) =>
  (JSON.parse(readFileSync(resolve(DIR, `${pack}.json`), "utf8")) as { entries: { text: string }[] }).entries;

/** ref -> the source text a maxim must not copy from. */
const SOURCE_TEXT = new Map<string, string>([
  ...ALL_GREENE_ENTRIES.map((e) => [e.key, `${e.summary ?? ""} ${e.fullText ?? ""}`] as [string, string]),
  ...PACKS.flatMap((p) => packText(p.pack).map((e, i) => [`wisdom_${p.pack}_${String(i).padStart(3, "0")}`, e.text] as [string, string])),
]);
const copiedRun = (m: Maxim) => {
  const src = shingles(SOURCE_TEXT.get(m.ref) ?? "");
  for (const s of shingles(m.text)) if (src.has(s)) return s;
  return null;
};

const ALL: Array<[string, Maxim[]]> = [["greene", load("greene")], ...PACKS.map((p) => [p.name, load(p.name)] as [string, Maxim[]])];

describe("POSITIVE CONTROLS: the style checks catch what they claim to", () => {
  it("a hard sentence fails the grade check, a target line passes", () => {
    expect(grade("Organizational effectiveness necessitates comprehensive institutionalization of accountability.")).toBeGreaterThan(8);
    expect(grade("When you are angry, wait. Decide after it passes.")).toBeLessThanOrEqual(8);
  });
  it("the copy guard flags a line lifted from its source", () => {
    const ref = "wisdom_naval-ravikant_000";
    expect(copiedRun({ text: SOURCE_TEXT.get(ref)!, source: "Naval", ref, tags: ["money"] })).not.toBeNull();
  });
  it("the banned list catches a colon, a semicolon and 'one must'", () => {
    for (const bad of ["Law 28: act.", "Act; then wait.", "One must act."]) expect(BANNED.some((b) => b.test(bad)), bad).toBe(true);
  });
});

describe("counts: every curated entry has exactly one maxim", () => {
  it("Greene: one per seed, per book, sourced by book", () => {
    const g = load("greene");
    const byBook = Object.fromEntries(Object.entries(GREENE_CORPUS_COUNTS.byBook).map(([b, n]) => [GREENE_LABEL[b], n]));
    const got: Record<string, number> = {};
    for (const m of g) got[m.source] = (got[m.source] ?? 0) + 1;
    expect(got).toEqual(byBook);
    const seedBook = new Map(ALL_GREENE_ENTRIES.map((e) => [e.key, GREENE_LABEL[e.book]]));
    expect(new Set(g.map((m) => m.ref))).toEqual(new Set(seedBook.keys()));
    for (const m of g) expect(m.source, m.ref).toBe(seedBook.get(m.ref));
  });
  it.each(PACKS)("$source: one per pack entry, refs are the pack keys", ({ name, pack, source }) => {
    const m = load(name);
    const keys = packText(pack).map((_, i) => `wisdom_${pack}_${String(i).padStart(3, "0")}`);
    expect(m.map((x) => x.ref)).toEqual(keys);
    for (const x of m) expect(x.source).toBe(source);
  });
});

describe.each(ALL)("%s maxims: plain and practical", (_name, maxims) => {
  it("at most 16 words, at least 4, ends with . or ?", () => {
    const bad = maxims.filter((m) => words(m.text).length > 16 || words(m.text).length < 4 || !/[.?]$/.test(m.text.trim()));
    expect(bad.map((m) => `${m.ref}: ${m.text}`)).toEqual([]);
  });
  it("Flesch-Kincaid grade 8 or lower", () => {
    const bad = maxims.filter((m) => grade(m.text) > 8);
    expect(bad.map((m) => `${m.ref} (${grade(m.text).toFixed(1)}): ${m.text}`)).toEqual([]);
  });
  it("no banned words or punctuation", () => {
    const bad = maxims.filter((m) => BANNED.some((b) => b.test(m.text)));
    expect(bad.map((m) => `${m.ref}: ${m.text}`)).toEqual([]);
  });
  it("1-3 tags, all from the fixed list", () => {
    const bad = maxims.filter((m) => m.tags.length < 1 || m.tags.length > 3 || m.tags.some((t) => !TAGS.includes(t)));
    expect(bad.map((m) => `${m.ref}: ${m.tags.join(",")}`)).toEqual([]);
  });
  it("our own words: no 8-word run shared with the source text", () => {
    expect(maxims.map((m) => [m.ref, copiedRun(m)]).filter(([, r]) => r !== null)).toEqual([]);
  });
  it("the copy guard had source text for nearly every maxim (no silent instrument)", () => {
    // A few Greene seeds (e.g. a mentorship role) have a summary under 8 words; nothing to copy there.
    const covered = maxims.filter((m) => shingles(SOURCE_TEXT.get(m.ref) ?? "").size > 0).length;
    expect(covered / maxims.length).toBeGreaterThan(0.9);
  });
});
