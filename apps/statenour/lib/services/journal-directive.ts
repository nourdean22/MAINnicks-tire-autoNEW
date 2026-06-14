/**
 * journal-directive · delivery-layer pass · 2026-06-10.
 *
 * Pure parser for the 4-line journal operator directive composed by
 * /api/ai/journal-brief (journal-advancement item F format:
 * COMPOUNDING / STALLED / WATCH / MOVE). The home strip renders labeled
 * rows when the brief matches the contract and falls back to the raw
 * text when it doesn't — the parser never throws and never invents
 * lines. Labels are uppercase by contract (the system prompt demands
 * them verbatim); a lowercase or prose brief is a non-match, which the
 * caller renders as-is instead.
 */

export const DIRECTIVE_LABELS = [
  "COMPOUNDING",
  "STALLED",
  "WATCH",
  "MOVE",
] as const;

export type DirectiveLabel = (typeof DIRECTIVE_LABELS)[number];

export interface DirectiveLine {
  label: DirectiveLabel;
  text: string;
}

/**
 * Parse the directive into labeled lines, preserving the order they
 * appear in. Returns null unless at least two known labels carry
 * non-empty text — a weaker match means the model ignored the format,
 * and the raw brief is the honest thing to show.
 */
export function parseDirectiveLines(
  brief: string | null | undefined,
): DirectiveLine[] | null {
  if (!brief) return null;
  const out: DirectiveLine[] = [];
  for (const raw of brief.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const match = /^([A-Z]+):\s*(.+)$/.exec(line);
    if (!match) continue;
    const label = match[1];
    if (!(DIRECTIVE_LABELS as readonly string[]).includes(label)) continue;
    if (out.some((l) => l.label === label)) continue; // first occurrence wins
    out.push({ label: label as DirectiveLabel, text: match[2].trim() });
  }
  return out.length >= 2 ? out : null;
}
