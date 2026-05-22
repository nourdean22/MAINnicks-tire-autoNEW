/**
 * lib/services/prompt-compare.ts · Phase VV (2026-05-22 ·
 * legacy-modernizer REST→tRPC system slice).
 *
 * The v1↔v2 system-prompt shadow comparison. Lifted verbatim from
 * app/api/system/prompt-compare/route.ts so the legacy REST endpoint
 * AND the new `system.promptCompare` tRPC procedure call the same
 * function · drift between consumers structurally impossible.
 *
 * Builds BOTH `buildSystemPrompt()` (v1) and `buildSystemPromptV2()`
 * in one pass so the operator can eyeball parity before flipping
 * NICK_PRIME_PROMPT=1.
 *
 * Cost note: building both prompts pays the full DB-read cost twice.
 * Acceptable for an operator-on-demand tool — not a hot path.
 */

import { buildSystemPrompt } from "@/lib/ai/system-prompt";
import { buildSystemPromptV2 } from "@/lib/ai/prompt/v2";

export interface PromptCompareResponse {
  generatedAt: string;
  v1: {
    prompt: string;
    chars: number;
    lines: number;
    sectionHeadings: string[];
  };
  v2: {
    prompt: string;
    chars: number;
    lines: number;
    sectionHeadings: string[];
    builderVersion: string;
  };
  delta: {
    charsDelta: number; // v2 - v1 (negative = v2 is shorter)
    charsDeltaPct: number;
    sectionsOnlyInV1: string[];
    sectionsOnlyInV2: string[];
    sectionsInBoth: string[];
  };
}

/** Pull `^## SECTION_NAME` lines so we can compare coverage. */
function extractSectionHeadings(prompt: string): string[] {
  const matches = prompt.match(/^##\s+[^\n]+/gm) ?? [];
  return matches.map((m) => m.replace(/^##\s+/, "").trim());
}

/** Build v1 + v2 prompts side-by-side with a section-coverage delta. */
export async function buildPromptCompare(): Promise<PromptCompareResponse> {
  const [v1Prompt, v2Out] = await Promise.all([
    buildSystemPrompt("full"),
    buildSystemPromptV2(),
  ]);

  const v1Headings = extractSectionHeadings(v1Prompt);
  const v2Headings = extractSectionHeadings(v2Out.prompt);
  const v1Set = new Set(v1Headings.map((h) => h.toLowerCase()));
  const v2Set = new Set(v2Headings.map((h) => h.toLowerCase()));

  const sectionsInBoth = v1Headings.filter((h) =>
    v2Set.has(h.toLowerCase()),
  );
  const sectionsOnlyInV1 = v1Headings.filter(
    (h) => !v2Set.has(h.toLowerCase()),
  );
  const sectionsOnlyInV2 = v2Headings.filter(
    (h) => !v1Set.has(h.toLowerCase()),
  );

  const charsDelta = v2Out.prompt.length - v1Prompt.length;
  const charsDeltaPct =
    v1Prompt.length === 0
      ? 0
      : Math.round((charsDelta / v1Prompt.length) * 1000) / 10;

  return {
    generatedAt: new Date().toISOString(),
    v1: {
      prompt: v1Prompt,
      chars: v1Prompt.length,
      lines: v1Prompt.split("\n").length,
      sectionHeadings: v1Headings,
    },
    v2: {
      prompt: v2Out.prompt,
      chars: v2Out.prompt.length,
      lines: v2Out.prompt.split("\n").length,
      sectionHeadings: v2Headings,
      builderVersion: v2Out.meta.builderVersion,
    },
    delta: {
      charsDelta,
      charsDeltaPct,
      sectionsOnlyInV1,
      sectionsOnlyInV2,
      sectionsInBoth,
    },
  };
}
