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
 * 2026-07-11 review · CUTOVER COMPLETE. v2 is the SOLE prompt builder —
 * buildSystemPrompt() calls buildSystemPromptV2() unconditionally. The
 * NICK_PRIME_PROMPT flag no longer gates anything (isPromptV2Enabled()
 * returns true unconditionally and nothing consults it); it is marked
 * deprecated in feature-flags.ts. There is NO v1 builder left, so
 * "NICK_PRIME_PROMPT=off" is NOT a valid rollback lever — do not document
 * it as one.
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

/**
 * Prediction-calibration block · closes the outcome loop's last mile.
 *
 * The nightly brain-intelligence cron resolves predictions and
 * calibration-engine rolls 30d accuracy — but until 2026-08-05 nothing fed
 * that record back into the prompt (`buildCalibrationPromptBlock` had zero
 * callers since the V2 cutover). Same layer-position as
 * `buildInferredPatternsBlock()`: a self-contained block builder invoked
 * directly by the assembly.
 *
 * Fail-open by design: a broken stats query or missing rows must never break
 * prompt assembly, so failures log and inject nothing. Kill-switch:
 * CALIBRATION_PROMPT_BLOCK_DISABLED=1 (feature-flags registry).
 */
export async function buildCalibrationBlock(): Promise<string> {
  try {
    const { getFlag } = await import("@/lib/feature-flags");
    if (getFlag("CALIBRATION_PROMPT_BLOCK_DISABLED")?.isOn) return "";
    const { getCalibrationStats, buildCalibrationPromptBlock } = await import("@/lib/ai/outcome-calibration");
    const stats = await getCalibrationStats();
    return buildCalibrationPromptBlock(stats);
  } catch (err) {
    const { logError } = await import("@/lib/utils/error-log");
    logError("ai.prompt-v2", err, { fn: "buildCalibrationBlock" });
    return "";
  }
}

export async function buildSystemPromptV2(): Promise<PromptV2Output> {
  const ctx = await buildNickPrimeContext();
  const sections = renderPromptV2(ctx);
  const calibration = await buildCalibrationBlock();

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
    .concat(calibration ? ["", calibration] : [])
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
