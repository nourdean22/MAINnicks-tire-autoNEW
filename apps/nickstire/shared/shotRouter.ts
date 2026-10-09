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
 * declare each beat's source in `StoryboardBeat.source`. Since 2026-10-08 the
 * pipeline honours a declaration of real or deterministic by REFUSING to
 * generate the beat (enqueueReelJob, processNextReelJob, requestBeatRepair:
 * beatsTheGeneratorMustNotRender / beatGenerationRoute). Routing those beats
 * to a publishable lane (real footage, a card renderer) waits on the
 * operator's real-evidence publish decision (02-PRODUCTION-DOCTRINE.md §8).
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
 *
 * The tag counts only as written, in capitals (2026-10-08). The generator now
 * acts on it, and ordinary prose ("Real-world pothole damage…", "Still frame
 * of…") would otherwise read as a declaration and hold a Reel nobody tagged.
 */
export function declaredBeatSource(beat: { visual?: string | null; source?: ShotSource | null }): ShotSource | "unspecified" {
  if (beat.source) return beat.source;
  const head = String(beat.visual ?? "").trimStart().slice(0, 24);
  if (/^REAL\b/.test(head)) return "real";
  if (/^DETERMINISTIC\b/.test(head)) return "deterministic";
  if (/^STILL(?:[ _-]MOTION)?\b/.test(head)) return "still_motion";
  if (/^AI(?:[ _-]ILLUSTRATIVE)?\b/.test(head)) return "ai_illustrative";
  return "unspecified";
}

/** What the clip generator does with a beat that has no clip yet. */
export type BeatGenerationRoute = "generate" | "needs_real_footage" | "needs_deterministic_render" | "needs_subject";

/**
 * A visual that names no object (2026-10-08). Two 2026-09-25 import batches wrote
 * the same two sets of five placeholder shots into 34 packs ("Extreme macro of the physical
 * subject…", "…the relevant physical components…", "unbranded automotive
 * component macro…"), and the generator sent them verbatim: the Subject line of
 * a Reel about XL load ratings or a TPMS light named no tire and no light, so
 * the clip could not show the topic. A generic referent counts only when the
 * visual also names no concrete part, so "macro of the caliper, the relevant
 * component" is a subject and stays generatable.
 */
const GENERIC_REFERENT = /\b(?:physical subject|relevant (?:physical )?components?|mechanical distinction|automotive component|physical comparison|opening component)\b/i;
const CONCRETE_SUBJECT = /\b(?:tires?|tyres?|tread|sidewall|bead|valve|stem|wheels?|rims?|lugs?|studs?|hub|rotors?|brakes?|pads?|calipers?|drums?|batter(?:y|ies)|terminals?|cables?|alternator|starter|belts?|pulleys?|hoses?|coolant|radiator|reservoir|dipstick|oil|filters?|spark|plugs?|coils?|sensors?|gauges?|meters?|tester|scan tool|dashboard|cluster|windshield|wipers?|struts?|shocks?|springs?|tie rods?|ball joints?|bearings?|axles?|cv|exhaust|muffler|nails?|screws?|patch|placard|engine|pump|gaskets?|fan|thermostat|fuses?|relays?|fob|headlights?|bulbs?|caps?|nuts?|sockets?|wrench|torque|balancer|alignment|lift|jack|pothole|road|pavement|puddle)\b/i;

function isSubjectFreeVisual(visual: string | null | undefined): boolean {
  const v = String(visual ?? "");
  return GENERIC_REFERENT.test(v) && !CONCRETE_SUBJECT.test(v);
}

/**
 * The generator's reading of a DECLARED source (2026-10-08). A beat declared
 * real is never generated: a synthetic shot must never document real work. A
 * beat declared deterministic is drawn, not imagined — a generated "diagram"
 * is the lettering artifact the critic blocks. Neither has a publishable route
 * today (the publish door's stock guard refuses every clip the free local lane
 * hosts, and opening a real-evidence route is the operator's decision), so the
 * generator holds such a job before it spends. A beat whose visual names no
 * object (isSubjectFreeVisual) is held the same way: there is nothing for the
 * model to show. still_motion, ai_illustrative and undeclared beats with a
 * subject generate as before.
 */
export function beatGenerationRoute(beat: { visual?: string | null; source?: ShotSource | null }): BeatGenerationRoute {
  const source = declaredBeatSource(beat);
  if (source === "real") return "needs_real_footage";
  if (source === "deterministic") return "needs_deterministic_render";
  if (isSubjectFreeVisual(beat.visual)) return "needs_subject";
  return "generate";
}

/** The beats the generator must not render: declared real or deterministic, or naming no subject, with no clip yet (a resumed job keeps its clips). */
export function beatsTheGeneratorMustNotRender(
  beats: ReadonlyArray<{ beatNumber: number; visual?: string | null; source?: ShotSource | null }>,
  existingClipUrls: unknown,
): Array<{ beatNumber: number; route: Exclude<BeatGenerationRoute, "generate"> }> {
  const clips = Array.isArray(existingClipUrls) ? existingClipUrls : [];
  const out: Array<{ beatNumber: number; route: Exclude<BeatGenerationRoute, "generate"> }> = [];
  beats.forEach((beat, i) => {
    const clip = clips[i];
    if (typeof clip === "string" && clip.startsWith("http")) return;
    const route = beatGenerationRoute(beat);
    if (route !== "generate") out.push({ beatNumber: beat.beatNumber, route });
  });
  return out;
}

/** The refusal line, at enqueue or at generation: which beats, and what each needs. */
export function generationHoldReason(
  blocked: ReadonlyArray<{ beatNumber: number; route: Exclude<BeatGenerationRoute, "generate"> }>,
  stage: "enqueue" | "generation" = "generation",
): string {
  const list = (route: Exclude<BeatGenerationRoute, "generate">) => blocked.filter((b) => b.route === route).map((b) => b.beatNumber);
  const real = list("needs_real_footage");
  const drawn = list("needs_deterministic_render");
  const blank = list("needs_subject");
  const beatWord = (n: number[]) => (n.length === 1 ? `beat ${n[0]} is` : `beats ${n.join(", ")} are`);
  const parts: string[] = [];
  if (real.length) parts.push(`${beatWord(real)} declared real: capture the footage (docs/reels-engine-v2/05-CAPTURE-CHECKLIST.md)`);
  if (drawn.length) parts.push(`${beatWord(drawn)} declared deterministic: no publishable card renderer yet`);
  if (blank.length) {
    const what = blank.length === 1 ? "a placeholder that names no object" : "placeholders that name no object";
    parts.push(`${beatWord(blank)} ${what} ("the physical subject"): write what the camera sees, or capture it`);
  }
  const where = stage === "enqueue" ? "blocked at enqueue, nothing reserved" : "blocked at generation, before spend";
  return `BEAT_SOURCE_NOT_GENERATABLE (${where}): ${parts.join("; ")}. Nothing was generated.`;
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
