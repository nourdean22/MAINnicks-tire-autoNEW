/**
 * lib/ai/strategic-frameworks/index.ts · OSS Phase 2 shim (2026-05-23).
 *
 * Re-exports the lens registry + detector from the standalone
 * @statenour/lenses workspace package. The inline 49-framework copy
 * that lived under this directory has been moved to packages/lenses/
 * · this file is now a thin compatibility layer so consumers don't
 * have to update imports (chat path is off-limits per the operator's
 * standing directive · re-export keeps that path untouched).
 *
 * What stays statenour-private (NOT in @statenour/lenses):
 *   · record-lens-fire.ts · BrainMemory + SystemMetric telemetry ·
 *     Prisma-coupled · only useful inside this stack.
 *
 * Renames bridged here:
 *   · pickFrameworks            → detectLenses        (OSS name)
 *   · hasBusinessIntent         → hasStrategicIntent  (OSS name)
 *   · composeStrategicLensBlock → custom (OSS formatLensBlock has
 *                                 no featured-fallback path)
 *
 * Provenance: see ADR-0020 · the workspace extraction was Wave OSS
 * (2026-05-23) · this Phase-2 rewire is the consumer-side completion.
 */

import {
  REGISTRY,
  detectLenses,
  hasStrategicIntent,
  pickFeaturedLenses,
  type StrategicFramework,
  type FrameworkMatch,
} from "@statenour/lenses";

// ── Re-exports · zero behavior change for callers ─────────────────

export { REGISTRY };
export type { StrategicFramework, FrameworkMatch };

/** Alias · OSS package renamed to `hasStrategicIntent` · statenour
 *  callers still use the original name. */
export const hasBusinessIntent = hasStrategicIntent;

/** Alias · OSS package renamed to `detectLenses` · statenour callers
 *  still use the original name. Signature unchanged: (text, topN?). */
export function pickFrameworks(text: string, topN: number = 3): FrameworkMatch[] {
  return detectLenses(text, { topN });
}

/**
 * Compose the system-prompt block for this turn. The OSS package's
 * `formatLensBlock(matches)` handles the matched-lens path; this
 * wrapper adds the featured-fallback path (Wave E behavior: when
 * business intent fires but no specific lens hits, dump the ~9
 * featured lens headlines instead of all 49).
 *
 * Returns "" when no business intent · safe to append unconditionally.
 */
export function composeStrategicLensBlock(text: string, topN: number = 3): string {
  if (!hasStrategicIntent(text)) return "";

  const matches = detectLenses(text, { topN });

  if (matches.length > 0) {
    const sections = matches
      .map((m: any) => {
        const f = m.framework;
        return `### ${f.name}\n${f.oneLiner}\n\n${f.lens}`;
      })
      .join("\n\n");

    return `## STRATEGIC LENS

When reasoning about this question, apply ONE of these strategic lenses
that fits best. Name the lens you used at the top of your answer so
Nour can see how you're thinking. If multiple apply, pick the one
that most changes the next decision · don't list all of them.

${sections}

After picking the lens, reason through it explicitly. Surface the
2-3 specific levers / tradeoffs / risks that change the answer.
Nour wants depth from a real framework, not a hot-take that sounds
strategic.`;
  }

  // Generic fallback · business intent fired but no specific lens
  // triggered. Featured-only (Wave E) keeps the block compact (~150
  // tokens) vs the full 49-lens dump (~700-1000 tokens). Falls back
  // to all-lenses if no lens is marked featured.
  const featuredLenses = pickFeaturedLenses();
  const lensesToList = featuredLenses.length > 0 ? featuredLenses : REGISTRY;
  const headlines = lensesToList
    .map((f: any) => `· **${f.name}** — ${f.oneLiner}`)
    .join("\n");

  return `## STRATEGIC LENS

This is a business / money / strategy question · apply structured
thinking, not a surface-level take. Name the lens you used at the
top of your answer so Nour can see how you're reasoning.

Available lenses:
${headlines}

Pick the ONE lens that most changes the decision · reason through
it explicitly · surface the 2-3 levers / tradeoffs / risks that
matter. Nour wants framework-grade depth, not a hot-take that
sounds strategic.`;
}
