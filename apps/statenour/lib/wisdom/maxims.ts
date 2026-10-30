/**
 * lib/wisdom/maxims.ts · the Home maxim (Nour, 2026-10-29: "a rotating wisdom maxim comprised of all the books",
 * then "simpler so I can understand better and more practical for real world").
 *
 * Pure: the pool comes in as data (lib/wisdom/maxim-pool.ts reads data/wisdom/maxims/*.json), so the pick is
 * testable without the files. One plain one-liner at a time:
 *   - it matches today's top line when a tag fits: the client reads tags off the brief's lead headline
 *     (tagsForText, no model call) and sends only the tags, never the text; else it is the plain rotation;
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
    hourCycle: "h23", // midnight is "00", never "24"
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}`;
}


export interface MaximPick {
  maxim: Maxim;
  /**
   * Why this one: the maxim's first tag the asked-for tags also carry, never the required tag (a decision page
   * saying "for this decision: decisions" says nothing), or null. Each surface words it: "for today: customers"
   * on Home, "for this approval: money" on an approval whose reason mentions an invoice.
   */
  topic: MaximTag | null;
  /** 1-based place in the candidate list and its size, so "Next" has an end it can say. */
  position: number;
  total: number;
}

export function pickMaxim(args: {
  pool: readonly Maxim[];
  skipped: ReadonlySet<string>;
  /** Tags read off today's top line on the client (tagsForText); empty means plain rotation. */
  tags?: readonly MaximTag[];
  /** A tag every pick must carry (a decision surface requires "decisions"); `tags` then only narrow within it. */
  require?: MaximTag;
  at: Date;
  /** How many times Next was tapped this visit. */
  step?: number;
}): MaximPick | null {
  const open = args.pool.filter((m) => !args.skipped.has(m.id));
  if (open.length === 0) return null;
  const req = args.require;
  const allowed = req ? open.filter((m) => m.tags.includes(req)) : open;
  if (allowed.length === 0) return null;
  const want: ReadonlySet<MaximTag> = new Set(args.tags ?? []);
  const matched = want.size > 0 ? allowed.filter((m) => m.tags.some((t) => want.has(t as MaximTag))) : [];
  const candidates = matched.length > 0 ? matched : allowed;
  const base = stableIndex(etHourKey(args.at), candidates.length);
  const i = (base + Math.max(0, Math.floor(args.step ?? 0))) % candidates.length; // Next wraps past the end
  const maxim = candidates[i]!;
  return {
    maxim,
    topic: (maxim.tags.find((t) => t !== req && want.has(t as MaximTag)) as MaximTag | undefined) ?? null,
    position: i + 1,
    total: candidates.length,
  };
}

/**
 * The Monday brief's pick (lib/services/morning-brief.ts): only maxims carrying `tag`, keyed on the ET
 * date, so a brief rebuilt the same day agrees. Null when no maxim has the tag (no fallback: the brief
 * line names the number it applies to, so an off-topic maxim would be filler).
 */
export function pickMaximForDay(pool: readonly Maxim[], tag: string, dayIso: string): Maxim | null {
  const tagged = pool.filter((m) => m.tags.includes(tag));
  return tagged.length > 0 ? tagged[stableIndex(dayIso, tagged.length)]! : null;
}

/** Keep writes a pinned_user row with this source; it rides recall, not the six prompt pin slots. */
export const MAXIM_KEEP_SOURCE = "home:maxim-keep";

/** The Skip marker: a 30-day expiring BrainMemory row (category below), read by key. */
export const MAXIM_SKIP_CATEGORY = "maxim_skip";
export const MAXIM_SKIP_DAYS = 30;
