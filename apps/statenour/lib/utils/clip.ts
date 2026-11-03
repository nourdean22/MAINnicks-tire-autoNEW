/**
 * One-line clip for prompt and card text (W8a, audit C15: three copies lived in related-activity, goal-people-recall
 * and weekly-review). Whitespace collapses to one space; longer than `n` ends in a single ellipsis character.
 */
export function clip(s: string | null | undefined, n = 120): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
}
