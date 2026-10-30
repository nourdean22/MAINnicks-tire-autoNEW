/**
 * The plain Home maxims (data/wisdom/maxims/*.json, PR 3364): one short, practical line per
 * curated wisdom entry, each tagged from a fixed list (tests/brain/home-maxims.test.ts).
 * Bundled as JSON imports so a standalone build carries them; not ingested into the brain.
 */
import bezos from "@/data/wisdom/maxims/bezos-maxims.json";
import gracian from "@/data/wisdom/maxims/gracian-maxims.json";
import greene from "@/data/wisdom/maxims/greene-maxims.json";
import munger from "@/data/wisdom/maxims/munger-maxims.json";
import naval from "@/data/wisdom/maxims/naval-maxims.json";

export interface Maxim {
  text: string;
  /** Display author, e.g. "Naval" or "Greene · 48 Laws". */
  source: string;
  /** The curated wisdom key this maxim simplifies. */
  ref: string;
  tags: string[];
}

const ALL: Maxim[] = [bezos, gracian, greene, munger, naval].flatMap((p) => p.entries as Maxim[]);

/** Deterministic pick among the maxims carrying `tag`: the same seed gives the same line. */
export function pickMaxim(tag: string, seed: string): Maxim | null {
  const pool = ALL.filter((m) => m.tags.includes(tag));
  if (pool.length === 0) return null;
  let h = 5381;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) + h + seed.charCodeAt(i)) | 0;
  return pool[Math.abs(h) % pool.length]!;
}
