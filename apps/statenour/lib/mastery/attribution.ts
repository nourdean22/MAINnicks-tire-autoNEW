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
