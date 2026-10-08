/**
 * Shot router (2026-10-08) — the production audit's seven questions, applied
 * PER SHOT, never per Reel. Pure: facts in, a route and the step that decided
 * it out. The order is the audit's order with one deliberate change: an
 * approved still (step 4) and a trust-harming defect (step 5) are checked
 * before "AI is allowed" (step 3), because the router's job is the cheapest
 * ACCEPTED method, and "allowed" is not "chosen".
 *
 * Who consumes it: `runReelPreflight` reports a beat whose declared source
 * contradicts what the beat claims (shotRouteProblems), and the pilot briefs
 * declare each beat's source in `StoryboardBeat.source`. The pipeline does
 * not yet honour `source` when it picks a provider — that is the design item
 * in docs/reels-engine-v2/02-PRODUCTION-DOCTRINE.md §8, presented before any
 * change to a live workflow.
 */
export type ShotSource = "real" | "deterministic" | "still_motion" | "ai_illustrative";
export type ShotRoute = ShotSource | "reuse" | "delete" | "do_not_generate";

const SHOT_SOURCES: readonly ShotSource[] = ["real", "deterministic", "still_motion", "ai_illustrative"];

/**
 * A `source` read from untrusted JSON (a committed pack brief): one of the four
 * declared values, or null. The approved-pack builder keeps a beat's source only
 * through this, so the declaration reaches runReelPreflight intact and a stray
 * value never does.
 */
export function parseShotSource(value: unknown): ShotSource | null {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return (SHOT_SOURCES as readonly string[]).includes(v) ? (v as ShotSource) : null;
}

export interface ShotFacts {
  /** Claims to show Nick's, a customer vehicle, damage, a measurement or repair work. */
  claimsRealWork: boolean;
  /** Explains geometry, flow, force, sequence or a decision boundary. */
  explainsMechanism: boolean;
  /** Generic atmosphere, metaphor, impossible camera move or visual surprise. */
  atmosphereOrMetaphor: boolean;
  /** An approved still already fixes the correct object and composition. */
  hasApprovedStill: boolean;
  /** A generation defect (warped tool, wrong part, mutated lug count) would harm mechanical trust. */
  defectWouldHarmTrust: boolean;
  /** An existing honest shot (licensed, original, not a duplicate) can solve it. */
  reusableShotExists: boolean;
  /** The Reel cannot work without this shot. */
  essential: boolean;
}

export interface ShotDecision {
  route: ShotRoute;
  /** The audit question (1–7) that decided the route. */
  step: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  reason: string;
}

export function routeShot(f: ShotFacts): ShotDecision {
  if (f.claimsRealWork) return { route: "real", step: 1, reason: "it claims to show real work, damage or a measurement — only real footage can" };
  if (f.explainsMechanism) return { route: "deterministic", step: 2, reason: "it explains a mechanism or a decision boundary — a diagram or card is accurate and editable" };
  if (f.hasApprovedStill) return { route: "still_motion", step: 4, reason: "an approved still fixes the object and composition — deterministic motion before image-to-video, before text-to-video" };
  if (f.defectWouldHarmTrust) return { route: "do_not_generate", step: 5, reason: "a generation defect here would harm mechanical trust — capture it or cut it" };
  if (f.reusableShotExists) return { route: "reuse", step: 6, reason: "an honest existing shot solves it — reuse, subject to licence and originality rules" };
  if (f.atmosphereOrMetaphor) return { route: "ai_illustrative", step: 3, reason: "atmosphere or metaphor, labelled or contextually obvious as illustrative" };
  if (!f.essential) return { route: "delete", step: 7, reason: "the Reel works without it — delete before buying generation" };
  return { route: "do_not_generate", step: 7, reason: "essential, but no honest route is declared — capture it" };
}

/**
 * The explicit source a brief declares for a beat: the `source` field, or the
 * leading REAL / DETERMINISTIC / STILL / AI tag the proof packs write at the
 * start of `visual`. "unspecified" is the honest default — nothing is inferred
 * from prose, because a guess here would be a shot plan nobody made.
 */
export function declaredBeatSource(beat: { visual?: string | null; source?: ShotSource | null }): ShotSource | "unspecified" {
  if (beat.source) return beat.source;
  const head = String(beat.visual ?? "").trimStart().slice(0, 24).toUpperCase();
  if (/^REAL\b/.test(head)) return "real";
  if (/^DETERMINISTIC\b/.test(head)) return "deterministic";
  if (/^STILL(?:[ _-]MOTION)?\b/.test(head)) return "still_motion";
  if (/^AI(?:[ _-]ILLUSTRATIVE)?\b/.test(head)) return "ai_illustrative";
  return "unspecified";
}

const REAL_WORK_CLAIM = /\b(customer|our shop|nick'?s|measurement|gauge|reading|repair(?:ed|ing)?|before and after|before\/after|evidence|technician)\b/i;

/**
 * Contradictions between a beat's declared source and what the beat says it
 * shows. Silent for beats that declare nothing: the 196 committed packs predate
 * the field, and a warning on every one of them would be noise, not a guard.
 */
export function shotRouteProblems(
  beats: Array<{ beatNumber: number; visual?: string | null; purpose?: string | null; source?: ShotSource | null }>,
): string[] {
  const out: string[] = [];
  for (const b of beats) {
    const source = declaredBeatSource(b);
    if (source === "unspecified") continue;
    const text = `${b.visual ?? ""} ${b.purpose ?? ""}`;
    if (source === "ai_illustrative" && REAL_WORK_CLAIM.test(text)) {
      out.push(`beat ${b.beatNumber}: declared ai_illustrative but describes real work, a measurement or evidence — a synthetic shot must never document real work (route it real or cut it)`);
    }
    if (source === "real" && /\b(generate|generated|synthetic|ai[- ]made|text-to-video|image-to-video)\b/i.test(text)) {
      out.push(`beat ${b.beatNumber}: declared real but the visual asks for a generated shot — declare the source the shot actually has`);
    }
  }
  return out;
}
