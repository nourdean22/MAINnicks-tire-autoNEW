/**
 * 2026-05-28 · Power Atlas · Greene corpus unified schema.
 *
 * Replaces the 2026-05-27 split-by-export model (LAWS_OF_POWER ·
 * SEDUCER_TYPES · DARK_TRAITS · MENTORSHIP_ROLES · WAR_STRATEGIES).
 * Operator's ask: "add all, merge them, make what they relay more
 * useful." This file defines the unified entry shape. Per-book files
 * in this folder author entries against this shape; `greene-corpus.ts`
 * one-folder up re-exports the merged list.
 *
 * The fields `triggers`, `actions`, and `relatedKeys` are the
 * usefulness layer · the Sunday digest cron + GreeneLawSidebar can now
 * pull a concrete next-move from each entry without re-deriving it
 * from prose at runtime.
 */

export type GreeneBook =
  | "48LP" //  The 48 Laws of Power
  | "Seduction" // The Art of Seduction
  | "33SW" // 33 Strategies of War
  | "50L" // The 50th Law
  | "Mastery" // Mastery
  | "HN"; //   The Laws of Human Nature

export type GreeneType =
  | "law" //              48LP · 33SW · 50L numbered law
  | "strategy" //         33SW non-numbered tactical
  | "seducer_type" //     Seduction · 9 seducer archetypes
  | "victim_type" //      Seduction · 9 victim archetypes
  | "phase" //            Seduction or Mastery · sequential phase
  | "dark_trait" //       HN · personality types to detect
  | "mentorship_role" //  Mastery · mentor/apprentice taxonomy
  | "principle" //        HN / Mastery / 50L · standalone principle
  | "fearless_law"; //    50L · the 10 numbered fearless principles

export interface GreeneEntry {
  /** Stable BrainMemory key · "law_10", "fearless_2", "seducer_siren", etc. */
  key: string;
  /** Source book · drives per-book filters + UI ribbons. */
  book: GreeneBook;
  /** Structural type · drives the relevant UI widget (law card vs trait
   *  badge vs phase progress, etc). */
  type: GreeneType;
  /** Numbered position if applicable (1-48 for 48LP, 1-33 for 33SW, etc). */
  number?: number;
  /** Chapter or section identifier if applicable (HN chapter 2, etc). */
  chapter?: string;
  /** Title · the law name. Verbatim from Greene where possible. */
  title: string;
  /** One-sentence distillation · 50-100 chars. */
  summary: string;
  /** 2-5 sentence Greene-voiced explanation. */
  fullText: string;
  /** 2-4 observable conditions in the operator's profile schema that
   *  signal this entry applies. Authored in plain English mapped to
   *  fields the digest cron can check (e.g. "interactionCount > 20",
   *  "ledger trends net-negative 90d", "person.role === 'mentor'"). */
  triggers: string[];
  /** 3-5 imperative-voice next moves · what the operator should DO. */
  actions: string[];
  /** 1-4 keys of other entries that frequently co-apply · powers the
   *  GreeneLawSidebar "related" footer + the digest cron's secondary
   *  match expansion. */
  relatedKeys: string[];
  /** AI instruction the Sunday digest cron uses to decide whether this
   *  entry applies to a given person's current state. */
  applicabilityPrompt: string;
}
