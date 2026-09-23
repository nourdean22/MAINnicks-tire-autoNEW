/**
 * A lexical recall lane must not become the one path that returns deleted or
 * quarantined memory.
 *
 * ★★★ THE DEFECT, MEASURED 2026-09-18. `semanticSearch` returns [] both when
 * nothing matched and when the query embedding is unavailable. Several recall
 * surfaces therefore fall through to a keyword/ILIKE lane on an empty result —
 * which is correct, and is what keeps recall alive during an embedding outage.
 * But those fallbacks ran WITHOUT the guards the dense path enforces:
 *
 *   · no `deletedAt: null`  -> memories the operator explicitly DELETED
 *     came back, and only while the system was degraded.
 *   · no category exclusion -> `research_claim_candidate` rows surfaced:
 *     un-promoted external claims whose only grounding is cosine similarity to
 *     our own memory. categories.ts is explicit that until a human promotes
 *     them they belong "to /brain, not to the model".
 *
 * embedding-utils.ts had already fixed exactly this on its OWN in-memory
 * fallback — "deleted and quarantined content became recallable exactly when
 * the system was already degraded" — but the lesson never reached these lanes.
 *
 * ⚠⚠ SCOPE IS DELIBERATELY A NAMED LIST, NOT A REPO SWEEP.
 * A regex sweep for this was written first and was WRONG: it reported
 * `lib/ai/tools/brain.ts` and `lib/services/pricing-advisor.ts` as unguarded
 * when both guard correctly through helpers (`laneWhere(...)`,
 * `activeOnly(...)`), and it missed a guard that sat outside its scan window.
 * A guard that matches a LINE SHAPE is not a guard — the same failure this
 * repo has now recorded three times. Rather than ship a gate that cries wolf
 * (and invites someone to "fix" correct code), this pins the surfaces that
 * were READ and VERIFIED. Adding a surface here is a deliberate act.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const APP = join(__dirname, "../..");

/** Guard helpers that supply `deletedAt: null` on the caller's behalf. */
const GUARD_HELPERS = ["activeOnly(", "laneWhere("];

export function guardsSoftDelete(whereBlock: string): boolean {
  if (/deletedAt\s*:\s*null/.test(whereBlock)) return true;
  return GUARD_HELPERS.some((h) => whereBlock.includes(h));
}

export function guardsQuarantine(whereBlock: string): boolean {
  return /category\s*:\s*\{\s*notIn\s*:\s*\[\s*\.\.\.RECALL_EXCLUDE_CATEGORIES/.test(whereBlock);
}

/**
 * Recall surfaces whose lexical lane was read and verified on 2026-09-18.
 * `quarantine` is false where the surface is already scoped to a single
 * non-excluded category (the exclusion would be dead weight) or reads a model
 * that has no `category` column.
 */
const SURFACES: { file: string; anchor: string; quarantine: boolean; why: string }[] = [
  {
    file: "app/api/telegram/webhook/route.ts",
    anchor: "Fall back to keyword search",
    quarantine: true,
    why: "/memory operator command",
  },
  {
    file: "app/api/telegram/webhook/route.ts",
    anchor: "Fall back to LIKE search across journal",
    quarantine: false,
    why: "/search journal lane — BrainDump has no category column",
  },
  {
    file: "app/api/telegram/webhook/route.ts",
    anchor: "AN EMPTY DENSE RESULT IS NOT A MEASURED ZERO",
    quarantine: true,
    why: "search_memory tool — the lane an LLM speaks from",
  },
  {
    file: "app/api/ai/assist/route.ts",
    anchor: "this OR ran unguarded",
    quarantine: true,
    why: "assist route memory pull -> AI prompt",
  },
  {
    file: "lib/services/ai-coach-goal.ts",
    anchor: "unguarded, a keyword match fed SOFT-DELETED",
    quarantine: true,
    why: "goal coach memory block -> AI prompt",
  },
];

describe("lexical recall fallbacks carry the dense path's guards", () => {
  for (const s of SURFACES) {
    it(`${s.why} (${s.file})`, () => {
      const src = readFileSync(join(APP, s.file), "utf8");
      const at = src.indexOf(s.anchor);
      expect(at, `anchor not found — the surface moved: "${s.anchor}"`).toBeGreaterThan(-1);
      // The findMany call follows the anchor comment; 1200 chars covers the
      // whole where-clause at every one of these sites.
      const block = src.slice(at, at + 1200);
      expect(
        guardsSoftDelete(block),
        `${s.file} lexical lane has no deletedAt guard — during an embedding outage ` +
          `this returns memories the operator explicitly deleted`,
      ).toBe(true);
      if (s.quarantine) {
        expect(
          guardsQuarantine(block),
          `${s.file} lexical lane does not exclude RECALL_EXCLUDE_CATEGORIES — ` +
            `un-promoted research_claim_candidate rows reach the model`,
        ).toBe(true);
      }
    });
  }
});

describe("MUTATION · the predicates actually reject", () => {
  it("an unguarded where-clause fails the soft-delete check", () => {
    expect(guardsSoftDelete(`where: { content: { contains: q, mode: "insensitive" } }`)).toBe(false);
  });

  it("a literal deletedAt guard passes", () => {
    expect(guardsSoftDelete(`where: { content: { contains: q }, deletedAt: null }`)).toBe(true);
  });

  it("a helper-supplied guard passes — the false positive that broke the first sweep", () => {
    // lib/ai/tools/brain.ts and pricing-advisor.ts guard this way. A checker
    // that only looks for a literal would flag both as leaks.
    expect(guardsSoftDelete(`where: laneWhere({ content: { contains: q } })`)).toBe(true);
    expect(guardsSoftDelete(`where: activeOnly({ content: { contains: q } })`)).toBe(true);
  });

  it("quarantine check rejects a missing exclusion and accepts the canonical form", () => {
    expect(guardsQuarantine(`where: { deletedAt: null }`)).toBe(false);
    expect(
      guardsQuarantine(`where: { deletedAt: null, category: { notIn: [...RECALL_EXCLUDE_CATEGORIES] } }`),
    ).toBe(true);
  });

  it("an inverted guard does not count", () => {
    // `category: { in: [...] }` is a selection, not an exclusion.
    expect(guardsQuarantine(`category: { in: [...RECALL_EXCLUDE_CATEGORIES] }`)).toBe(false);
  });
});
