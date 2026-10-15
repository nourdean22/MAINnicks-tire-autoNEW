import type { ReactNode } from "react";

/**
 * UI v3 W1a, header diet (docs/design/ui-v3/PLAN.md section 9 row 4). One shared header sits on 43
 * pages, so what it repeats is read 43 times. Two rules live here so one test file can break them.
 */

/** Home, Missions, Chat, Brain, People, Journal, Stats: no description at any width. Exact pathnames. */
export const CORE_PAGE_PATHS = ["/", "/missions", "/chat", "/brain", "/people", "/journal", "/stats"] as const;

export function isCorePage(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return (CORE_PAGE_PATHS as readonly string[]).includes(p);
}

/** "System / observability" -> ["System", "observability"]. A hyphen inside a word is not a separator. */
const SEPARATORS = /\s*(?:[·•/|>›:]|\s[-–—]\s)\s*/;
const squash = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
/** Case, punctuation and a plural s do not make a different word ("Crons" repeats "Cron"). */
const key = (s: string) =>
  squash(s)
    .split(" ")
    .map((w) => (w.length > 3 ? w.replace(/s$/, "") : w))
    .join(" ");

/**
 * True when the eyebrow adds information: some segment of it is neither the title nor the parent hub
 * label. Case, punctuation and plurals are ignored. Empty is false. A non-string node (a badge, a
 * domain code) cannot be compared, so it counts as information.
 */
export function eyebrowAddsInformation(eyebrow: ReactNode, title: string, parentLabel?: string | null): boolean {
  if (eyebrow === null || eyebrow === undefined || typeof eyebrow === "boolean") return false;
  if (typeof eyebrow !== "string") return true;
  const segments = eyebrow.split(SEPARATORS).map(key).filter(Boolean);
  if (segments.length === 0) return false;
  const known = new Set([key(title), parentLabel ? key(parentLabel) : ""].filter(Boolean));
  return !segments.every((s) => known.has(s));
}
