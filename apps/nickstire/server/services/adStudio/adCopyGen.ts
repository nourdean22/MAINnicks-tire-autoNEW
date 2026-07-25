/**
 * Ad Studio — claim-safe ad COPY generation (LLM).
 *
 * The model writes only the persuasive copy for 3 cards (hook/value/offer) + the
 * IG caption. Proof + CTA cards are templated from BUSINESS facts (adTemplate),
 * so phone/address/reviews can never be hallucinated. A defensive lint flags any
 * banned word the model slips through.
 */
import { invokeLLM, type OutputSchema } from "../../_core/llm";
import { createLogger } from "../../lib/logger";
import { BUSINESS } from "@shared/business";
import type { AdCopy } from "./adTemplate";

const log = createLogger("services:adStudio:copy");

export const AD_ANGLES = {
  financing: "FINANCING-LED: '$10 down, drive today' + no-credit-check + new tires from $89. Kill the price objection first; create urgency to act now.",
  free_check: "OFFER-LED: a free tire/safety check as the no-brainer hook that drives walk-ins. Low friction, safety-forward but calm (never scary).",
  trust: "TRUST-LED: 4.9 stars / 1,700+ reviews / since 2018 / ASE-certified / 7-days walk-in. Why Cleveland keeps coming back — social proof as the engine.",
} as const;
export type AdAngle = keyof typeof AD_ANGLES;

export interface GenerateAdCopyInput {
  angle?: AdAngle;
  topic?: string; // optional operator steer (e.g. "summer road trip", "brakes")
}

const BANNED = /\b(quality|premium|luxury|tier|trusted|best|perfect|guaranteed|#1|cheapest|lowest price)\b/i;
/** "free" is allowed ONLY as a real free check/offer. */
const BAD_FREE = /\bfree\b(?!\s+(tire|brake|safety|quick|alignment|battery)?\s*check)/i;

/** Non-blocking claim-safety lint; returns human-readable issues. */
export function lintAdCopy(copy: AdCopy): string[] {
  const issues: string[] = [];
  const fields: [string, string][] = [
    ["hook", `${copy.hookYellow} ${copy.hookWhite} ${copy.hookSub}`],
    ["value", `${copy.valueWhite} ${copy.valueYellow} ${copy.valueTicks.join(" ")}`],
    ["offer", `${copy.offerYellow} ${copy.offerWhite} ${copy.offerSub}`],
    ["caption", copy.caption],
  ];
  for (const [where, text] of fields) {
    const b = text.match(BANNED);
    if (b) issues.push(`${where}: banned word "${b[0]}"`);
    if (BAD_FREE.test(text)) issues.push(`${where}: "free" used outside a "free check" offer`);
    if (/&amp;|&lt;|&gt;/.test(text)) issues.push(`${where}: HTML entity leaked (use plain &, <, >)`);
  }
  return issues;
}

function buildSystemPrompt(angle: AdAngle, topic?: string): string {
  return `You are a senior Meta-ads creative director writing copy for ONE Instagram carousel AD for a local tire shop. It will be BOOSTED with real ad spend, so every word must convert and every claim must be true.

BUSINESS FACTS (all owner-confirmed — use freely, accurately):
- ${BUSINESS.name} — "${BUSINESS.tagline}". ${BUSINESS.founded.display}. ${BUSINESS.ase.display}. ${BUSINESS.languageDisplay}.
- ${BUSINESS.reviews.rating} stars, ${BUSINESS.reviews.countDisplay} Google reviews. ${BUSINESS.address.full}. ${BUSINESS.phone.display}.
- Open 7 days, walk-ins welcome, NO appointment, first come first serve. Free quick checks.
- Financing: no credit check, $10 down, drive today (Acima/Snap/Koalafi). New tires from $89 installed. Used from $25 installed (most sizes $40-80 — the band MUST travel with $25). Any tire, any brand. Under-20-minute installs. 12-month parts / 90-day labor warranty.

ANGLE FOR THIS AD: ${AD_ANGLES[angle]}${topic ? `\nOPERATOR STEER: weave in this topic/season: ${topic}.` : ""}

HARD CLAIM-SAFETY RULES:
- BANNED words: quality, premium, luxury, tier, trusted, best, perfect, #1, guaranteed, cheapest. No superlatives, no fake guarantees, no fearmongering.
- "free" only as a real free check ("free tire check", "free brake check").
- Prices must be accurate; prefer "$10 down" and "from $89 installed" (clean). If you use "$25", pair it with "most sizes $40-80".
- Plain text only — never HTML entities (&amp;), use a literal &.

You write ONLY: the hook card, the value card (with exactly 3 short benefit ticks), the offer/free-check card, and the IG caption. (The proof + CTA cards are added automatically from real shop data — do not write them.)
- Headlines: ALL-CAPS friendly, punchy, <=4 words each part. hookYellow + hookWhite are two stacked lines of the hook headline. valueWhite + valueYellow likewise. offerYellow + offerWhite likewise.
- Subs: one short sentence.
- Ticks: 3 short benefit phrases (<=6 words each).
- Caption: lead with the hook line, scannable, ONE clear CTA, include "no appointment — walk in 7 days", the address ${BUSINESS.address.full}, phone ${BUSINESS.phone.display}, and a few local hashtags (#ClevelandTires #EuclidOhio etc). A few emojis OK.

Output ONLY one JSON object matching the schema. No prose, no markdown.`;
}

const SCHEMA: OutputSchema = {
  name: "ad_copy",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["hookYellow", "hookWhite", "hookSub", "valueWhite", "valueYellow", "valueTicks", "offerYellow", "offerWhite", "offerSub", "caption"],
    properties: {
      hookYellow: { type: "string" }, hookWhite: { type: "string" }, hookSub: { type: "string" },
      valueWhite: { type: "string" }, valueYellow: { type: "string" },
      valueTicks: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 3 },
      offerYellow: { type: "string" }, offerWhite: { type: "string" }, offerSub: { type: "string" },
      caption: { type: "string" },
    },
  },
};

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : v == null ? "" : String(v));

export interface GeneratedAd { copy: AdCopy; issues: string[]; }

/** Generate claim-safe ad copy. Throws only if the LLM returns nothing usable. */
export async function generateAdCopy(input: GenerateAdCopyInput): Promise<GeneratedAd> {
  const angle = input.angle ?? "financing";
  const res = await invokeLLM({
    messages: [
      { role: "system", content: buildSystemPrompt(angle, input.topic) },
      { role: "user", content: "Write the ad copy now. Output ONLY the JSON object." },
    ],
    maxTokens: 2048,
    timeoutMs: 60000,
    outputSchema: SCHEMA,
  });
  const content = res.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("LLM returned no ad copy");

  let s = content.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) s = fence[1].trim();
  const first = s.indexOf("{"); const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  const p = JSON.parse(s) as Record<string, unknown>;

  const ticks = Array.isArray(p.valueTicks) ? p.valueTicks.map(str).filter(Boolean) : [];
  const copy: AdCopy = {
    hookYellow: str(p.hookYellow), hookWhite: str(p.hookWhite), hookSub: str(p.hookSub),
    valueWhite: str(p.valueWhite), valueYellow: str(p.valueYellow),
    valueTicks: [ticks[0] ?? "Drive home today", ticks[1] ?? "$10 down financing", ticks[2] ?? "Any tire, any brand"],
    offerYellow: str(p.offerYellow) || "FREE", offerWhite: str(p.offerWhite) || "TIRE CHECK.",
    offerSub: str(p.offerSub), caption: str(p.caption),
  };
  const issues = lintAdCopy(copy);
  if (issues.length) log.warn("ad copy lint issues", { issues });
  return { copy, issues };
}
