/**
 * Wisdom origin registry · ONE resolver, ONE label set.
 *
 * 2026-09-02 self-audit, defect #5. The same principle was labelled
 * "Chat scrape · Raw assistant output" in the main wisdom list and fell
 * through to "uncategorized" in the see-also list ON THE SAME PAGE,
 * because the registry existed in four copies and two had drifted:
 *
 *   resolution · lib/services/brain-wisdom.ts `inferOrigin`
 *                  — metadata.origin first, then 5 key prefixes
 *                    (jobs · satori · distilled · from · nick_advice)
 *              · app/api/brain/wisdom/[id]/related/route.ts `inferOriginFromKey`
 *                  — 8 key prefixes, NO metadata.origin, NO nick_advice
 *              · lib/brain/wisdom-violations.ts `inferOriginFromKey`
 *                  — byte-identical third copy of the same 8
 *   labelling  · components/brain/wisdom-tab.tsx `ORIGIN_META` (10 keys)
 *              · components/brain/related-wisdom-links.tsx `ORIGIN_BADGE`
 *                  — 9 keys, `chat-scrape` missing
 *
 * All four are deleted; every call site reads from here. The resolver
 * below is the UNION of the three, not a pick of one: metadata.origin
 * wins, then every key prefix any copy knew about. No call site loses a
 * case it had, and three of them gain the cases they were missing.
 *
 * CLIENT-SAFE ON PURPOSE. Two "use client" components import this, and
 * so do a server service, a brain lib and a route handler — so it must
 * never reach `@/lib/prisma`. Same shape, same reason and the same mix
 * of callers as `lib/brain/wisdom-topic-tagger.ts`, which pairs its
 * `tagWisdomTopics` resolver with a `topicLabel` label lookup exactly
 * this way.
 */

/**
 * The origins this app knows how to label.
 *
 * NOT the return type of `resolveWisdomOrigin`: `metadata.origin` is a
 * free-text DB column and is returned verbatim when present, so an
 * origin outside this union can and does reach the UI. Callers label
 * through `wisdomOriginMeta`, which has a fallback for exactly that.
 */
export type WisdomOrigin =
  | "steve-jobs"
  | "satori"
  | "warren-buffett"
  | "bill-gates"
  | "elon-musk"
  | "greene-laws"
  | "distiller"
  | "consolidation"
  | "chat-scrape"
  | "uncategorized";

export interface WisdomOriginMeta {
  /** Full name · origin chips and the per-origin editorial heading. */
  label: string;
  /**
   * Compact name · the see-also list gives the origin a 64px column at
   * 9px, where "Warren Buffett" wraps into the excerpt beside it. This
   * is what `ORIGIN_BADGE` was for before it drifted.
   */
  badge: string;
  tradition: string;
  /** Teaching blurb · rendered once per origin section on the wisdom tab. */
  intro: string;
}

/**
 * Declaration order IS render order — `WISDOM_ORIGIN_ORDER` below is
 * derived from it, so the ordering can no longer drift from the labels
 * the way `wisdom-tab.tsx`'s separate `ORIGIN_ORDER` array could
 * (it listed the same 10 keys in a different order than `ORIGIN_META`
 * declared them). Curated traditions first, then the machine-generated
 * layers, then chat-scrape and the unlabelled tail.
 */
export const WISDOM_ORIGINS: Record<WisdomOrigin, WisdomOriginMeta> = {
  "steve-jobs": {
    label: "Steve Jobs",
    badge: "Jobs",
    tradition: "Design + Leadership",
    intro:
      "Apple cofounder · Pixar CEO · NeXT founder. Editorial discipline applied to product · simplicity as max sophistication, focus as competitive weapon, the keynote as part of the product. Wisdom shape: principles you can act on, not abstractions.",
  },
  satori: {
    label: "Satori",
    badge: "Satori",
    tradition: "Psychology + Philosophy",
    intro:
      "Clinically-informed wisdom companion. Internal Family Systems, DBT, Compassion-Focused Therapy, Schema Therapy + Stoicism, Buddhism, Taoism, Sufi heart-knowing, Jungian shadow. Wisdom shape: how to meet your own internal weather.",
  },
  "warren-buffett": {
    label: "Warren Buffett",
    badge: "Buffett",
    tradition: "Capital allocation",
    intro:
      "Berkshire Hathaway · the patient compounder. Circle of competence, margin of safety, economic moats, no called strikes in life. Wisdom shape: think in decades, not quarters; demand asymmetric upside before you swing.",
  },
  "bill-gates": {
    label: "Bill Gates",
    badge: "Gates",
    tradition: "Strategy at scale",
    intro:
      "Microsoft cofounder, systemic philanthropist. Distribution beats innovation, software-defined eats industries, treat each year as a chapter, intuition scales until it doesn't. Wisdom shape: solve at the system level; reserve think-week time before reactive work.",
  },
  "elon-musk": {
    label: "Elon Musk",
    badge: "Musk",
    tradition: "First principles + deletion",
    intro:
      "SpaceX · Tesla · the deletion-first engineer. Reason from physics + cost not analogy, make requirements less dumb, the best part is no part, idiot index, ship the v0 ugly. Wisdom shape: question the requirement before optimizing the implementation.",
  },
  "greene-laws": {
    label: "Robert Greene",
    badge: "Greene",
    tradition: "Power + Strategy + Human Nature",
    intro:
      "Promoted from the StrategicLaw library · 189 entries spanning the 48 Laws of Power, 33 Strategies of War, Laws of Human Nature, Mastery, Art of Seduction, and the 50th Law. Each carries the law's essence and an operator-specific application. Wisdom shape: read the room, understand power, anticipate the move that hasn't been made yet.",
  },
  distiller: {
    label: "The Distiller",
    badge: "Distilled",
    tradition: "Cron-distilled principles",
    intro:
      "Daily AI pass over patterns + insights + confirmed predictions + reflections. Synthesizes recurring observations into WHEN/THEN/BECAUSE principles. Highest signal when Nour's pattern stream is rich · weakest when input is thin.",
  },
  consolidation: {
    label: "Consolidation",
    badge: "Synthesis",
    tradition: "Promoted patterns",
    intro:
      "Patterns that hit a confidence + repetition threshold get promoted to wisdom with a [PROVEN PATTERN] tag. The inverse of the distiller — bottom-up evidence rather than top-down synthesis.",
  },
  "chat-scrape": {
    label: "Chat scrape",
    badge: "Chat",
    tradition: "Raw assistant output",
    intro:
      "Recent assistant chat replies that passed an isWisdomWorthy() filter. Lower trust · the raw output isn't always principle-shaped · weighted at 0.7x in contextual recall.",
  },
  uncategorized: {
    label: "Uncategorized",
    badge: "Wisdom",
    tradition: "Mixed",
    intro:
      "Older entries without metadata.origin · pre-v10.0.353 ingestions. Useful but heterogeneous · search by content if hunting for a specific principle.",
  },
};

/** Render order for the per-origin editorial sections and the origin chips. */
export const WISDOM_ORIGIN_ORDER = Object.keys(WISDOM_ORIGINS) as WisdomOrigin[];

/**
 * Key prefix → origin, for rows written before `metadata.origin` existed
 * (pre-v10.0.353) and for writers that still don't set it.
 *
 * `nick_advice_` is the case the two `inferOriginFromKey` copies dropped.
 * Those rows are written by `lib/brain/knowledge-sync.ts:394` under the
 * `nick_advice` CATEGORY, so they only reach a wisdom surface once
 * something re-categorizes them — but when one does, it must not be
 * labelled "Chat scrape" in one list and "Uncategorized" in another on
 * the same screen, which is the whole defect this file closes.
 *
 * Exported so a canary can assert every origin reachable from a prefix
 * still has a label, rather than trusting the type checker alone.
 */
export const WISDOM_ORIGIN_KEY_PREFIXES: ReadonlyArray<readonly [string, WisdomOrigin]> = [
  ["wisdom_jobs_", "steve-jobs"],
  ["wisdom_satori_", "satori"],
  ["wisdom_buffett_", "warren-buffett"],
  ["wisdom_gates_", "bill-gates"],
  ["wisdom_musk_", "elon-musk"],
  ["wisdom_greene_", "greene-laws"],
  ["wisdom_distilled_", "distiller"],
  ["wisdom_from_", "consolidation"],
  ["nick_advice_", "chat-scrape"],
];

/**
 * Resolve a wisdom row's origin. `metadata.origin` wins when set — it is
 * what the seeders and the promotion paths write — and the key prefix is
 * the fallback for rows that predate it.
 *
 * Returns `string`, not `WisdomOrigin`: `metadata.origin` is free text
 * and is passed through untouched, so an unknown origin surfaces as
 * itself rather than being silently flattened to "uncategorized".
 */
export function resolveWisdomOrigin(key: string, metaOrigin?: string | null): string {
  if (metaOrigin) return metaOrigin;
  for (const [prefix, origin] of WISDOM_ORIGIN_KEY_PREFIXES) {
    if (key.startsWith(prefix)) return origin;
  }
  return "uncategorized";
}

/**
 * Label an origin. Unknown origins (a `metadata.origin` nobody has
 * registered yet) render as themselves with a neutral tradition and no
 * blurb — the same fallback both deleted copies used, kept so a new
 * seeder can't blank the UI just by shipping before its label does.
 */
export function wisdomOriginMeta(origin: string): WisdomOriginMeta {
  return (
    WISDOM_ORIGINS[origin as WisdomOrigin] ?? {
      label: origin,
      badge: origin,
      tradition: "Origin",
      intro: "",
    }
  );
}
