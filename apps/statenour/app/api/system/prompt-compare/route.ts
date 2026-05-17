/**
 * GET /api/system/prompt-compare · v9.1.1 · Apr 30.
 *
 * Operator-driven shadow comparison between the legacy
 * `buildSystemPrompt()` (v1) and the v9.0 `buildSystemPromptV2()` flag-
 * gated builder. Returns BOTH prompts in one response so the operator
 * dashboard can render them side-by-side and the operator can eyeball
 * parity before flipping `NICK_PRIME_PROMPT=1` default-on.
 *
 * Power-user moves this enables:
 *   · "Does v2 cover the same signals v1 surfaces?"
 *   · "Did v2 grow / shrink the prompt unexpectedly?"
 *   · "What sections does v2 still need before parity?"
 *
 * Drives /system/prompt-comparison.
 *
 * Cost note: building both prompts pays the full DB-read cost twice in
 * one request. Acceptable for an operator-on-demand tool — not called
 * from any hot path.
 */

import { apiHandler } from "@/lib/utils/http";
import { buildSystemPrompt } from "@/lib/ai/system-prompt";
import { buildSystemPromptV2 } from "@/lib/ai/prompt/v2";

interface PromptCompareResponse {
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

export const GET = apiHandler(async () => {
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

  const response: PromptCompareResponse = {
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

  return response;
}, { auth: "owner" }); // v9.1.14 · was leaking the full v1 + v2 system prompts (including operator data)
