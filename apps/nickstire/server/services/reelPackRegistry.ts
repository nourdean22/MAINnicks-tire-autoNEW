/**
 * The two reel lanes, finally aware of each other.
 *
 * THE COLLISION. Scheduled agent runs write production packs to
 * `docs/reel-packs/<date>-<slug>/` as a HUMAN deliverable — the reel-operator
 * skill stops at READY FOR HUMAN APPROVAL and never publishes. Separately,
 * `dailyReelPost` picks a topic from the live miner and posts autonomously.
 * Neither knew about the other: grepped 2026-08-16, NOTHING under server/ or
 * client/ referenced the packs directory at all. The same day, three scheduled
 * runs fired in two hours and two of them covered the same battery topic, while
 * the autopost cron was independently free to pick it a third time.
 *
 * WHY READ THE DIRECTORY RATHER THAN A TABLE. The producing runs are
 * GitHub-scoped sessions with no database access — PR #1607's own capability
 * table records `DATABASE_URL` as absent — so they cannot register a row. What
 * they CAN do is commit, and committed files ship with the deploy. The
 * directory IS the shared surface; this reads it.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It does not make packs publishable, and
 * does not feed pack CONTENT into generation. A pack is pending human review by
 * construction; treating it as approved inventory would convert a review queue
 * into an autopost queue, which is exactly the protected boundary the skill
 * exists to hold. It only answers "has the pack lane already covered this?"
 *
 * Degrades to empty, never throws: no packs directory in the deployed image
 * means the autopost lane behaves exactly as it did before this file.
 */
import fs from "node:fs";
import path from "node:path";
import { createLogger } from "../lib/logger";

const log = createLogger("reel-pack-registry");

export interface CommittedPack {
  slug: string;
  /** Directory date prefix, YYYY-MM-DD. */
  date: string;
  campaignKeyword?: string;
  archetype?: string;
  /** Best available topic phrase for repetition comparison. */
  topic: string;
}

/** Cached briefly — the directory only changes on deploy. */
let cache: { at: number; packs: CommittedPack[] } | null = null;
const CACHE_MS = 10 * 60_000;

/**
 * Candidate roots, in order. Resolution differs between `tsx` from the repo
 * root, the compiled server, and the Railway image, and guessing one would make
 * this silently return nothing — the failure mode that let the lanes drift
 * apart in the first place.
 */
function candidateRoots(): string[] {
  const fromEnv = process.env.REEL_PACKS_DIR;
  const cwd = process.cwd();
  return [
    ...(fromEnv ? [fromEnv] : []),
    path.join(cwd, "docs", "reel-packs"),
    path.join(cwd, "apps", "nickstire", "docs", "reel-packs"),
    path.join(cwd, "..", "docs", "reel-packs"),
  ];
}

export function resolvePacksDir(): string | null {
  for (const dir of candidateRoots()) {
    try {
      if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return dir;
    } catch {
      // unreadable candidate — try the next
    }
  }
  return null;
}

/** Every pack committed to the repo, newest first. */
export function listCommittedPacks(): CommittedPack[] {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.packs;

  const dir = resolvePacksDir();
  if (!dir) {
    log.info("no reel-packs directory found — pack lane invisible to this process", {
      tried: candidateRoots().length,
    });
    cache = { at: Date.now(), packs: [] };
    return [];
  }

  const packs: CommittedPack[] = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const slug = entry.name;
      const date = /^(\d{4}-\d{2}-\d{2})/.exec(slug)?.[1] ?? "";
      let campaignKeyword: string | undefined;
      let archetype: string | undefined;

      // brief.json is optional — only some packs carry one, and a pack without
      // it still occupies its topic. The slug is the fallback, which is why the
      // directory naming convention is enforced in the skill.
      try {
        const raw = fs.readFileSync(path.join(dir, slug, "brief.json"), "utf8");
        const j = JSON.parse(raw) as { campaignKeyword?: string; archetype?: string };
        campaignKeyword = typeof j.campaignKeyword === "string" ? j.campaignKeyword : undefined;
        archetype = typeof j.archetype === "string" ? j.archetype : undefined;
      } catch {
        // no brief.json, or unparseable — slug still counts
      }

      packs.push({
        slug,
        date,
        campaignKeyword,
        archetype,
        topic: slug.replace(/^\d{4}-\d{2}-\d{2}-/, "").replace(/-/g, " ").trim(),
      });
    }
  } catch (err) {
    log.warn("could not read reel-packs directory", {
      dir,
      err: err instanceof Error ? err.message : String(err),
    });
  }

  packs.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  cache = { at: Date.now(), packs };
  return packs;
}

/**
 * Topic phrases the pack lane has already covered, for the autopost lane's
 * avoid-list. Bounded by `withinDays` because a pack from three months ago
 * should not permanently retire a topic.
 */
export function packCoveredTopics(withinDays = 30): string[] {
  const cutoff = new Date(Date.now() - withinDays * 86_400_000).toISOString().slice(0, 10);
  const out = new Set<string>();
  for (const p of listCommittedPacks()) {
    if (p.date && p.date < cutoff) continue;
    if (p.topic) out.add(p.topic);
    if (p.campaignKeyword) out.add(p.campaignKeyword.toLowerCase());
  }
  return [...out];
}

/** Test seam — the cache would otherwise outlive a fixture change. */
export function __resetPackCache(): void {
  cache = null;
}
