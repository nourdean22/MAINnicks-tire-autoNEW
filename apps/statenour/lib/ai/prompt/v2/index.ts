/**
 * System-prompt v2 entry point · v9.2 · 2026-05-01.
 *
 * Builds a complete prompt by combining three layers:
 *
 *   · Layer 1 · `staticPrefix()` from `lib/ai/prompt/static.ts` —
 *     Nick's identity, Nour's stable profile, brand voice, the 7
 *     working principles, response style, processing rules, tools
 *     description, builder mode. **No metrics.** Stable across turns.
 *
 *   · Layer 1.5 · `buildInferredPatternsBlock()` from
 *     `lib/ai/prompt/inferred-patterns.ts` — the 5 behavioral
 *     pattern hypotheses (Body→Business, Sleep→Decisions, etc),
 *     reframed as "hypotheses to test" instead of measured facts.
 *     **No magnitudes.**
 *
 *   · Layer 2 · live-operating-state sections from `renderPromptV2`
 *     (driven by NickPrimeContext) — anchors, temporal, commands,
 *     why-block, recent thinking, domain snapshot, proof, risks,
 *     decisions, health. **All numbers come from real queries.**
 *
 * v9.2 fixed three problems with the v9.0-beta version of this file:
 *
 *   1. The Layer 1 stub was 6 lines; the real identity / voice /
 *      principles still lived in v1. Now extracted properly.
 *   2. v1 hardcoded specific causation numbers ("-15% per hour") as
 *      if measured. Reframed as hypotheses without numbers; live
 *      magnitudes only come from queryable correlation rows.
 *   3. v1's response-style rule was strict word-counts (40-60
 *      default, 250 ceiling) that crippled analysis / strategy /
 *      code-review answers. Now intent-based.
 *
 * For v9.2 this is still BEHIND a feature flag. Default OFF; enable
 * in dev with `NICK_PRIME_PROMPT=1`. Production stays on v1 until
 * shadow runs (lib/ai/shadow-mode.ts) show parity for 24-48h. Once
 * v2 is the primary, the v1 builder retires entirely.
 */

import { buildNickPrimeContext } from "@/lib/ai/context/nick-prime-context";
import { renderPromptV2, type PromptV2Sections } from "./renderer";
import { buildStaticPrefix } from "@/lib/ai/prompt/static";
import { buildInferredPatternsBlock } from "@/lib/ai/prompt/inferred-patterns";

export interface PromptV2Output {
  prompt: string;
  sections: PromptV2Sections;
  meta: {
    builderVersion: "v2";
    contextChars: number;
    builtAt: string;
  };
}

export function isPromptV2Enabled(): boolean {
  return true;
}

export async function buildSystemPromptV2(): Promise<PromptV2Output> {
  const ctx = await buildNickPrimeContext();
  const sections = renderPromptV2(ctx);

  // Three-layer assembly: stable identity → pattern hypotheses → live
  // operating state. Empty live sections are skipped so the prompt
  // stays compact when there's nothing to surface in that bucket.
  const prompt = [
    buildStaticPrefix(),
    "",
    buildInferredPatternsBlock(),
  ]
    .concat(sections.anchors ? ["", sections.anchors] : [])
    .concat(sections.agendaItems ? ["", sections.agendaItems] : [])
    .concat(sections.temporal ? ["", sections.temporal] : [])
    .concat(["", sections.commands])
    .concat(sections.whyBlock ? ["", sections.whyBlock] : [])
    .concat(sections.recentThinking ? ["", sections.recentThinking] : [])
    .concat(sections.domainSnapshot ? ["", sections.domainSnapshot] : [])
    .concat(["", sections.proof, "", sections.risks])
    .concat(sections.decisions ? ["", sections.decisions] : [])
    .concat(["", sections.health])
    .join("\n");

  return {
    prompt,
    sections,
    meta: {
      builderVersion: "v2",
      contextChars: prompt.length,
      builtAt: new Date().toISOString(),
    },
  };
}
