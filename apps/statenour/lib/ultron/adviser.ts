/**
 * ULTRON ADVISER — applied law delivery.
 *
 * The Adviser voice of the Narrator layer. Translates real-time situations
 * into applicable wisdom from the 190+ seeded StrategicLaw entries
 * (48 Laws of Power, 33 Strategies of War, Mastery, Art of Seduction,
 * 50th Law).
 *
 * Each StrategicLaw row already carries `triggerPatterns` as JSON — an
 * array of snake_case labels like "over_explaining", "rumination_loop",
 * "reputation_at_risk". The matcher is a simple set-intersection: events
 * emit patterns, laws declare patterns, the highest-overlap laws win.
 *
 * No AI in v1. Every invocation is deterministic, traceable, and fast.
 * Adds the Applied-Wisdom layer Nour has been asking for without becoming
 * another preachy quote-of-the-day feed.
 */

import { prisma } from "@/lib/prisma";
import { cached } from "@/lib/utils/cache";
import { logError } from "@/lib/utils/error-log";

export interface MatchedLaw {
  id: string;
  book: string;           // enum string: "FORTYEIGHT_LAWS" etc
  number: number;
  title: string;
  shortTitle: string;
  essence: string;
  shopApplication: string;
  nourApplication: string;
  triggerPatterns: string[];
  score: number;           // 0..N — number of matched patterns
}

export interface LawRef {
  id: string;
  book: string;
  number: number;
  shortTitle: string;
  application: "shop" | "personal" | "universal";
  applicationText: string;
}

interface ApplicationContext {
  /** Is the event happening in a business / shop / revenue context? */
  businessContext?: boolean;
  /** Free-form recent situation text the engine collected */
  situationHint?: string;
}

/**
 * Load all laws + their triggerPatterns into a searchable in-memory shape.
 * Cached aggressively (10 min) since the law catalogue is stable — seeds
 * change once a month at most.
 */
async function loadLawIndex(): Promise<MatchedLaw[]> {
  return cached("ultron_law_index_v1", 600, async () => {
    const rows = await prisma.strategicLaw
      .findMany({
        select: {
          id: true,
          book: true,
          number: true,
          title: true,
          shortTitle: true,
          essence: true,
          shopApplication: true,
          nourApplication: true,
          triggerPatterns: true,
        },
      })
      .catch((): Array<{
        id: string;
        book: string;
        number: number;
        title: string;
        shortTitle: string;
        essence: string;
        shopApplication: string;
        nourApplication: string;
        triggerPatterns: unknown;
      }> => []);

    return rows.map((r) => {
      // triggerPatterns is a JSON column — normalize to string[]
      let patterns: string[] = [];
      if (Array.isArray(r.triggerPatterns)) {
        patterns = (r.triggerPatterns as unknown[]).filter((x): x is string => typeof x === "string");
      } else if (typeof r.triggerPatterns === "string") {
        try {
          const parsed = JSON.parse(r.triggerPatterns);
          if (Array.isArray(parsed)) patterns = parsed.filter((x): x is string => typeof x === "string");
        } catch {
          // Synthetic message — stored content must not leak into ErrorLog.
          logError("ultron.adviser", new Error("triggerPatterns JSON parse failed"), { stage: "parse-trigger-patterns" }, "warn");
        }
      }
      return {
        id: r.id,
        book: r.book,
        number: r.number,
        title: r.title,
        shortTitle: r.shortTitle,
        essence: r.essence,
        shopApplication: r.shopApplication,
        nourApplication: r.nourApplication,
        triggerPatterns: patterns,
        score: 0,
      };
    });
  });
}

/**
 * Match snake_case patterns from the Narrator engine against the law index.
 * Scores by number of overlapping patterns. Ties broken by lower book
 * ordinal (48 Laws first — the classic) then by law number (earlier laws
 * first, intended as more fundamental).
 */
export async function findLawsForPatterns(
  patterns: string[],
  opts: { limit?: number } = {},
): Promise<MatchedLaw[]> {
  const limit = opts.limit ?? 3;
  if (patterns.length === 0) return [];

  const index = await loadLawIndex();
  const patternSet = new Set(patterns);

  const scored: MatchedLaw[] = [];
  for (const law of index) {
    const overlap = law.triggerPatterns.filter((p) => patternSet.has(p));
    if (overlap.length > 0) {
      scored.push({ ...law, score: overlap.length });
    }
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.book !== b.book) return bookOrdinal(a.book) - bookOrdinal(b.book);
    return a.number - b.number;
  });

  return scored.slice(0, limit);
}

function bookOrdinal(book: string): number {
  switch (book) {
    case "FORTYEIGHT_LAWS":        return 0;
    case "THIRTYTHREE_STRATEGIES": return 1;
    case "MASTERY":                return 2;
    case "ART_OF_SEDUCTION":       return 3;
    case "FIFTIETH_LAW":           return 4;
    default:                        return 5;
  }
}

/**
 * Pick the most appropriate application text for a law given context.
 *
 * Rules (v1):
 *   - Business context → shopApplication (Nick's Tire-specific)
 *   - Default → nourApplication (personal, Nour-specific)
 *
 * The seeded laws have rich custom text for both variants, so we don't
 * need an LLM to reword — we just pick the right side of the schema.
 * v2 can add a "universal" fallback for situations neither context fits.
 */
export function pickApplication(
  law: MatchedLaw,
  ctx: ApplicationContext = {},
): { kind: "shop" | "personal" | "universal"; text: string } {
  if (ctx.businessContext) {
    return { kind: "shop", text: law.shopApplication };
  }
  return { kind: "personal", text: law.nourApplication };
}

/**
 * Convenience: one-shot "give me the top law + formatted advice for these
 * patterns in this context." Used by the Narrator engine and future
 * callers (chat interstitial, /decide anchor, etc).
 */
export async function adviseForPatterns(
  patterns: string[],
  ctx: ApplicationContext = {},
): Promise<LawRef | null> {
  const matches = await findLawsForPatterns(patterns, { limit: 1 });
  if (matches.length === 0) return null;
  const law = matches[0];
  const app = pickApplication(law, ctx);
  return {
    id: law.id,
    book: law.book,
    number: law.number,
    shortTitle: law.shortTitle,
    application: app.kind,
    applicationText: app.text,
  };
}
