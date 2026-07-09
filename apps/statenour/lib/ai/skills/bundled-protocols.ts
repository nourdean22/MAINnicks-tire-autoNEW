/**
 * Bundled skill protocols — registry of skills whose full instruction body
 * ships inside the app (not just the recall description).
 *
 * Semantic recall (lib/skills/skill-recall.ts) surfaces skill NAME +
 * DESCRIPTION only; the SKILL.md body lives in the operator's local
 * ~/.claude/skills and is not deployed. For skills the chat model should
 * execute with full fidelity, register the verbatim protocol here so the
 * getSkillProtocol tool can return it in-prompt.
 *
 * To add a skill: import its protocol string and add one map entry keyed by
 * the exact skill name used in the registry.
 */

import { MAXFORGE_ALPHA_PROTOCOL } from "@/lib/ai/skills/maxforge-alpha";
import { THOUGHT_PARTNER_PROTOCOL } from "@/lib/ai/skills/thought-partner";
import { TACTICIAN_PROTOCOL } from "@/lib/ai/skills/tactician";

export const BUNDLED_PROTOCOLS: Readonly<Record<string, string>> = {
  "maxforge-alpha": MAXFORGE_ALPHA_PROTOCOL,
  // AG-32 · persona protocols — full-fidelity twins of the personality
  // modes (finalize-system-prompt personalityPrompts) so chat can pull
  // the deep discipline on demand via getSkillProtocol.
  "thought-partner": THOUGHT_PARTNER_PROTOCOL,
  tactician: TACTICIAN_PROTOCOL,
};

/** Full protocol body for a skill name, or null if none is bundled. */
export function getBundledProtocol(name: string): string | null {
  return BUNDLED_PROTOCOLS[name.trim().toLowerCase()] ?? null;
}

/** True when a skill ships a full protocol body (used to hint suggestSkills). */
export function hasBundledProtocol(name: string): boolean {
  return getBundledProtocol(name) !== null;
}
