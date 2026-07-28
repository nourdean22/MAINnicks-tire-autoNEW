/**
 * 2026-05-28 · Power Atlas · Greene corpus · unified aggregator.
 *
 * Replaces the 2026-05-27 split-by-export model. Now a single source
 * of truth that imports each book's entries from `lib/brain/greene/*`
 * and exposes:
 *
 *   · `ALL_GREENE_ENTRIES`   · the merged taxonomy (153 entries · the
 *     "~164" in this header before 2026-07-27 was never accurate; the
 *     real count was 144 pre-Book-V. `GREENE_CORPUS_COUNTS.total` is
 *     the authority.)
 *   · `ENTRIES_BY_BOOK`      · filter helper
 *   · `GreeneEntry` type     · unified schema with triggers/actions/relatedKeys
 *
 * Back-compat re-exports (LAWS_OF_POWER · SEDUCER_TYPES · DARK_TRAITS ·
 * MENTORSHIP_ROLES · WAR_STRATEGIES) are kept for any consumer that
 * still hits the legacy names. They map directly to the per-book
 * arrays below.
 *
 * Operator-facing goal: every entry now carries CONCRETE next-moves
 * (`actions`), CONCRETE detection conditions (`triggers`), and
 * cross-references (`relatedKeys`). The Sunday digest cron + the
 * GreeneLawSidebar can compose actionable guidance without re-deriving
 * it from prose.
 */

export type {
  GreeneBook,
  GreeneType,
  GreeneEntry,
} from "./greene/schema";

import type { GreeneEntry, GreeneBook } from "./greene/schema";

import { LAWS_OF_POWER as LAWS_48 } from "./greene/48-laws-of-power";
import { WAR_STRATEGIES as STRATEGIES_33 } from "./greene/33-strategies-of-war";
import { FEARLESS_LAWS } from "./greene/50th-law";
import { MASTERY_ENTRIES } from "./greene/mastery";
import { SEDUCTION_ENTRIES } from "./greene/art-of-seduction";
import { HUMAN_NATURE_ENTRIES } from "./greene/laws-of-human-nature";
import { GREENE_MATCH_PHRASES } from "./greene/match-phrases";

// ── Unified merged set ──────────────────────────────────────────
// 2026-07-27 · `matchPhrases` are merged in from ./greene/match-phrases
// rather than authored inline on each of the 144 per-book entries. Two
// reasons: the per-book files keep sentence-form `triggers` for the
// digest cron that depends on them, and the chat-side match surface stays
// reviewable as one artifact instead of a diff across six large files.
// An entry that carries `matchPhrases` inline wins — that is how the nine
// Book V creative strategies keep theirs next to the entry they describe.
const withMatchPhrases = (e: GreeneEntry): GreeneEntry =>
  e.matchPhrases ? e : { ...e, matchPhrases: GREENE_MATCH_PHRASES[e.key] };

export const ALL_GREENE_ENTRIES: GreeneEntry[] = [
  ...LAWS_48,
  ...STRATEGIES_33,
  ...FEARLESS_LAWS,
  ...MASTERY_ENTRIES,
  ...SEDUCTION_ENTRIES,
  ...HUMAN_NATURE_ENTRIES,
].map(withMatchPhrases);

// ── Per-book filter helper ──────────────────────────────────────
export function entriesForBook(book: GreeneBook): GreeneEntry[] {
  return ALL_GREENE_ENTRIES.filter((e) => e.book === book);
}

export const ENTRIES_BY_BOOK: Record<GreeneBook, GreeneEntry[]> = {
  "48LP": LAWS_48,
  "33SW": STRATEGIES_33,
  "50L": FEARLESS_LAWS,
  Mastery: MASTERY_ENTRIES,
  Seduction: SEDUCTION_ENTRIES,
  HN: HUMAN_NATURE_ENTRIES,
};

// ── Back-compat exports ────────────────────────────────────────
// 2026-05-27 corpus exposed these as separate arrays. Existing
// consumers (mostly the seed script) still reference them by name.
// Map directly from the unified arrays so the truth source is single.
export const LAWS_OF_POWER = LAWS_48;
export const SEDUCER_TYPES = SEDUCTION_ENTRIES.filter(
  (e) => e.type === "seducer_type",
);
export const VICTIM_TYPES = SEDUCTION_ENTRIES.filter(
  (e) => e.type === "victim_type",
);
export const DARK_TRAITS = HUMAN_NATURE_ENTRIES.filter(
  (e) => e.type === "dark_trait",
);
export const HUMAN_NATURE_PRINCIPLES = HUMAN_NATURE_ENTRIES.filter(
  (e) => e.type === "principle",
);
export const MENTORSHIP_ROLES = MASTERY_ENTRIES.filter(
  (e) => e.type === "mentorship_role",
);
export const MASTERY_PHASES = MASTERY_ENTRIES.filter(
  (e) => e.type === "phase",
);
/** 2026-07-27 · Mastery Book V · the 9 creative-active strategies. */
export const CREATIVE_STRATEGIES = MASTERY_ENTRIES.filter(
  (e) => e.type === "creative_strategy",
);
export const WAR_STRATEGIES = STRATEGIES_33;

// ── Diagnostic helpers ─────────────────────────────────────────
export const GREENE_CORPUS_COUNTS = {
  total: ALL_GREENE_ENTRIES.length,
  byBook: {
    "48LP": LAWS_48.length,
    "33SW": STRATEGIES_33.length,
    "50L": FEARLESS_LAWS.length,
    Mastery: MASTERY_ENTRIES.length,
    Seduction: SEDUCTION_ENTRIES.length,
    HN: HUMAN_NATURE_ENTRIES.length,
  } as Record<GreeneBook, number>,
};
