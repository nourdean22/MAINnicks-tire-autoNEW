/**
 * Editorial contract (2026-10-08) — the deterministic rules an editor or a
 * renderer can execute, checked on the storyboard before any spend. These are
 * the rules the readability, beat-count and length gates do NOT cover:
 *
 *   - frame one carries the subject: evidence, symptom, transformation or
 *     question — never a logo, a brand plate or a generic moving car;
 *   - one idea per card;
 *   - no beat carries a call to action — the Reel's one ask is declared once
 *     and drawn on the end card (shared/reelAsk.ts);
 *   - an end card never outstays two seconds.
 *
 * Consumed by `runReelPreflight` as WARNINGS, not blocks: a pack that opens on
 * a logo still renders, and the Studio says why it should not. The muted-first
 * rule (every beat has text) already lives in validateMutedFirstClarity, so an
 * empty beat-1 caption is not repeated here.
 *
 * 2026-10-08: the CTA rule used to read "one CTA, and it comes last", which
 * told an editor to put the ask on the last BEAT — where askLeakageProblem
 * (preflight warning, assembly hard stop) refuses it, because a CTA burned
 * into a beat is a second, permanent ask. Now a CTA in any beat is flagged.
 * Beats askSignals already recognises are left to askLeakageProblem, so the
 * Studio never says the same thing twice; this rule covers the imperative
 * phrasings that detector does not ("get it checked", "bring it in",
 * "schedule an inspection"). The verbs count only in their imperative form:
 * "one visit" and "a bumper tap" are not asks.
 */
import { askSignals } from "./reelAsk";

export interface EditorialBeat {
  beatNumber: number;
  startSecond: number;
  endSecond: number;
  visual?: string | null;
  onScreenText?: string | null;
  purpose?: string | null;
}

export type EditorialRule = "logo_never_opens" | "frame_one_subject" | "one_idea_per_card" | "cta_in_beat" | "end_card_length";

export interface EditorialFinding {
  rule: EditorialRule;
  beatNumber: number | null;
  message: string;
}

const OPENING_PLATE = /\b(logo|brand plate|end card|title card|intro animation|watermark)\b/i;
const GENERIC_OPENING = /\b(generic (?:moving )?car|stock footage|b-roll|random traffic)\b/i;
/**
 * The shop's CTA verbs, in their imperative form only (a bare "visit" or "tap"
 * is as often a noun). SAVE is the platform-native mid-reel prompt and is
 * deliberately not one.
 */
const CTA = new RegExp(
  [
    "\\bbook\\s+(?:now|online|today|an?|your|it|with)\\b",
    "\\bcall\\s+(?:us|now|today|ahead|the shop|nick'?s)\\b",
    // No "comment" branch: askSignals' comment-keyword pattern already matches
    // "comment" + any word ("COMMENT BELOW" included), and those beats are left
    // to askLeakageProblem.
    "\\bdm\\s+(?:us|me|nick'?s)\\b",
    "\\bvisit\\s+(?:us|our|the shop|nick'?s)\\b",
    "\\bbring\\s+(?:it|your|the|them)\\b",
    "\\bget\\s+(?:it|yours|them)\\s+checked\\b",
    "\\bschedule\\s+(?:an?|your|it|now|today|online)\\b",
    "\\btap\\s+(?:the|here|to|now|below)\\b",
    "\\bmessage\\s+us\\b",
  ].join("|"),
  "i",
);
const END_CARD = /\b(end card|logo card|contact card|closing card)\b/i;
const MAX_END_CARD_SECONDS = 2;
/** Above this many words a two-sentence caption is two ideas, not one. */
const ONE_IDEA_WORDS = 9;

export function checkEditorialContract(beats: EditorialBeat[]): EditorialFinding[] {
  const out: EditorialFinding[] = [];
  if (beats.length === 0) return out;
  const ordered = [...beats].sort((a, b) => a.beatNumber - b.beatNumber);
  const first = ordered[0];
  const last = ordered[ordered.length - 1];

  const firstVisual = String(first.visual ?? "");
  if (OPENING_PLATE.test(firstVisual)) {
    out.push({ rule: "logo_never_opens", beatNumber: first.beatNumber, message: `beat ${first.beatNumber}: opens on a logo or plate — frame one must carry the evidence, symptom, transformation or question; the logo belongs on the end card` });
  } else if (GENERIC_OPENING.test(firstVisual)) {
    out.push({ rule: "frame_one_subject", beatNumber: first.beatNumber, message: `beat ${first.beatNumber}: opens on generic footage — frame one needs a subject only this Reel has` });
  }

  for (const b of ordered) {
    const text = String(b.onScreenText ?? "").trim();
    if (!text) continue;
    const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
    const words = text.split(/\s+/).filter(Boolean).length;
    if (sentences.length >= 2 && words > ONE_IDEA_WORDS) {
      out.push({ rule: "one_idea_per_card", beatNumber: b.beatNumber, message: `beat ${b.beatNumber}: ${sentences.length} sentences and ${words} words on one card — one idea per card; split the beat or cut the second idea` });
    }
    if (CTA.test(text) && askSignals(text).length === 0) {
      out.push({ rule: "cta_in_beat", beatNumber: b.beatNumber, message: `beat ${b.beatNumber}: a call to action in a beat ("${text.slice(0, 60)}") — beats carry no ask; the Reel's one ask is declared once and drawn on the end card` });
    }
  }

  const lastSeconds = Number(last.endSecond) - Number(last.startSecond);
  if (END_CARD.test(String(last.visual ?? "")) && lastSeconds > MAX_END_CARD_SECONDS) {
    out.push({ rule: "end_card_length", beatNumber: last.beatNumber, message: `beat ${last.beatNumber}: an end card held for ${lastSeconds}s — two seconds at most` });
  }
  return out;
}
