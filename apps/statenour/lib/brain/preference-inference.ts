/**
 * Arc B Feature 1 · Preference Inference Engine · v10.0.526
 *
 * Watches every thumbs-up / thumbs-down on assistant replies and
 * infers an 8-axis style preference vector for the operator. The
 * vector is applied as a system-prompt addendum on every turn,
 * self-tuning weekly via a folded cron inside mega-evening (Sunday
 * only).
 *
 * NO NEW TABLES. The vector lives inside `OperatorPreference.
 * voiceToneBoundaries` (existing `Json?` column) under the key
 * `preferenceVector`. The other keys (no_abuse, concise, direct)
 * are left untouched.
 *
 * Axes (all clamped to [-1.0, 1.0], default 0.0):
 *
 *   density       terse(-1) ←→ verbose(+1)
 *   creativity    factual(-1) ←→ creative(+1)
 *   skepticism    trusting(-1) ←→ skeptical(+1)
 *   directness    cushioned(-1) ←→ blunt(+1)
 *   humor         serious(-1) ←→ playful(+1)
 *   jargon        plain(-1) ←→ technical(+1)
 *   structure     prose(-1) ←→ bulleted(+1)
 *   urgency       calm(-1) ←→ urgent(+1)
 *
 * Inference heuristics (axis-math · see test file for proof):
 *
 *   Each reply is characterized by its observable features:
 *     · word-count       → density signal
 *     · bullet-density   → structure signal
 *     · question-mark / hedge-word count → skepticism signal
 *     · ANTI_NOUR hit    → directness signal (negative · cushioned tells)
 *     · NOUR_HIT_WORDS   → directness signal (positive · blunt tells)
 *     · "!" / "now" / "today" → urgency signal
 *     · code-block / camelCase identifier density → jargon signal
 *     · NOUR_HIT_WORDS overlap with creative tokens → creativity signal
 *     · emoji / "haha"/ "lol" / "?!" → humor signal
 *
 *   A thumbs-up (+1) means "more of this style." A thumbs-down (-1)
 *   means "less of this style." So the delta on each axis equals
 *   the reply's signed feature-strength × the feedback score.
 *
 *   Example: a reply scored 0.6 on bulleted-density and gets thumbs-
 *   up (+1) → axis "structure" gets +0.6 toward bulleted. Same reply
 *   gets thumbs-down (-1) → structure gets -0.6 toward prose.
 *
 *   Updates apply via weighted decay (learningRate × delta) so a
 *   single noisy reply can't flip the vector. Clamped to [-1, 1].
 */

import { prisma } from "@/lib/prisma";
import { logger as rootLogger } from "@/lib/logger";
import { ANTI_NOUR, NOUR_HIT_WORDS } from "@/lib/ai/nour-voice-profile";

const log = rootLogger.withSurface("brain/preference-inference");

export const AXES = [
  "density",
  "creativity",
  "skepticism",
  "directness",
  "humor",
  "jargon",
  "structure",
  "urgency",
] as const;

export type PreferenceAxis = (typeof AXES)[number];

export type PreferenceVector = Record<PreferenceAxis, number>;

export const DEFAULT_VECTOR: PreferenceVector = {
  density: 0,
  creativity: 0,
  skepticism: 0,
  directness: 0,
  humor: 0,
  jargon: 0,
  structure: 0,
  urgency: 0,
};

/** Single operator system — fixed key for the row lookup. */
const SINGLE_OPERATOR_EMAIL = process.env.OPERATOR_EMAIL || "nourdean22@gmail.com";

/** Storage key inside OperatorPreference.voiceToneBoundaries. */
const STORE_KEY = "preferenceVector";

/** Default learning rate · single feedback shifts axis by at most 10% of its observed signal. */
export const DEFAULT_LEARNING_RATE = 0.1;

function clamp(n: number, lo: number = -1, hi: number = 1): number {
  if (!Number.isFinite(n)) return 0;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

function normalizeVector(input: unknown): PreferenceVector {
  const out: PreferenceVector = { ...DEFAULT_VECTOR };
  if (!input || typeof input !== "object") return out;
  const src = input as Record<string, unknown>;
  for (const axis of AXES) {
    const v = src[axis];
    if (typeof v === "number" && Number.isFinite(v)) {
      out[axis] = clamp(v);
    }
  }
  return out;
}

/**
 * Score a reply's observable style features. Each axis returns a
 * value in [-1, 1] where the SIGN is the direction (e.g. +0.6 on
 * structure = bulleted, -0.4 = prose-heavy). Used both for inference
 * and for unit tests.
 *
 * Pure function · safe to call without DB.
 */
export interface StyleFeatures {
  density: number;
  creativity: number;
  skepticism: number;
  directness: number;
  humor: number;
  jargon: number;
  structure: number;
  urgency: number;
}

export function scoreReplyFeatures(text: string): StyleFeatures {
  const t = (text || "").slice(0, 8000); // cap analysis cost
  const words = t.trim().split(/\s+/).filter(Boolean).length;

  // Empty / whitespace-only · no signal · zero on every axis. Keeps
  // the aggregate cron's deltas clean when an empty reply somehow
  // gets feedback.
  if (words === 0) {
    return {
      density: 0,
      creativity: 0,
      skepticism: 0,
      directness: 0,
      humor: 0,
      jargon: 0,
      structure: 0,
      urgency: 0,
    };
  }

  const lines = t.split(/\n/).filter((l) => l.trim().length > 0);
  const bulletLines = lines.filter((l) => /^\s*([-*•]|\d+\.)\s+/.test(l)).length;

  // density: shorter than 60 words = terse · longer than 300 = verbose
  const density = clamp((words - 180) / 240); // 60→-0.5, 300→+0.5, 420→+1

  // structure: ratio of bulleted lines to total non-empty lines
  const structure = lines.length === 0
    ? 0
    : clamp(bulletLines / lines.length * 2 - 0.2); // 50% bullets → +0.8

  // skepticism: hedge words + question marks per 100 words
  const hedgePattern = /\b(might|maybe|perhaps|possibly|could be|not sure|uncertain|likely|probably|I think|seems|appears)\b/gi;
  const hedgeCount = (t.match(hedgePattern) || []).length;
  const qmarkCount = (t.match(/\?/g) || []).length;
  const skepticism = clamp(((hedgeCount + qmarkCount) / Math.max(1, words / 100)) / 6);

  // directness: NOUR_HIT_WORDS push +, ANTI_NOUR push -
  let blunt = 0;
  for (const w of NOUR_HIT_WORDS) {
    const re = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\b`, "gi");
    blunt += (t.match(re) || []).length;
  }
  let cushioned = 0;
  for (const pat of ANTI_NOUR) {
    const m = t.match(new RegExp(pat.source, pat.flags.includes("g") ? pat.flags : pat.flags + "g"));
    cushioned += m?.length ?? 0;
  }
  const directness = clamp((blunt - cushioned * 2) / Math.max(1, words / 80));

  // humor: emoji + lol/haha + multi-punct
  const emojiCount = (t.match(/[\u{1F300}-\u{1FAFF}\u{1F600}-\u{1F64F}]/gu) || []).length;
  const laughCount = (t.match(/\b(lol|lmao|haha+|hehe)\b/gi) || []).length;
  const surpriseCount = (t.match(/[!?]{2,}/g) || []).length;
  const humor = clamp((emojiCount * 0.4 + laughCount * 0.5 + surpriseCount * 0.3));

  // jargon: code fences + camelCase identifiers
  const codeBlocks = (t.match(/```/g) || []).length / 2;
  const camelIds = (t.match(/\b[a-z][a-zA-Z]*(?:[A-Z][a-zA-Z]*)+\b/g) || []).length;
  const fileRefs = (t.match(/\b[a-zA-Z_][a-zA-Z0-9_/.-]*\.(ts|tsx|js|jsx|sql|md|json|yml|prisma)\b/g) || []).length;
  const jargon = clamp((codeBlocks * 0.5 + camelIds * 0.05 + fileRefs * 0.2));

  // urgency: imperative now/today + exclamation density
  const urgentWords = (t.match(/\b(now|today|asap|immediately|urgent|critical|ship|kill|fire|flip)\b/gi) || []).length;
  const exclaim = (t.match(/!/g) || []).length;
  const urgency = clamp((urgentWords * 0.15 + exclaim * 0.1));

  // creativity: presence of metaphor / story signals · scarce in
  // Nick's voice · this axis stays close to 0 unless the reply has
  // explicit storytelling cues.
  const metaphorCues = (t.match(/\b(like|imagine|picture|story|metaphor|analogy)\b/gi) || []).length;
  const creativity = clamp(metaphorCues * 0.12);

  return {
    density,
    creativity,
    skepticism,
    directness,
    humor,
    jargon,
    structure,
    urgency,
  };
}

/**
 * Given a messageId and a thumbs score (±1), infer the delta vector
 * that should nudge the operator's preferences. Reads the
 * AssistantMessage and runs scoreReplyFeatures on its body.
 *
 * Returns a zero vector if the message can't be loaded.
 */
export async function inferDeltaFromFeedback(
  messageId: string,
  score: 1 | -1,
): Promise<PreferenceVector> {
  const msg = await prisma.chatMessage
    .findUnique({
      where: { id: messageId },
      select: { content: true, role: true },
    })
    .catch(() => null);

  if (!msg || msg.role !== "assistant") return { ...DEFAULT_VECTOR };

  const features = scoreReplyFeatures(msg.content || "");
  return deltaFromFeaturesAndScore(features, score);
}

/**
 * Pure axis-math · feature-strength × feedback sign. Exported for
 * tests + the weekly aggregate cron.
 */
export function deltaFromFeaturesAndScore(
  features: StyleFeatures,
  score: 1 | -1,
): PreferenceVector {
  return {
    density: features.density * score,
    creativity: features.creativity * score,
    skepticism: features.skepticism * score,
    directness: features.directness * score,
    humor: features.humor * score,
    jargon: features.jargon * score,
    structure: features.structure * score,
    urgency: features.urgency * score,
  };
}

/**
 * Update a vector with a delta · weighted decay + clamp.
 *
 *   next[axis] = clamp(current[axis] + delta[axis] × learningRate)
 *
 * learningRate defaults to 0.1 so a single +1 / -1 thumbs nudges
 * each axis by at most 10% of the observed signal. Over a week of
 * feedback this is plenty to converge but immune to one noisy turn.
 */
export function applyDeltaWithDecay(
  current: PreferenceVector,
  delta: PreferenceVector,
  learningRate: number = DEFAULT_LEARNING_RATE,
): PreferenceVector {
  const next: PreferenceVector = { ...DEFAULT_VECTOR };
  for (const axis of AXES) {
    next[axis] = clamp(current[axis] + delta[axis] * learningRate);
  }
  return next;
}

/**
 * Read the current preference vector from OperatorPreference.
 * Returns the DEFAULT_VECTOR (all zeros) if the row is missing or
 * the JSON blob doesn't have a preferenceVector key yet.
 */
export async function loadPreferenceVector(): Promise<PreferenceVector> {
  try {
    const profile = await prisma.operatorProfile.findUnique({
      where: { operatorEmail: SINGLE_OPERATOR_EMAIL },
      select: { preferences: { select: { voiceToneBoundaries: true } } },
    });
    const blob = profile?.preferences?.voiceToneBoundaries as
      | Record<string, unknown>
      | null
      | undefined;
    if (!blob || typeof blob !== "object") return { ...DEFAULT_VECTOR };
    return normalizeVector(blob[STORE_KEY]);
  } catch (err) {
    log.warn("load_failed", {
      err: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    return { ...DEFAULT_VECTOR };
  }
}

/**
 * Persist the vector. Upserts the OperatorPreference row by way of
 * OperatorProfile so the first-ever call works even if the row is
 * missing (the operator is the single seeded row in this schema —
 * but defensive insert beats relying on seed order).
 */
export async function savePreferenceVector(
  vec: PreferenceVector,
): Promise<void> {
  try {
    const profile = await prisma.operatorProfile.upsert({
      where: { operatorEmail: SINGLE_OPERATOR_EMAIL },
      update: {},
      create: {
        operatorEmail: SINGLE_OPERATOR_EMAIL,
        preferredName: "Operator",
      },
      select: { id: true, preferences: { select: { voiceToneBoundaries: true } } },
    });

    const existing = (profile.preferences?.voiceToneBoundaries ?? {}) as Record<
      string,
      unknown
    >;
    const merged = { ...existing, [STORE_KEY]: normalizeVector(vec) };

    await prisma.operatorPreference.upsert({
      where: { operatorProfileId: profile.id },
      update: {
        voiceToneBoundaries: merged as unknown as Parameters<
          typeof prisma.operatorPreference.upsert
        >[0]["update"]["voiceToneBoundaries"],
      },
      create: {
        operatorProfileId: profile.id,
        voiceToneBoundaries: merged as unknown as Parameters<
          typeof prisma.operatorPreference.upsert
        >[0]["create"]["voiceToneBoundaries"],
      },
    });
  } catch (err) {
    log.warn("save_failed", {
      err: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
  }
}

/**
 * Render the vector as a ~150-word system-prompt addendum in Nour's
 * operator voice. Skipped sections if the axis is within the
 * neutral band (|v| < 0.15) — keeps the prompt clean and stops weak
 * signals from polluting style guidance.
 */
export function buildSystemPromptAddendum(vec: PreferenceVector): string {
  const tells: string[] = [];

  const phrase = (axis: PreferenceAxis): string | null => {
    const v = vec[axis];
    if (Math.abs(v) < 0.15) return null;
    const strength = Math.abs(v) >= 0.6 ? "strongly" : Math.abs(v) >= 0.3 ? "" : "lightly";
    const s = strength ? `${strength} ` : "";
    switch (axis) {
      case "density":
        return v > 0 ? `${s}lean verbose · explain mechanics` : `${s}lean terse · short sentences`;
      case "creativity":
        return v > 0 ? `${s}allow metaphor + framing` : `${s}stay factual · skip metaphor`;
      case "skepticism":
        return v > 0 ? `${s}flag uncertainty + push back` : `${s}commit to answers · no hedging`;
      case "directness":
        return v > 0 ? `${s}blunt · drop the cushion` : `${s}soften delivery · explain context first`;
      case "humor":
        return v > 0 ? `${s}playful tone OK` : `${s}serious tone only`;
      case "jargon":
        return v > 0 ? `${s}technical vocab · code refs welcome` : `${s}plain language · spell out tech terms`;
      case "structure":
        return v > 0 ? `${s}bulleted lists by default` : `${s}prose paragraphs · skip bullets`;
      case "urgency":
        return v > 0 ? `${s}action-now framing` : `${s}calm pace · don't pressure`;
      default:
        return null;
    }
  };

  for (const axis of AXES) {
    const t = phrase(axis);
    if (t) tells.push(t);
  }

  if (tells.length === 0) {
    return ""; // empty vector · skip the section entirely
  }

  return [
    `## Operator style preferences (inferred from ${tells.length}-axis feedback)`,
    `Nour has scored your style across recent turns. Bend toward:`,
    ...tells.map((t) => `- ${t}`),
    `These are learned tells · not rigid rules. If the turn's intent demands a different shape (e.g. urgent debug → blunt + technical), follow the intent.`,
  ].join("\n");
}

/**
 * Aggregate the last N days of chat_feedback audit events and
 * return one cumulative delta vector. Used by the weekly cron.
 *
 * Each feedback event contributes deltaFromFeaturesAndScore(features,
 * score) where features are scored against the ChatMessage body.
 * The cron then applies the SUM scaled by a small rate so a busy
 * week doesn't whiplash the vector.
 */
export async function aggregateRecentFeedback(daysBack: number = 7): Promise<{
  delta: PreferenceVector;
  sampleSize: number;
}> {
  const since = new Date(Date.now() - daysBack * 86_400_000);
  const events = await prisma.auditEvent
    .findMany({
      where: { eventType: "chat_feedback", createdAt: { gte: since } },
      select: { payload: true, createdAt: true },
      take: 500,
    })
    .catch(() => [] as Array<{ payload: unknown; createdAt: Date }>);

  if (events.length === 0) {
    return { delta: { ...DEFAULT_VECTOR }, sampleSize: 0 };
  }

  // Pull the assistant message bodies in one batch.
  const messageIds: string[] = [];
  const scoresByMsg = new Map<string, 1 | -1>();
  for (const e of events) {
    const payload = e.payload as Record<string, unknown> | null;
    if (!payload) continue;
    const id = typeof payload.messageId === "string" ? payload.messageId : null;
    const score = payload.score === 1 || payload.score === -1 ? (payload.score as 1 | -1) : null;
    if (!id || score === null) continue;
    if (!scoresByMsg.has(id)) {
      scoresByMsg.set(id, score);
      messageIds.push(id);
    }
  }

  if (messageIds.length === 0) {
    return { delta: { ...DEFAULT_VECTOR }, sampleSize: 0 };
  }

  const msgs = await prisma.chatMessage
    .findMany({
      where: { id: { in: messageIds }, role: "assistant" },
      select: { id: true, content: true },
    })
    .catch(() => [] as Array<{ id: string; content: string }>);

  let accum: PreferenceVector = { ...DEFAULT_VECTOR };
  let counted = 0;
  for (const m of msgs) {
    const score = scoresByMsg.get(m.id);
    if (!score) continue;
    const features = scoreReplyFeatures(m.content || "");
    const d = deltaFromFeaturesAndScore(features, score);
    for (const axis of AXES) {
      accum[axis] += d[axis];
    }
    counted += 1;
  }

  if (counted === 0) {
    return { delta: { ...DEFAULT_VECTOR }, sampleSize: 0 };
  }

  // Average so a week with 50 events doesn't shove the vector to
  // the rails. Per-axis mean stays in [-1, 1].
  const avg: PreferenceVector = { ...DEFAULT_VECTOR };
  for (const axis of AXES) {
    avg[axis] = clamp(accum[axis] / counted);
  }

  return { delta: avg, sampleSize: counted };
}

/**
 * Run the full weekly tune: load → aggregate → apply → save.
 * Returns a summary blob for the cron heartbeat.
 */
export async function runWeeklyTune(opts: { learningRate?: number } = {}): Promise<{
  prev: PreferenceVector;
  next: PreferenceVector;
  sampleSize: number;
  learningRate: number;
}> {
  const learningRate = opts.learningRate ?? DEFAULT_LEARNING_RATE;
  const prev = await loadPreferenceVector();
  const { delta, sampleSize } = await aggregateRecentFeedback(7);
  if (sampleSize === 0) {
    return { prev, next: prev, sampleSize: 0, learningRate };
  }
  const next = applyDeltaWithDecay(prev, delta, learningRate);
  await savePreferenceVector(next);
  return { prev, next, sampleSize, learningRate };
}
