/**
 * Every curated wisdom pack in data/wisdom/ is ingestible as written, and the
 * Gracián pack (job 2026-10-29) covers all 300 maxims of the Oráculo manual.
 *
 * `scripts/ingest-wisdom-pack.ts` SKIPS an entry silently (text under 20
 * chars, confidence under 0.5) and stores `topic` unchecked, so a pack can
 * lose rows or carry a topic the recall boost never matches without anything
 * going red. This file is that check. The positive control proves the
 * validator sees a broken entry, so a green here is not a validator that
 * passes everything.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { WisdomTopic } from "@/lib/brain/wisdom-topic-tagger";

const WISDOM_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../data/wisdom");
const TOPICS: readonly WisdomTopic[] = ["money", "people", "strategy", "execution", "ops", "brand", "self", "body", "time", "power"];

type Entry = { text?: unknown; topic?: unknown; confidence?: unknown; context?: unknown; tags?: unknown };
type Pack = { pack?: unknown; source_credit?: unknown; entries?: Entry[] };

/** Problems that would make the ingest skip or mis-store an entry. Empty = ingestible. */
function packProblems(file: string, pack: Pack): string[] {
  const out: string[] = [];
  if (pack.pack !== file.replace(/\.json$/, "")) out.push(`pack slug ${String(pack.pack)} != file name`);
  if (typeof pack.source_credit !== "string" || pack.source_credit.length < 20) out.push("no source_credit");
  if (!Array.isArray(pack.entries) || pack.entries.length === 0) return [...out, "no entries"];
  pack.entries.forEach((e, i) => {
    if (typeof e.text !== "string" || e.text.length < 20) out.push(`#${i} text missing or under 20 chars`);
    if (typeof e.confidence !== "number" || e.confidence < 0.5 || e.confidence > 1) out.push(`#${i} confidence outside 0.5..1`);
    if (!TOPICS.includes(e.topic as WisdomTopic)) out.push(`#${i} topic ${String(e.topic)}`);
    if (e.tags !== undefined && !(Array.isArray(e.tags) && e.tags.every((t) => typeof t === "string"))) out.push(`#${i} tags`);
  });
  return out;
}

const files = readdirSync(WISDOM_DIR).filter((f) => f.endsWith(".json"));
const load = (f: string) => JSON.parse(readFileSync(join(WISDOM_DIR, f), "utf8")) as Pack;

describe("data/wisdom packs are ingestible as written", () => {
  it("positive control: the validator flags a skipped-on-ingest entry and an unknown topic", () => {
    const broken: Pack = {
      pack: "x",
      source_credit: "a source credit long enough",
      entries: [{ text: "a sufficiently long wisdom text", topic: "vibes", confidence: 0.3 }],
    };
    expect(packProblems("x.json", broken)).toEqual(["#0 confidence outside 0.5..1", "#0 topic vibes"]);
  });

  it("finds the packs (a scan over nothing would pass)", () => {
    expect(files).toEqual(expect.arrayContaining(["naval-ravikant.json", "charlie-munger.json", "bezos-letters.json", "baltasar-gracian.json"]));
  });

  it.each(files)("%s: every entry would be upserted, none silently skipped", (f) => {
    expect(packProblems(f, load(f))).toEqual([]);
  });
});

describe("baltasar-gracian pack · all 300 maxims, our distillation", () => {
  const pack = load("baltasar-gracian.json");
  const entries = pack.entries ?? [];

  it("has one entry per maxim, 1..300 in order (ingest keys wisdom_baltasar-gracian_000..299 follow the maxim)", () => {
    expect(entries).toHaveLength(300);
    const numbers = entries.map((e) => Number(/maxim (\d+) '/.exec(String(e.context))?.[1]));
    expect(numbers).toEqual(Array.from({ length: 300 }, (_, i) => i + 1));
  });

  it("credits the public-domain Jacobs translation and says the text is ours", () => {
    expect(pack.source_credit).toMatch(/Jacobs/);
    expect(pack.source_credit).toMatch(/public domain/);
    for (const e of entries) expect(String(e.context)).toMatch(/Jacobs 1892 translation \(public domain\) · distillation and application ours, not a quotation$/);
  });

  it("every entry reads TL;DR (the maxim) -> key points -> the application for Nour, and no two are the same", () => {
    entries.forEach((e, i) =>
      expect(String(e.text)).toMatch(new RegExp(String.raw`^TL;DR: .+ \(maxim ${i + 1}\)\. Key points: .+ For Nour: .+`)),
    );
    expect(new Set(entries.map((e) => e.text)).size).toBe(300);
  });

  it("house style: no em or en dashes, no exclamation marks, never 'financing'", () => {
    for (const e of entries) expect(String(e.text)).not.toMatch(/[–—!]|financ/i);
  });
});
