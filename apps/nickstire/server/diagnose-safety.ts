/**
 * Deterministic safety + validation layer for the /diagnose symptom checker.
 *
 * WHY THIS EXISTS
 * `/diagnose` used to hand the safety decision entirely to the LLM: the prompt
 * asked it to pick an urgency, the reply was `JSON.parse`d, cast straight to
 * `DiagnosisResult`, and only `urgencyScore` was clamped. Two consequences:
 *
 *  1. A customer typing "brakes went to the floor, I can't stop" got whatever
 *     the model felt like returning — and if the model call FAILED, the
 *     hardcoded fallback said `urgency: "moderate"` ("can wait 1-2 weeks").
 *     A safety-critical report degraded into a "monitor it" answer.
 *  2. Nothing checked the model's shape at runtime. A drifted/garbage field
 *     (urgency: "kinda bad", likelyCauses: null) rendered straight into the UI.
 *
 * So: red flags are matched HERE, in code, before and independently of the AI.
 * They set a FLOOR the model cannot talk its way under. The model still ranks
 * and explains possible causes — it just no longer decides whether someone is
 * safe to keep driving. Failure of the AI can never downgrade a red flag.
 *
 * Deliberately conservative on false positives: every pattern below is a phrase
 * a worried driver actually types, not a bare keyword. "misfire" must not trip
 * the fire rule; a steady check-engine light must not trip the flashing-MIL rule.
 */

import { z } from "zod";

export const URGENCY_LEVELS = ["low", "moderate", "high", "critical"] as const;
export type Urgency = (typeof URGENCY_LEVELS)[number];

const URGENCY_RANK: Record<Urgency, number> = { low: 1, moderate: 2, high: 3, critical: 4 };

/**
 * The 1-5 score band each urgency level is allowed to occupy — mirrors the
 * level definitions in the prompt (low 1-2 · moderate 3 · high 4 · critical 5).
 * The resolved score is clamped INTO the resolved level's band in both
 * directions: a raised level pulls a stale low score up, and a "low" verdict
 * can't ship with a 5/5 bar (the label is the model's semantic answer; the
 * number is a redundant encoding that must agree with it).
 */
const URGENCY_SCORE_BAND: Record<Urgency, { min: number; max: number }> = {
  low: { min: 1, max: 2 },
  moderate: { min: 3, max: 3 },
  high: { min: 4, max: 4 },
  critical: { min: 5, max: 5 },
};

/** The more severe of two urgency levels. */
export function maxUrgency(a: Urgency, b: Urgency): Urgency {
  return URGENCY_RANK[a] >= URGENCY_RANK[b] ? a : b;
}

export type RedFlag = {
  id: string;
  /** Short, plain-language name of the hazard. Shown to the customer. */
  label: string;
  /** What to actually do about it. Shop voice — direct, no hedging. */
  guidance: string;
};

type RedFlagRule = RedFlag & { patterns: RegExp[] };

/**
 * Symptoms where "keep driving and see how it goes" is never the right answer.
 * Mirrors the classic stop-driving list: stopping, steering, fire/fuel, engine
 * damage in progress, and tire structural failure.
 */
const RED_FLAG_RULES: RedFlagRule[] = [
  {
    id: "brake-failure",
    label: "Possible brake failure",
    guidance:
      "Stop driving it. A car that won't stop is not a wait-and-see problem — have it towed rather than driving it here.",
    patterns: [
      // Lookahead excludes reassurance phrasing — "no brake noise, just want a
      // routine check" is a customer ruling the hazard OUT, not reporting it.
      /\b(no|lost|losing|zero)\s+brakes?\b(?!\s+(noise|noises|sound|sounds|issue|issues|problem|problems|trouble|light|lights|squeal|squeak|squeaking|grind|grinding|dust|wear|concern|concerns|fluid))/i,
      /\bbrake\s+failure\b/i,
      /\b(brake\s+)?pedal\s+(goes|going|went|sinks|sank)\s+(all\s+the\s+way\s+)?(to|down\s+to)\s+the\s+floor\b/i,
      /\bbrakes?\s+(go|goes|going|went)\s+(to|down\s+to)\s+the\s+floor\b/i,
      /\bcan'?t\s+stop\b/i,
      /\bwon'?t\s+stop\b/i,
      /\bbrakes?\s+(failed|gave\s+out|stopped\s+working)\b/i,
    ],
  },
  {
    id: "steering-loss",
    label: "Possible steering loss",
    guidance:
      "Stop driving it. If the steering is failing or binding, get it towed — don't drive it in to us.",
    patterns: [
      // Same reassurance-exclusion as brake-failure: "no steering issues" ≠
      // "no steering".
      /\b(lost|losing|loses|no)\s+(the\s+)?(power\s+)?steering\b(?!\s+(noise|noises|issue|issues|problem|problems|trouble|concern|concerns|squeak|squeaks|play|vibration|shake))/i,
      /\bcan'?t\s+steer\b/i,
      /\bsteering\s+(locked|locks\s+up|failed|gave\s+out|seized)\b/i,
      /\bwheel\s+(locked\s+up|won'?t\s+turn)\b/i,
      // 2026-07-27 · the list above covers TOTAL failure only. A customer whose
      // steering has gone loose or stopped responding is describing the same
      // hazard in the words people actually use, and this module's own guidance
      // for it is "Stop driving it." Excludes the reassurance forms the
      // brake-failure rule already guards against.
      // "steering WHEEL is loose" is the ordinary phrasing — the noun the
      // customer touches, not the system. Optional so both forms match.
      /\bsteering(\s+wheel)?\s+(is\s+|feels\s+|has\s+(gone|got)\s+)?(loose|sloppy|unresponsive|not\s+responding)\b/i,
    ],
  },
  {
    id: "flashing-mil",
    label: "Flashing check-engine light",
    guidance:
      "A flashing check-engine light means a misfire that can wreck the catalytic converter within minutes. Pull over and shut it off — don't keep driving to finish the trip.",
    patterns: [
      /\b(flashing|blinking|flashes|blinks)\s+(the\s+)?(check\s+engine|engine|cel|mil)\b/i,
      /\b(check\s+engine|engine)\s+light\s+(is\s+)?(flashing|blinking)\b/i,
      /\b(cel|mil)\s+(is\s+)?(flashing|blinking)\b/i,
    ],
  },
  {
    id: "oil-pressure",
    label: "Oil pressure warning",
    guidance:
      "Shut the engine off now. Driving with no oil pressure destroys the engine in minutes — this is a tow, not a drive.",
    patterns: [
      // Bare /oil pressure/ fired on "I checked the oil pressure, it's fine."
      // Require either the warning indicator or the actual loss.
      /\boil\s+pressure\s+(light|warning|lamp|gauge|alarm|alert)\b/i,
      /\b(low|no|losing|lost|dropping|zero)\s+oil\s+pressure\b/i,
      /\boil\s+pressure\s+(is\s+)?(low|dropping|gone|at\s+zero)\b/i,
      /\blow\s+oil\s+light\b/i,
      /\boil\s+(can|lamp)\s+light\b/i,
      /\boil\s+light\s+(is\s+)?(on|came\s+on|flashing)\b/i,
    ],
  },
  {
    id: "overheating",
    label: "Engine overheating",
    guidance:
      "Pull over and let it cool before you do anything else. Driving an overheating engine warps heads and blows gaskets — the repair bill multiplies fast.",
    patterns: [
      /\boverheat(s|ed|ing)?\b/i,
      /\btemp(erature)?\s+(gauge|needle)\s+.{0,20}\b(red|max|top|all\s+the\s+way\s+up|pegged)\b/i,
      /\bsteam\s+(coming|pouring|rolling|from|out)\b/i,
      // The copula is optional — "coolant IS pouring out" is the natural
      // sentence and the adjacent-only form could not reach it.
      /\bcoolant\s+(is\s+|was\s+)?(boiling|spraying|pouring|gushing|dumping)\b/i,
      /\brunning\s+hot\b/i,
    ],
  },
  {
    id: "fire-smoke",
    label: "Smoke or fire",
    guidance:
      "Get out and call 911 if there's any fire. Do not drive it and do not open the hood on a fire — this is an emergency, not a repair booking.",
    patterns: [
      /\b(on|caught|catches|catching)\s+fire\b/i,
      /\bflames?\b/i,
      /\bsmoke\s+(is\s+)?(coming|pouring|billowing|rolling)\b/i,
      /\bsmok(e|ing)\s+(from|out\s+of|under)\s+(the\s+)?(hood|engine|dash|dashboard|wheel|car)\b/i,
      /\b(hood|engine|dash|dashboard)\s+(is\s+)?smoking\b/i,
      /\bburning\s+(plastic|electrical|wire|wiring|rubber\s+smell\s+with\s+smoke)\b/i,
    ],
  },
  {
    id: "fuel-leak",
    label: "Possible fuel leak",
    guidance:
      "Don't start it. A fuel smell or leak next to a hot exhaust is a fire risk — park it outside, away from the building, and call us before you drive it.",
    patterns: [
      /\b(smell|smells|smelling|odor|odour)\s+.{0,20}\b(gas|gasoline|petrol|fuel)\b/i,
      /\b(gas|gasoline|petrol|fuel)\s+(smell|leak|leaking|dripping|pouring|puddle)\b/i,
      /\braw\s+fuel\b/i,
      /\bsmells?\s+like\s+(gas|gasoline|fuel)\b/i,
    ],
  },
  {
    id: "tire-failure",
    label: "Tire structural failure",
    guidance:
      "Don't drive on it — put the spare on or have it towed. A separating tire lets go without warning at speed.",
    patterns: [
      /\btread\s+(is\s+)?(separat\w*|coming\s+(off|apart)|peeling|fell\s+off)\b/i,
      /\b(tire|tyre)\s+(blew|blow\s?out|shredded|separat\w*|coming\s+apart|falling\s+apart)\b/i,
      /\bbelt\s+separation\b/i,
      /\b(cords?|steel|wire)\s+(is\s+|are\s+)?(showing|exposed|sticking\s+out)\b/i,
      /\bbulge\s+(in|on)\s+(the\s+)?(tire|tyre|sidewall)\b/i,
      // 2026-07-27 · the noun form above cannot match the VERB, and "my tire is
      // bulging" is how customers actually say it. Measured consequence: that
      // exact sentence routed to `price_tires` — a structurally failed tire
      // answered with the used-tire price menu and an invitation to drive in.
      // Same \b-after-truncated-stem trap that has now bitten this repo five
      // times; `bulge` + \s+(in|on) simply cannot reach "bulging".
      /\b(tire|tyre|sidewall)\s+(is\s+|are\s+)?bulg(e|es|ing)\b/i,
      /\bbulg(e|es|ing)\b[^.!?]{0,20}\b(tire|tyre|sidewall)\b/i,
      // "I can see the cords" — the customer reports the observation, not the
      // component state, so the `cords showing` form above misses it.
      /\b(see|seeing|saw)\s+(the\s+)?(cords?|steel\s+belts?|wires?)\b/i,
    ],
  },
  {
    id: "control-loss",
    label: "Loss of vehicle control",
    guidance:
      "Stop driving it. Anything that takes the car out of your control at speed gets towed, not driven.",
    patterns: [
      /\b(lose|lost|losing|loses)\s+control\b/i,
      /\bdeath\s+wobble\b/i,
      /\bviolent(ly)?\s+.{0,12}\b(shak\w*|vibrat\w*|wobbl\w*)\b/i,
      /\b(wheel|tire|tyre)\s+(is\s+)?(coming|came|fell)\s+off\b/i,
      /\blug\s+nuts?\s+.{0,12}\b(loose|missing|fell)\b/i,
      /\b(pulls|jerks|veers|darts)\s+.{0,20}\binto\s+(traffic|oncoming|the\s+other\s+lane)\b/i,
      // 2026-07-27 · "lose control" must be adjacent above, so the ordinary
      // phrasing — "shakes so bad I can barely control it" — fell through to
      // `general`. The customer is reporting exactly this hazard.
      /\b(barely|hardly|can'?t|cannot|could\s?n'?t)\s+[^.!?]{0,15}\bcontrol\b/i,
    ],
  },
];

/**
 * Match red-flag hazards in free-text symptoms. Pure + synchronous — runs
 * before the AI call so a model outage can never suppress a safety warning.
 */
/**
 * Every hazard id this module recognises, in declaration order.
 *
 * Exported so OTHER CHANNELS can be held to the same list. The website has
 * always had the most complete do-not-drive thresholds in the repo; voice and
 * SMS each grew their own partial copies, and an audit of the three found voice
 * covering exactly ONE of these nine. A cross-channel parity test now reads this
 * array, so adding a hazard here fails the voice test until voice covers it too.
 */
export const RED_FLAG_IDS = RED_FLAG_RULES.map((r) => r.id);

export function detectRedFlags(text: string): RedFlag[] {
  if (!text) return [];
  const found: RedFlag[] = [];
  for (const rule of RED_FLAG_RULES) {
    if (rule.patterns.some((p) => p.test(text))) {
      const { patterns: _patterns, ...flag } = rule;
      found.push(flag);
    }
  }
  return found;
}

/** Likelihood, normalized. Stored canonically; rendered in honest wording. */
export const LIKELIHOOD_LEVELS = ["high", "medium", "low"] as const;
export type Likelihood = (typeof LIKELIHOOD_LEVELS)[number];

/**
 * Runtime contract for the model's reply. Replaces the old
 * `JSON.parse(content) as DiagnosisResult` cast, which trusted the model to
 * be well-behaved forever. Anything off-contract throws and we fail honestly
 * rather than rendering junk as a diagnosis.
 *
 * NOTE: no cost field. The model has no pricing feed, no labor guide and no
 * parts data, so any dollar range it produced was invented. Cost wording is
 * set from the shop's real offer, server-side, in diagnose.ts.
 */
export const aiDiagnosisSchema = z.object({
  // Case-normalized like `likelihood` below: "High" from a drifting model must
  // not throw away an otherwise-good diagnosis. Anything non-mappable still
  // fails to the honest `unavailable` path.
  urgency: z.preprocess(
    (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
    z.enum(URGENCY_LEVELS),
  ),
  urgencyScore: z.number().int().min(1).max(5),
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(1200),
  likelyCauses: z
    .array(
      z.object({
        cause: z.string().trim().min(1).max(120),
        explanation: z.string().trim().min(1).max(600),
        likelihood: z.preprocess(
          (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
          z.enum(LIKELIHOOD_LEVELS),
        ),
      }),
    )
    .min(1)
    .max(4),
  recommendedService: z.string().trim().min(1).max(80),
  safetyNote: z.string().trim().max(600),
  nextSteps: z.array(z.string().trim().min(1).max(300)).min(1).max(6),
});

export type AiDiagnosis = z.infer<typeof aiDiagnosisSchema>;

/**
 * Reconcile the model's urgency with the deterministic red-flag floor, and keep
 * `urgency` and `urgencyScore` from contradicting each other (the old code let
 * the model return `urgency: "low"` with `urgencyScore: 5` and rendered both).
 */
export function applySafetyFloor(
  ai: Pick<AiDiagnosis, "urgency" | "urgencyScore" | "safetyNote">,
  redFlags: RedFlag[],
): { urgency: Urgency; urgencyScore: number; safetyNote: string } {
  const floor: Urgency = redFlags.length > 0 ? "critical" : "low";
  const urgency = maxUrgency(ai.urgency, floor);

  // Clamp the score into the resolved level's band — BOTH directions. Floor
  // alone let `urgency: "low"` ship with `urgencyScore: 5`, rendering a green
  // "LOW RISK — MONITOR" badge over a 100%-filled urgency bar.
  const band = URGENCY_SCORE_BAND[urgency];
  const urgencyScore = Math.min(band.max, Math.max(band.min, ai.urgencyScore));

  const flagGuidance = redFlags.map((f) => f.guidance).join(" ");
  const safetyNote = [flagGuidance, ai.safetyNote.trim()].filter(Boolean).join(" ").trim();

  return { urgency, urgencyScore, safetyNote };
}
