/**
 * Text blankers for the brand-voice linter.
 *
 * Lifted out of `lint-brand-voice.ts` so they can be unit-tested: that script
 * runs its scan at import time, so a test cannot import it. Both functions
 * preserve every character offset and newline, so a caller can map a match
 * index straight back to the original line.
 */
/**
 * In a plain `.ts` file, customer copy only ever lives inside a string or
 * template literal — everything else is logic. Scanning the logic produced 12
 * of the first audit's hits from one cron job that names a local variable
 * `unmatched` (an unmatched estimate row, per METRICS-CONTRACT's own
 * vocabulary). Blank everything outside quotes, preserving offsets.
 *
 * `.tsx` is deliberately excluded: JSX body text is copy and is NOT quoted.
 */
export function keepOnlyStringLiterals(text: string): string {
  const out = text.split("");
  let i = 0;
  let inStr: '"' | "'" | "`" | null = null;
  while (i < text.length) {
    const ch = text[i];
    if (inStr) {
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === inStr) {
        out[i] = " ";
        inStr = null;
      }
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inStr = ch;
      out[i] = " ";
      i++;
      continue;
    }
    if (ch !== "\n") out[i] = " ";
    i++;
  }
  return out.join("");
}

/**
 * Blank out CSS class lists before scanning. A `className` value is never prose,
 * and the design system ships utility classes like `btn-premium` — 53 of the
 * first audit's 110 hits were that one class name. Replacing with spaces keeps
 * every index and line number intact.
 */
export function blankClassNames(text: string): string {
  return text
    .replace(/className\s*=\s*"[^"]*"/g, (m) => " ".repeat(m.length))
    .replace(/className\s*=\s*'[^']*'/g, (m) => " ".repeat(m.length))
    .replace(/className\s*=\s*\{`[^`]*`\}/g, (m) => " ".repeat(m.length))
    .replace(/className\s*=\s*\{[^}]*\}/g, (m) => " ".repeat(m.length));
}
