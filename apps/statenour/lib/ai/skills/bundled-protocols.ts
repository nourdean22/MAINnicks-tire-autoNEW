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

export const BUNDLED_PROTOCOLS: Readonly<Record<string, string>> = {
  "maxforge-alpha": MAXFORGE_ALPHA_PROTOCOL,
};

/** Full protocol body for a skill name, or null if none is bundled. */
export function getBundledProtocol(name: string): string | null {
  return BUNDLED_PROTOCOLS[name.trim().toLowerCase()] ?? null;
}

/** True when a skill ships a full protocol body (used to hint suggestSkills). */
export function hasBundledProtocol(name: string): boolean {
  return getBundledProtocol(name) !== null;
}
