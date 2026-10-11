/**
 * Arc B Feature 1 · Preference Inference Engine · v10.0.526
 *
 * An 8-axis style preference vector for the operator, applied as a
 * system-prompt addendum on every turn (lib/ai/style-adapter.ts). Nothing
 * reads thumbs feedback into it today (see below).
 *
 * 2026-10-10 (audit 06-F10): NOTHING tunes the vector automatically. The
 * weekly tuner (runWeeklyTune + aggregateRecentFeedback) lost its cron in the
 * prune f87fb7e62 and was deleted; the only writer is the operator's manual
 * override (lib/services/preference-vector.ts savePreferenceVectorOverride).
 * The override uses AXES, the load/save pair and buildSystemPromptAddendum.
 * The feedback math lost its last caller with inferDeltaFromFeedback and was
 * deleted 2026-10-11 (R3-13); a re-wired tuner starts from git history.
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
 */

import { prisma } from "@/lib/prisma";
import { logger as rootLogger } from "@/lib/logger";

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
