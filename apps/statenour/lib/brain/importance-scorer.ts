/**
 * Importance Scorer — classifies every user chat message and auto-
 * persists the signal without asking Nour. Apr 18.
 *
 * The bet: Nour says things in chat that deserve to become durable
 * memory, but the friction of "should I save this?" kills persistence.
 * This scorer runs fire-and-forget after every user turn. Most messages
 * score low (0-3) and nothing happens. High scorers (≥6) auto-write
 * BrainMemory rows tagged by category so contextual-recall + the
 * graph + Nick's future system prompts can all see them.
 *
 * Categories it detects:
 *   decision      — Nour chose something ("I'm going to do X")
 *   preference    — ongoing taste/stance ("I prefer X over Y")
 *   commitment    — promise to self or other ("I'll have X by Friday")
 *   contradiction — conflicts with a prior stated value
 *   person        — new or re-mentioned person with context
 *   insight       — observation or learning about himself
 *   win           — something that went well worth remembering
 *   pain          — friction/frustration/blockage
 *
 * Heuristic-first pass (fast, free, works offline). AI-assisted pass
 * optional for messages that pass the heuristic threshold — lets us
 * extract structured fields (entities, promised-to, deadline).
 */

import { prisma } from "@/lib/prisma";
import { logger as rootLogger } from "@/lib/logger";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

const log = rootLogger.withSurface("brain/importance-scorer");

export type ImportanceCategory =
  | "decision"
  | "preference"
  | "commitment"
  | "contradiction"
  | "person"
  | "insight"
  | "win"
  | "pain";

export interface ImportanceScore {
  score: number;                       // 0-10 aggregate
  categories: ImportanceCategory[];    // all matched
  primary: ImportanceCategory | null;  // highest-signal one
  reason: string;                      // short human-readable why
  extracted?: {
    person?: string | null;
    deadline?: string | null;
    topic?: string | null;
  };
}

// ── Heuristic patterns (hand-tuned for Nour's voice) ──────────────────

// Decision language — "I'm going to", "I decided", "locking in"
const DECIDE_RX = [
  /\b(i'?m going to|i decided|i'?m locking in|i'?ll just|i'?m gonna|let'?s do|going with)\b/i,
  /\b(i'?ve decided|made the call|settled on|picked)\b/i,
];

// Preference — "I prefer", "I hate", "I love", "I like better"
const PREF_RX = [
  /\bi (really )?(prefer|like|love|hate|can'?t stand|dislike|enjoy)\b/i,
  /\b(rather|instead of|over)\b.*\b(would|should|want)\b/i,
];

// Commitment — "I'll X by Y", "by Friday", explicit timeline
const COMMIT_RX = [
  /\b(i'?ll|i will|i promise|will do|sending|getting done|finishing)\b.*\b(today|tomorrow|by (mon|tue|wed|thu|fri|sat|sun|end of|eod)|this week|next week|tonight|morning)\b/i,
  /\b(by|before) (eod|noon|monday|tuesday|wednesday|thursday|friday|saturday|sunday|tonight|tomorrow)\b/i,
];

// Contradiction — hedging or inverting past stance
const CONTRADICT_RX = [
  /\b(actually|on second thought|i was wrong|changed my mind|scratch that|never mind|disregard)\b/i,
  /\b(even though i said|despite saying|i know i said)\b/i,
];

// Person mention — named humans, relationships
const PERSON_RX =
  /\b(dania|aimen|aimén|nick|dad|mom|brother|sister|wife|cousin|customer|vendor|tech|employee)\b/i;

// Insight — self-observation
const INSIGHT_RX = [
  /\b(i (just )?(noticed|realized|figured out|caught myself)|i keep|i always|every time i)\b/i,
  /\b(the pattern is|what i see is|the thing about me)\b/i,
];

// Win — completion + positive affect
const WIN_RX = [
  /\b(just finished|just shipped|got done|knocked out|nailed it|crushed|finally (did|finished|got))\b/i,
  /\b(feels good|proud of|huge win|massive|breakthrough)\b/i,
];

// Pain — friction words
const PAIN_RX = [
  /\b(stuck|blocked|frustrated|pissed|annoyed|can'?t figure|this is stupid|fucking|burned out|overwhelmed)\b/i,
  /\b(why (doesn'?t|isn'?t|won'?t)|i hate when|keeps breaking)\b/i,
];

/**
 * Score a single user message. Pure function — no IO, no AI call.
 * Designed to run inline after the chat route saves a user message
 * without blocking the response stream.
 */
export function scoreMessage(content: string): ImportanceScore {
  const text = content.trim();
  const length = text.length;
  if (length < 20) {
    return { score: 0, categories: [], primary: null, reason: "too short" };
  }

  const categories: ImportanceCategory[] = [];
  const scoreParts: Array<{ cat: ImportanceCategory; weight: number }> = [];

  const hit = (rx: RegExp | RegExp[]): boolean => {
    if (Array.isArray(rx)) return rx.some((r) => r.test(text));
    return rx.test(text);
  };

  if (hit(DECIDE_RX))      { categories.push("decision");      scoreParts.push({ cat: "decision", weight: 3 }); }
  if (hit(COMMIT_RX))      { categories.push("commitment");    scoreParts.push({ cat: "commitment", weight: 3 }); }
  if (hit(CONTRADICT_RX))  { categories.push("contradiction"); scoreParts.push({ cat: "contradiction", weight: 3 }); }
  if (hit(INSIGHT_RX))     { categories.push("insight");       scoreParts.push({ cat: "insight", weight: 3 }); }
  if (hit(WIN_RX))         { categories.push("win");           scoreParts.push({ cat: "win", weight: 2 }); }
  if (hit(PAIN_RX))        { categories.push("pain");          scoreParts.push({ cat: "pain", weight: 2 }); }
  if (hit(PREF_RX))        { categories.push("preference");    scoreParts.push({ cat: "preference", weight: 2 }); }

  // Person mention by itself is weak; only adds signal if paired with
  // another category.
  const mentionsPerson = hit(PERSON_RX);
  if (mentionsPerson && categories.length > 0) {
    categories.push("person");
    scoreParts.push({ cat: "person", weight: 1 });
  }

  // Length bonus — a long thoughtful message is higher signal even
  // without keyword hits. Caps at +2.
  const lengthBonus = Math.min(2, Math.floor(length / 200));

  // Questions are usually low-signal unless they reveal a struggle.
  const endsQuestion = /[?]\s*$/.test(text);
  const questionPenalty = endsQuestion && !hit(PAIN_RX) && !hit(INSIGHT_RX) ? -2 : 0;

  const rawScore = scoreParts.reduce((a, p) => a + p.weight, 0) + lengthBonus + questionPenalty;
  const score = Math.max(0, Math.min(10, rawScore));

  // Primary = category with highest weight
  // v10.0.35 — explicit tiebreaker via .localeCompare. Pre-fix
  // equal-weight signals (e.g. decision + commitment both at
  // weight 3) relied on V8's sort being stable, which is true in
  // Node 11+ but fragile. Same input could pick a different
  // primary across runs, changing which downstream pipeline fired
  // (contradiction surfacer reacts to decision/preference/commitment
  // primaries differently). Deterministic now.
  const primary = scoreParts.length > 0
    ? [...scoreParts].sort(
        (a, b) => b.weight - a.weight || a.cat.localeCompare(b.cat),
      )[0].cat
    : null;

  // Human-readable reason for the audit trail
  const reason = categories.length > 0
    ? `matched ${categories.join(", ")}${lengthBonus > 0 ? ` · length+${lengthBonus}` : ""}${questionPenalty ? ` · question-2` : ""}`
    : lengthBonus > 0
      ? `long-form (+${lengthBonus})`
      : "no signal";

  // Extract light entities — person name if mentioned
  let personMatch: string | null = null;
  if (mentionsPerson) {
    const match = text.match(PERSON_RX);
    personMatch = match?.[0] ?? null;
  }

  return {
    score,
    categories,
    primary,
    reason,
    extracted: personMatch ? { person: personMatch } : undefined,
  };
}

/**
 * Fire-and-forget persistence. Writes a BrainMemory row when the
 * score clears the threshold. Category is `chat_importance` with a
 * content-nested `primary` tag so downstream filters can still
 * group by what made the message important.
 *
 * Keyed by message id so repeat calls don't dupe — upsert semantic.
 */
export async function persistIfImportant(
  messageId: string,
  content: string,
  conversationId: string,
  /**
   * 2026-08-06 · LOWERED 6 -> 4, measured. See
   * scripts/calibrate-importance-threshold.ts — it runs THIS function's
   * scoreMessage over every real user message in prod and prints the
   * histogram, so the number below is observed rather than guessed.
   *
   * THE PROBLEM · `chat_importance` held 10 rows in the 3.5 months to
   * 2026-08-06. That starves the contradiction detector, which needs BOTH the
   * fresh row AND its neighbour to be chat_importance, >= 7 days apart, and
   * >= 0.78 similar. A 10-row pool cannot produce such a pair, which is why
   * `contradiction` sat at 0 rows and its /chat block fired 0/1417 turns.
   *
   * THE MEASUREMENT · 1,711 user messages over 113 days:
   *
   *   threshold  admitted/mo   contradiction-eligible/mo
   *        6         4.8              2.4      <- was here
   *        5         9.0              4.3
   *        4        17.3              7.7      <- now here
   *        3        27.9             12.0
   *        1        33.2             15.2
   *
   * WHY 4 · it roughly TRIPLES the contradiction-eligible pool (2.4 -> 7.7 a
   * month) while still demanding corroboration: score 4 means one strong
   * signal plus length or a person mention, or two moderate signals — never a
   * single bare keyword. Score 3 would admit one unsupported regex hit.
   * Candidate PAIRS scale ~n², so ~3x the rows is ~10x the pairs the detector
   * can actually work with.
   *
   * WHY THE OLD GARBAGE-POOL FEAR DOES NOT APPLY · the v9.1.25 note below
   * records that low-score rows once formed "a multi-thousand-row garbage
   * pool". Two things make that unreachable now. First, it is not volume-
   * reproducible: `primary != null` — not the threshold — is the real gate,
   * and only 125 of 1,711 messages (7.3%) earn a primary at all. Admitting
   * EVERY one of them (threshold 1) still yields 125 rows per 113 days.
   * Second, the very same v9.1.25 change added `expiresAt` for score < 8, so
   * sub-promotion rows now decay after 30 days instead of accumulating
   * forever — that fix is what made the high threshold unnecessary. Steady
   * state at 4 is roughly one month of admissions (~17 live rows), not
   * thousands.
   *
   * Re-run the calibration script before changing this again.
   */
  threshold: number = 4,
): Promise<{ persisted: boolean; score: number; category: ImportanceCategory | null }> {
  const result = scoreMessage(content);
  if (result.score < threshold || !result.primary) {
    return { persisted: false, score: result.score, category: null };
  }

  const key = `chat:${messageId}`;
  const storedContent = JSON.stringify({
    excerpt: content.slice(0, 500),
    score: result.score,
    primary: result.primary,
    categories: result.categories,
    reason: result.reason,
    extracted: result.extracted ?? null,
    conversationId,
    at: new Date().toISOString(),
  });

  // v9.1.25 · floor confidence at 0.5 for at-threshold scores.
  // Previously: score=6 → 0.45 (sub-promotion-threshold), score=7 →
  // 0.55, score=10 → 0.85. Score-6 rows accumulated PERMANENTLY in
  // BrainMemory because:
  //   - their confidence (0.45) was below the memory_promotion
  //     trigger (0.6), so they never graduated to wisdom
  //   - they had no expiresAt, so brainMemory.decay() never touched
  //     them
  //   - they kept getting written on every borderline chat message
  // Over months this becomes a multi-thousand-row garbage pool.
  // Fix: floor confidence at 0.5; ALSO set expiresAt for score<8
  // rows so the decay cron can prune them after 30d of no
  // reinforcement. High-confidence rows (8-10) stay permanent.
  const confidence = Math.max(0.5, Math.min(0.85, 0.55 + (result.score - 7) * 0.1));
  const expiresAt =
    result.score < 8
      ? new Date(Date.now() + 30 * 86_400_000) // 30 days
      : null;

  const persisted = await prisma.brainMemory
    .upsert({
      where: { category_key: { category: BRAIN_CATEGORIES.CHAT_IMPORTANCE, key } },
      create: {
        category: BRAIN_CATEGORIES.CHAT_IMPORTANCE,
        key,
        content: storedContent,
        confidence,
        source: "importance_scorer",
        expiresAt,
      },
      update: {
        content: storedContent,
        confidence,
        lastSeen: new Date(),
        seenCount: { increment: 1 },
      },
      select: { id: true },
    })
    .catch((err) => {
      log.warn("persist_failed", { error: err instanceof Error ? err.message : String(err) });
      return null as { id: string } | null;
    });

  // ── Contradiction surfacer ──
  // When a new decision/preference/commitment lands, check whether
  // it conflicts with a prior one. Fire-and-forget so the persist
  // path stays non-blocking. The eligibility guard + similarity
  // threshold live inside the surfacer — this call is always safe.
  if (persisted?.id && (result.primary === "decision" || result.primary === "preference" || result.primary === "commitment")) {
    void (async () => {
      try {
        const { surfaceContradictions } = await import("./contradiction-surfacer");
        await surfaceContradictions(persisted.id);
      } catch (err) {
        log.warn("contradiction_surfacer_failed", { error: err instanceof Error ? err.message : String(err) });
      }
    })();
  }

  return { persisted: true, score: result.score, category: result.primary };
}
