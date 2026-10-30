/**
 * lib/wisdom/maxims.ts · the Home maxim (Nour, 2026-10-29: "a rotating wisdom maxim comprised of all the books",
 * then "simpler so I can understand better and more practical for real world").
 *
 * Pure: the pool comes in as data (lib/wisdom/maxim-pool.ts reads data/wisdom/maxims/*.json), so the pick is
 * testable without the files. One plain one-liner at a time:
 *   - it matches today's top line when a tag fits (the Home brief's lead headline, already on the page;
 *     no model call), else it is the plain rotation;
 *   - the pick is keyed on the ET date-hour, so it holds still while Nour looks at it (never per render);
 *   - Next steps through the same candidate list; a skipped maxim never shows.
 */
import { stableIndex } from "@/lib/utils/stable-index";

/** The fixed tag list the maxim files use (data/wisdom/maxims, PR 3364). */
export const MAXIM_TAGS = [
  "customers",
  "people",
  "money",
  "timing",
  "focus",
  "conflict",
  "hiring",
  "reputation",
  "learning",
  "decisions",
  "health",
] as const;
export type MaximTag = (typeof MAXIM_TAGS)[number];

export interface MaximEntry {
  text: string;
  /** The label to show, e.g. "Greene · 48 Laws", "Gracián", "Naval". */
  source: string;
  ref: string;
  tags: string[];
}

export interface MaximPack {
  pack: string;
  entries: MaximEntry[];
}

export interface Maxim extends MaximEntry {
  /** `${pack}:${ref}`, unique across packs: the Keep and Skip key. */
  id: string;
}

export function buildMaximPool(packs: readonly MaximPack[]): Maxim[] {
  return packs.flatMap((p) => p.entries.map((e) => ({ ...e, id: `${p.pack}:${e.ref}` })));
}

/** Words in a task or decision line that point at a tag. Whole-word, case-insensitive. */
const TAG_WORDS: Record<MaximTag, RegExp> = {
  customers: /\b(customers?|clients?|estimates?|quotes?|follow[- ]?ups?|call ?backs?|walk[- ]?ins?|tires?|bookings?)\b/i,
  people: /\b(crew|team|staff|employees?|mash|manny|zach|partners?|family)\b/i,
  money: /\b(price|prices|pricing|pay|paid|cash|invoices?|revenue|profit|costs?|budget|bills?|loans?|tax|taxes|money)\b/i,
  timing: /\b(deadline|late|overdue|schedule|tomorrow|today|tonight|wait|waiting)\b/i,
  focus: /\b(focus|plan|priority|priorities|next move|distract\w*)\b/i,
  conflict: /\b(dispute|complaint|complain\w*|angry|argument|refund|chargeback|conflict)\b/i,
  hiring: /\b(hire|hiring|interview\w*|candidates?|recruit\w*)\b/i,
  reputation: /\b(reviews?|rating|reputation|brand|google)\b/i,
  learning: /\b(learn\w*|read|reading|study|course|book|practice)\b/i,
  decisions: /\b(decide|decision|decisions|approve|approval|approvals|choose|options?)\b/i,
  health: /\b(health|sleep|gym|workout|weight|doctor|rest|tired)\b/i,
};

export function tagsForText(text: string): Set<MaximTag> {
  const out = new Set<MaximTag>();
  if (!text) return out;
  for (const tag of MAXIM_TAGS) if (TAG_WORDS[tag].test(text)) out.add(tag);
  return out;
}

/** "2026-10-29T21" in America/New_York: the pick changes on the hour, not on a re-render. */
export function etHourKey(at: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour").replace("24", "00")}`;
}

/** "for: the estimate follow-up" from the line that matched, at most four words, or null. */
function reasonFor(context: string): string | null {
  const words = context.replace(/[^\p{L}\p{N}' -]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  return `for: ${words.slice(0, 4).join(" ").toLowerCase()}`;
}

export interface MaximPick {
  maxim: Maxim;
  /** Why this one, in a few words, only when today's line matched a tag. */
  reason: string | null;
  /** 1-based place in the candidate list and its size, so "Next" has an end it can say. */
  position: number;
  total: number;
}

export function pickMaxim(args: {
  pool: readonly Maxim[];
  skipped: ReadonlySet<string>;
  /** Today's top line (the brief's lead headline); empty means plain rotation. */
  context?: string | null;
  at: Date;
  /** How many times Next was tapped this visit. */
  step?: number;
}): MaximPick | null {
  const open = args.pool.filter((m) => !args.skipped.has(m.id));
  if (open.length === 0) return null;
  const context = (args.context ?? "").trim();
  const want = tagsForText(context);
  const matched = want.size > 0 ? open.filter((m) => m.tags.some((t) => want.has(t as MaximTag))) : [];
  const candidates = matched.length > 0 ? matched : open;
  const base = stableIndex(etHourKey(args.at), candidates.length);
  const i = (base + Math.max(0, Math.floor(args.step ?? 0))) % candidates.length;
  return {
    maxim: candidates[i]!,
    reason: matched.length > 0 ? reasonFor(context) : null,
    position: i + 1,
    total: candidates.length,
  };
}

/** The Skip marker: a 30-day expiring BrainMemory row (category below), read by key. */
export const MAXIM_SKIP_CATEGORY = "maxim_skip";
export const MAXIM_SKIP_DAYS = 30;
