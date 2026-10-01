/**
 * facebookVariant — turn an Instagram caption (+ the creative thesis) into a
 * Facebook-native caption. README §G: "FB Reel: same reel, FB caption variant";
 * Meta A1/A2: nothing is cropped-and-reposted, each surface gets a native text.
 *
 * PURE and DETERMINISTIC — no LLM, no randomness, no I/O. Same input, same
 * output, so a test can pin every transform and a publish log can be replayed.
 *
 * What changes between the two surfaces (and why):
 *   - Hashtag wall → gone. Facebook distribution does not key on hashtags the
 *     way IG does, and a 15-tag block reads as spam in a Page post. At most
 *     two survive, inline at the end.
 *   - IG-only mechanics ("link in bio", "DM us", "save this", "double tap") →
 *     rewritten: a Page post can carry the URL and takes messages directly.
 *   - Opens with the thesis as a plain sentence, then the body as short
 *     paragraphs — Facebook readers see the full text, IG truncates at 125.
 *   - Ends with ONE question for the comments (comment depth is the FB
 *     objective in §G) and a local sign-off naming the shop and the street.
 */
import { BUSINESS } from "@shared/business";

export interface FacebookVariantInput {
  igCaption: string;
  /** The Creative Thesis (mechanic truth + customer tension). Leads the post when present. */
  thesis?: string;
  /** Explicit question for the comments; derived from the topic lexicon when absent. */
  question?: string;
  /** Topic hint (e.g. "tires", "brakes") for the question lexicon when the caption is ambiguous. */
  topic?: string;
}

export interface FacebookVariant {
  caption: string;
  /** Hashtags that survived (max 2, no leading #). */
  hashtags: string[];
  question: string;
  /** Transform receipts, for the publish log. */
  notes: string[];
}

export const MAX_FB_HASHTAGS = 2;

const QUESTION_BY_TOPIC: Array<[RegExp, string]> = [
  [/\btires?\b|\btread\b|\bpothole/i, "How old is the set of tires on your car right now — do you actually know?"],
  [/\bbrakes?\b|\brotor/i, "What was the first brake sound you ever ignored for too long?"],
  [/check engine|\bcode\b|\bdiagnos/i, "Is your check-engine light on right now? How long has it been on?"],
  [/\boil\b/i, "When was your last oil change — month, or mileage?"],
  [/\bbattery\b|won'?t start|\balternator/i, "Has your car ever refused to start on a cold Cleveland morning? Where were you?"],
  [/\balignment\b|\bpull(s|ing)? (to|left|right)/i, "Does your steering wheel sit straight when you're driving straight?"],
  [/\bac\b|\ba\/c\b|\bheat(er|ing)?\b|\bcooling\b|overheat/i, "Heat or A/C — which one quit on you first?"],
  [/\bwinter\b|\bsnow\b|\bsalt\b/i, "What's the one winter car problem you deal with every single year?"],
];
const DEFAULT_QUESTION = "What's the one car noise you've been putting off? Tell us below — we'll say what it usually is.";

const IG_MECHANICS: Array<[RegExp, string]> = [
  [/\(?link in (our )?bio\)?/gi, "the details are on nickstire.org"],
  [/\bdm us\b/gi, "message the Page"],
  [/\bsend us a dm\b/gi, "message the Page"],
  [/\bdouble[- ]tap\b/gi, "say so below"],
  [/\bsave this (post|reel|one)\b/gi, "share this with someone who needs it"],
  [/\btap the link\b/gi, "the link is right here"],
  [/\bswipe\b( left| right| up)?/gi, "read on"],
  [/\bfollow (us )?for more\b/gi, "like the Page for more"],
];

const HASHTAG_RE = /#[\p{L}\p{N}_]+/gu;

function isHashtagWallLine(line: string): boolean {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  const tags = tokens.filter((t) => t.startsWith("#")).length;
  return tags / tokens.length >= 0.5;
}

/** Collapse whitespace, trim, keep a trailing period on a sentence. */
function tidy(s: string): string {
  return s.replace(/[ \t]+/g, " ").replace(/ +([,.!?])/g, "$1").trim();
}

export function deriveQuestion(text: string, topic?: string): string {
  const probe = `${topic ?? ""} ${text}`;
  for (const [re, q] of QUESTION_BY_TOPIC) if (re.test(probe)) return q;
  return DEFAULT_QUESTION;
}

export function buildFacebookCaption(input: FacebookVariantInput): FacebookVariant {
  const notes: string[] = [];
  const lines = input.igCaption.replace(/\r/g, "").split("\n");

  // 1. Pull the hashtag wall out (whole lines that are mostly tags) and
  //    collect every tag in order of appearance for the survivors.
  const allTags: string[] = [];
  for (const m of input.igCaption.matchAll(HASHTAG_RE)) {
    const t = m[0].slice(1);
    if (!allTags.some((x) => x.toLowerCase() === t.toLowerCase())) allTags.push(t);
  }
  const bodyLines = lines.filter((l) => !isHashtagWallLine(l));
  if (bodyLines.length !== lines.length) notes.push(`removed ${lines.length - bodyLines.length} hashtag-wall line(s)`);

  // 2. Strip inline hashtags from the body ("#brakes done" → "brakes done").
  let body = bodyLines.join("\n").replace(HASHTAG_RE, (m) => m.slice(1));
  if (allTags.length) notes.push(`${allTags.length} hashtag(s) found, ${Math.min(allTags.length, MAX_FB_HASHTAGS)} kept`);

  // 3. Rewrite IG-only mechanics.
  for (const [re, replacement] of IG_MECHANICS) {
    if (re.test(body)) {
      body = body.replace(re, replacement);
      notes.push(`rewrote IG mechanic ${re.source}`);
    }
    re.lastIndex = 0;
  }

  // 4. Paragraphs: split on blank lines, then on sentence boundaries so no
  //    paragraph runs past ~2 sentences (Facebook shows the full text; short
  //    paragraphs read, walls do not).
  const paragraphs: string[] = [];
  for (const chunk of body.split(/\n\s*\n/)) {
    const text = tidy(chunk.replace(/\n/g, " "));
    if (!text) continue;
    // Split only at punctuation FOLLOWED BY whitespace, so "nickstire.org" and
    // "7 a.m." stay whole (the first cut split the domain in two).
    const sentences = text.split(/(?<=[.!?]["')\]]?)\s+/).map((x) => x.trim()).filter(Boolean);
    for (let i = 0; i < sentences.length; i += 2) paragraphs.push(sentences.slice(i, i + 2).join(" "));
  }

  // 5. Lead with the thesis unless the body already opens with it.
  const thesis = input.thesis ? tidy(input.thesis) : "";
  if (thesis) {
    const first = (paragraphs[0] ?? "").toLowerCase();
    if (!first.startsWith(thesis.toLowerCase().slice(0, 40))) {
      paragraphs.unshift(/[.!?]$/.test(thesis) ? thesis : `${thesis}.`);
      notes.push("thesis leads");
    }
  }

  // 6. One question for the comments + a local sign-off.
  const question = input.question ? tidy(input.question) : deriveQuestion(`${thesis} ${body}`, input.topic);
  const hashtags = allTags.slice(0, MAX_FB_HASHTAGS);
  const signoff = `${BUSINESS.name ?? "Nick's Tire & Auto"} · ${BUSINESS.address.street}, ${BUSINESS.address.city} · walk in 7 days · ${BUSINESS.phone.display}`;
  const tail = hashtags.length ? `${signoff}\n${hashtags.map((t) => `#${t}`).join(" ")}` : signoff;

  const caption = [...paragraphs, question, tail].join("\n\n");
  return { caption, hashtags, question, notes };
}
