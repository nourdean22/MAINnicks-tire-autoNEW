/**
 * lib/ai/board/boards.ts · pre-configured board compositions
 * (2026-05-23 · task #23).
 *
 * Each board's `memberIds` are framework ids from the existing
 * strategic-frameworks REGISTRY. The consult service resolves them at
 * call time · unknown ids are silently dropped (a board still
 * functions with however many resolvable members it has).
 *
 * Board sizing · 5 members is the sweet spot for first slice:
 *   · 3 is too narrow (one strong opinion drowns the rest)
 *   · 8+ is too noisy + 8x the LLM cost
 *   · 5 gives meaningful divergence without per-consultation cost
 *     ballooning · per-consultation cost ≈ 5 advisor calls + 1
 *     synthesizer call = 6 aiChat calls
 *
 * Picks bias toward frameworks with strong PERSONA voice (elon-musk,
 * warren-buffett, steve-jobs) for their distinct lens, and lean
 * mental-model frameworks (inversion, second-order-thinking,
 * five-whys, ooda-loop, pareto-principle) for tactical sharpness.
 */

import type { Board, BoardId } from "./types";

export const BOARDS: Record<BoardId, Board> = {
  // ── strategic · the default board for major life/career decisions ──
  strategic: {
    id: "strategic",
    name: "Strategic Board",
    oneLiner: "Major decisions · 5 distinct lenses · use when a choice has compound consequences",
    memberIds: [
      "elon-musk", // first principles + 10x not 10%
      "warren-buffett", // moats + durability + intrinsic value
      "steve-jobs", // design + experience + simplicity
      "inversion", // what would CAUSE this to fail · pre-mortem mindset
      "second-order-thinking", // downstream effects · what comes AFTER the obvious win
    ],
  },

  // ── invest · capital allocation + pricing + financial trade-offs ──
  invest: {
    id: "invest",
    name: "Investment Board",
    oneLiner: "Capital decisions · 5 financial lenses · use when money is on the line",
    memberIds: [
      "warren-buffett", // moats + intrinsic value
      "capital-allocation", // ROI + reinvestment
      "unit-economics", // per-unit math
      "pricing-power", // can you raise without losing demand
      "opportunity-cost", // what you're NOT doing by doing this
    ],
  },

  // ── product · product / feature / market direction decisions ──
  product: {
    id: "product",
    name: "Product Board",
    oneLiner: "Product decisions · 5 customer + market lenses · use when shaping a product or feature",
    memberIds: [
      "steve-jobs", // design + experience + simplicity
      "jobs-to-be-done", // what the customer is hiring this for
      "innovators-dilemma", // disruption from below
      "blue-ocean", // uncontested market space
      "ideal-customer-profile", // who actually buys
    ],
  },

  // ── operator · personal decision quality + tempo + root cause ──
  operator: {
    id: "operator",
    name: "Operator Board",
    oneLiner: "Personal decisions · 5 self-management lenses · use when the decision is about YOU",
    memberIds: [
      "elon-musk", // first principles + delete-not-optimize
      "inversion", // what would CAUSE this to fail
      "five-whys", // root cause vs. surface issue
      "ooda-loop", // observe-orient-decide-act tempo
      "pareto-principle", // 20% that drives 80%
    ],
  },

  // ── full · critical decisions · 8 advisors · max signal, max latency ──
  full: {
    id: "full",
    name: "Full Board",
    oneLiner: "Critical decisions · 8 advisors · max signal · slower + more expensive · use sparingly",
    memberIds: [
      "elon-musk",
      "warren-buffett",
      "steve-jobs",
      "jobs-to-be-done",
      "inversion",
      "second-order-thinking",
      "ooda-loop",
      "five-whys",
    ],
  },

  // ── team · AG-42 · the in-house working team as a board ──
  // Member ids resolve from lib/ai/personas (NOT the frameworks
  // REGISTRY) via the persona fallback in consult.resolveMembers —
  // the AG-12 team personas were only reachable one-at-a-time through
  // arsenalMultiAgent; this convenes them side-by-side on one question.
  team: {
    id: "team",
    name: "Working Team",
    oneLiner: "Your in-house team · thought partner, researcher, strategist, tactician, consultant · use for working decisions, not identity-grade ones",
    memberIds: [
      "thought-partner", // steelman → attack → tension
      "research-analyst", // the 3-5 facts that decide it
      "strategist", // 6-24mo positioning + what it forecloses
      "tactician", // next-48h concrete moves
      "business-consultant", // unit-economics verdict
    ],
  },
};

/** Lookup helper · returns the Board for an id or null if unknown. */
export function getBoard(id: string): Board | null {
  return (BOARDS as Record<string, Board>)[id] ?? null;
}

/** All board ids in display order · used by the UI selector. */
export const BOARD_IDS: ReadonlyArray<BoardId> = [
  "strategic",
  "invest",
  "product",
  "operator",
  "full",
  "team",
];
