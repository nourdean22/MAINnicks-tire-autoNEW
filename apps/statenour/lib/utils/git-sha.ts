/**
 * Extract git commit SHAs from prose (shared by the session importer + the
 * change digest — single source so the two can't drift).
 *
 * Accepts short SHAs (7–12 hex, the `git log --oneline` form) AND full 40-hex
 * SHAs (the `git log --format=%H` form); the awkward 13–39 middle is treated as
 * hex-like noise and dropped. Deduped by the first 7 chars so the short and
 * full form of the same commit don't both appear.
 */

export const GIT_SHA_RE = /\b[0-9a-f]{7,40}\b/g;

export function extractShas(text: string): string[] {
  const matches = (text ?? "").match(GIT_SHA_RE) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of matches) {
    if (!((s.length >= 7 && s.length <= 12) || s.length === 40)) continue;
    const key = s.slice(0, 7);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}
