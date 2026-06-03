/**
 * Mastery attribution · Slice 2 · 2026-05-30 · the "rep detector".
 *
 * Decides which stat a life-signal exercised + how much XP. Two modes:
 *  · RULE-BASED (free, instant) — for structured signals like habits,
 *    map the known category → a stat.
 *  · AI (cheap, gpt-4o-mini via tracedAiChat "reason") — for unstructured
 *    signals (journal / chat / email), classify into ONE stat + XP. This
 *    is the "caught in the journal" magic. Mirrors classify-task-mission.
 *
 * Both fail safe (null) so a signal that exercises no real skill earns
 * nothing — XP only means something if not everything gives it.
 */
import "server-only";

import { tracedAiChat } from "@/lib/ai/traced-aichat";
import { DOMAINS, HABITS } from "./config";

// ─── Rule-based · habit category → stat ─────────────────────────────
const HABIT_CATEGORY_DOMAIN: Record<string, string> = {
  physical: "physical",
  mental: "mental",
  business: "business_ops",
  marketing: "marketing",
  financial: "financial",
  discipline: "mental",
  spiritual: "mental",
  skills: "technical",
};

/** The stat a completed habit exercises (null if its category has no
 *  mapped stat). Free — no AI. */
export function attributeHabit(habitKey: string): string | null {
  const h = HABITS.find((x) => x.key === habitKey);
  if (!h) return null;
  return HABIT_CATEGORY_DOMAIN[h.category] ?? null;
}

// ─── AI · unstructured signal → stat + XP ───────────────────────────
export interface TextAttribution {
  stat: string;
  xp: number;
  evidence: string;
}

const VALID_STATS = new Set<string>(DOMAINS.map((d) => d.key));

const SYSTEM_PROMPT = `You score an operator's life-signal against their mastery stats.
STATS (return the key, never the label):
${DOMAINS.map((d) => `- ${d.key}: ${d.label}`).join("\n")}

Given ONE signal (a journal entry, chat message, or email), return ONE JSON object:
{ "stat": "<one stat key> | null", "xp": 0-3, "evidence": "<=80 char why" }

RULES:
- stat=null when the signal exercises NO real skill (logistics, small talk, noise).
- Pick the SINGLE stat most exercised — not a list.
- xp scale: 0.5 trivial · 1 a normal rep · 2 meaningful work · 3 a genuine breakthrough.
- evidence: plain, <=80 chars, no preamble.
- Return ONLY the JSON object. No markdown fences, no commentary.`;

/**
 * Attribute an unstructured signal to a stat via the cheap classifier.
 * `signalLabel` (journal/chat/email) just tags the trace. Returns null on
 * no-skill / parse failure / unknown stat — never throws.
 */
export async function attributeText(
  text: string,
  signalLabel: string,
): Promise<TextAttribution | null> {
  const body = text.trim().slice(0, 800);
  if (body.length < 12) return null;
  try {
    const res = await tracedAiChat(
      { label: `mastery-attribute:${signalLabel}`, source: "tool" },
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: body },
      ],
      "reason",
    );
    const t = res.content?.trim();
    if (!t) return null;
    const cleaned = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const p = JSON.parse(cleaned) as {
      stat: string | null;
      xp: number;
      evidence: string;
    };
    if (!p.stat || !VALID_STATS.has(p.stat)) return null;
    const xp = Math.min(3, Math.max(0, Number(p.xp) || 0));
    if (xp <= 0) return null;
    return {
      stat: p.stat,
      xp: Math.round(xp * 10) / 10,
      evidence: String(p.evidence ?? "").slice(0, 120),
    };
  } catch {
    return null;
  }
}

// ─── AI · BATCHED unstructured signals → stats (backfill fast-path) ──────
//
// One AI call scores a whole batch of signals — ~10-15x fewer calls than
// attributeText-per-item, which is what the serialized "reason" tier caps on.
// Returns a Map keyed by each item's `id`; an item that exercises no skill (or
// that the model omits / mis-returns) simply isn't in the map → it earns
// nothing this run and is retried on the next idempotent pass. Never throws.
const BATCH_SYSTEM_PROMPT = `You score an operator's life-signals against their mastery stats.
STATS (return the key, never the label):
${DOMAINS.map((d) => `- ${d.key}: ${d.label}`).join("\n")}

You are given a NUMBERED list of signals (each a journal entry, chat message, or email). Return a JSON ARRAY — ONE object ONLY for each signal that exercises a REAL skill:
{ "n": <the signal's number>, "stat": "<one stat key>", "xp": 0-3, "evidence": "<=80 char why" }

RULES:
- OMIT a signal entirely when it exercises NO real skill (logistics, small talk, noise).
- Pick the SINGLE stat most exercised per signal — not a list.
- xp scale: 0.5 trivial · 1 a normal rep · 2 meaningful work · 3 a genuine breakthrough.
- evidence: plain, <=80 chars, no preamble.
- Return ONLY the JSON array. No markdown fences, no commentary.`;

export async function attributeTextBatch(
  items: { id: string; text: string }[],
  signalLabel: string,
): Promise<Map<string, TextAttribution>> {
  const out = new Map<string, TextAttribution>();
  const valid = items.filter((it) => it.text.trim().length >= 12);
  if (valid.length === 0) return out;
  const numbered = valid
    .map((it, idx) => `[${idx + 1}] ${it.text.trim().slice(0, 500)}`)
    .join("\n\n");
  try {
    const res = await tracedAiChat(
      { label: `mastery-attribute-batch:${signalLabel}`, source: "tool" },
      [
        { role: "system", content: BATCH_SYSTEM_PROMPT },
        { role: "user", content: numbered },
      ],
      "reason",
    );
    const t = res.content?.trim();
    if (!t) return out;
    const cleaned = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const parsed = JSON.parse(cleaned) as Array<{
      n: number;
      stat: string | null;
      xp: number;
      evidence: string;
    }>;
    if (!Array.isArray(parsed)) return out;
    for (const p of parsed) {
      const idx = Number(p?.n) - 1;
      if (!Number.isInteger(idx) || idx < 0 || idx >= valid.length) continue;
      if (!p.stat || !VALID_STATS.has(p.stat)) continue;
      const xp = Math.min(3, Math.max(0, Number(p.xp) || 0));
      if (xp <= 0) continue;
      out.set(valid[idx].id, {
        stat: p.stat,
        xp: Math.round(xp * 10) / 10,
        evidence: String(p.evidence ?? "").slice(0, 120),
      });
    }
  } catch {
    return out; // parse/AI failure → empty → items retried next run
  }
  return out;
}
