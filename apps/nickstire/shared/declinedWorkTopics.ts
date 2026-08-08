/**
 * Declined-work topics — the content input nobody was using.
 *
 * Measured 2026-08-08: `alg_estimates` holds 432 open rows, 345 of them with a
 * service description. That is a ranked list of the exact repairs Cleveland
 * drivers were quoted and REFUSED, with the price at which they refused:
 *
 *   LOWER CONTROL ARM            29 declined   avg $1,055
 *   FRONT HUB OR BEARING (ONE)   17            avg $  741
 *   TUNE UP (MAJOR)              14            avg $1,296
 *   CATALYTIC CONVERTER          14            avg $1,114
 *   FRONT STRUT ASSEMBLIES       9             avg $1,811
 *
 * WHY THIS SOURCE OUTRANKS EVERY OTHER ONE. `HARD_REJECT_RULES[0]` rejects
 * "generic mechanic imagery any shop could run unchanged", and 49 of 137
 * published posts (36%) carry that signature. A topic derived from THIS shop's
 * refused estimates is un-generic BY CONSTRUCTION — no competitor has this
 * list. Territory vocabularies ("hidden mechanic truth", "myth destruction")
 * are adoptable by anyone and therefore generic by the same construction.
 *
 * THE MISMATCH THIS CLOSES (all three measured the same day):
 *   callers ask about   tires 625 · price 543 · brakes 152 · suspension 20
 *   customers DECLINE   suspension/steering — 81 of the top 12 declines
 *   revenue comes from  suspension/steering — $247k, $712 avg ticket
 *   content publishes   tires
 * The engine talks about what people already understand well enough to phone
 * about, and is silent on what pays and what gets refused. Drivers do not call
 * about control arms because they do not know what a control arm is — which is
 * the content opportunity, not an argument against it.
 *
 * ★ THE COUNT IS EVIDENCE, NOT COPY. "29 drivers walked away from a $1,055
 * control arm" is TRUE and sourced, and `detectFabricatedStats` would still
 * block it: that rule refuses the SHAPE of first-person shop experience
 * quantified as an absolute, because a linter cannot tell a sourced number from
 * an invented one, and the invented ones shipped first (reel 1200004: "we see
 * zero salt-related brake seizures"). So counts and dollars drive the SCORE and
 * appear in `reasons` for the operator queue — they never enter the topic text
 * handed to the generator.
 *
 * Pure by design, exactly like contentTopicMiner: rows in, candidates out. No
 * DB, no network. Fetching lives in server/services/declinedWorkSignals.ts.
 */
import { assessNovelty } from "./creativeFingerprint";

/** One aggregated declined repair, as read from `alg_estimates`. */
export interface DeclinedWorkRow {
  /** Raw ALG labor-guide description, e.g. "REMOVE & REPLACE LOWER CONTROL ARM". */
  serviceDescription: string;
  /** How many open (unmatched) estimates carry this job. */
  count: number;
  /** Average estimated amount in CENTS — alg_estimates.estimated_amount is cents. */
  avgAmountCents: number;
}

/**
 * The angle a declined repair is worth talking about from. Chosen by what the
 * refusal implies, not at random — a $1,800 strut job and a $600 water pump are
 * declined for different reasons and deserve different treatments.
 */
export type DeclineAngle =
  | "symptom_decode"      // people decline what they cannot feel
  | "cost_of_waiting"     // the repair that gets more expensive by ignoring it
  | "second_opinion"      // high ticket → "get it checked before you buy the part"
  | "what_it_actually_is" // nobody knows what this part does
  | "safety_line";        // the one class we do not soft-pedal

export interface DeclinedTopicCandidate {
  /** Generator-facing brief. Carries NO counts or dollar figures — see header. */
  topic: string;
  /** Human-readable part name, normalised out of ALG's labor-guide phrasing. */
  part: string;
  angle: DeclineAngle;
  /** Ranking score. Higher = more people refused this, and for more money. */
  score: number;
  /** Operator-queue rationale. Numbers live HERE, never in `topic`. */
  reasons: string[];
}

/**
 * ALG writes labor-guide phrasing, not English: "REMOVE & REPLACE FRONT STRUT
 * ASSEMBLIES (BOTH)". Feeding that verbatim to a caption generator produces
 * copy that sounds like an invoice. Strip the operation verb and the quantity
 * qualifiers, keep the part.
 */
export function normalizePartName(serviceDescription: string): string {
  let s = serviceDescription.trim().toLowerCase();
  // Leading operation verbs, longest first so "remove & replace" wins over "replace".
  s = s.replace(/^(remove\s*(&|and)\s*replace|remove|replace|r\s*&\s*r|recondition|service|inspect)\s+/i, "");
  // Quantity/position qualifiers ALG appends in parentheses.
  s = s.replace(/\((one|both|two|2\s*wheel|ea|each|per)[^)]*\)/gi, "");
  // Trailing "including adjustments" style tails.
  s = s.replace(/\s+(including|includes|w\/|with)\s+.*$/i, "");
  s = s.replace(/[^a-z0-9\s\-/]/gi, " ").replace(/\s+/g, " ").trim();
  // Singularise the head noun. ALG lists the same repair as both "STRUT
  // ASSEMBLY (ONE)" and "STRUT ASSEMBLIES (BOTH)"; without this they normalise
  // to two different parts and one repair occupies two queue slots — which is
  // exactly the repetition this source exists to avoid.
  const words = s.split(" ");
  const last = words[words.length - 1];
  if (last && last.length > 3) {
    if (/ies$/.test(last)) words[words.length - 1] = last.replace(/ies$/, "y");
    else if (/(ses|xes|zes|ches|shes)$/.test(last)) words[words.length - 1] = last.replace(/es$/, "");
    else if (/[^s]s$/.test(last)) words[words.length - 1] = last.replace(/s$/, "");
  }
  return words.join(" ").trim();
}

/** Safety-critical parts get the one angle we do not soften. */
const SAFETY_PARTS = /(brake|rotor|caliper|tie rod|ball joint|control arm|strut|steering|wheel bearing|hub)/i;
/** Parts whose failure cascades into a bigger bill if ignored. */
const CASCADE_PARTS = /(water pump|timing|belt|radiator|thermostat|oxygen sensor|catalytic|alternator|hub or bearing)/i;
/** Parts nobody outside a shop can name. */
const OBSCURE_PARTS = /(control arm|tie rod|ball joint|oxygen sensor|catalytic converter|evaporation|canister|idler|pitman|sway bar)/i;

/**
 * Pick the angle from the part and the ticket size. Deterministic — the same
 * row must always produce the same angle, or a re-run reshuffles the queue and
 * the operator cannot tell a new opportunity from a re-rolled one.
 *
 * Order matters: safety outranks cost-framing. We do not tell someone their
 * control arm is a budgeting decision.
 */
export function angleFor(part: string, avgAmountCents: number): DeclineAngle {
  if (SAFETY_PARTS.test(part)) return "safety_line";
  if (CASCADE_PARTS.test(part)) return "cost_of_waiting";
  // A four-figure ticket is refused for a different reason than a $300 one:
  // not "is it real" but "am I being sold".
  if (avgAmountCents >= 100_000) return "second_opinion";
  if (OBSCURE_PARTS.test(part)) return "what_it_actually_is";
  return "symptom_decode";
}

/** The brief handed to the generator. Deliberately free of counts and dollars. */
export function briefFor(part: string, angle: DeclineAngle): string {
  switch (angle) {
    case "safety_line":
      return `the ${part}: what a driver actually feels when it is going, and why this is the category we do not tell people to wait on`;
    case "cost_of_waiting":
      return `the ${part}: what it takes out with it when it fails, so the cheap repair does not become the expensive one`;
    case "second_opinion":
      return `the ${part}: why a big estimate deserves a diagnosis you can see, and what to ask before anyone orders the part`;
    case "what_it_actually_is":
      return `what a ${part} actually does — most drivers have never been shown one, and cannot picture what they are being asked to buy`;
    case "symptom_decode":
    default:
      return `the ${part}: the symptom drivers notice first, and the three things it could mean`;
  }
}

/**
 * Score a declined repair. Two independent inputs, deliberately:
 *
 *   VOLUME — how many people refused it. A repair 29 people declined is a
 *   conversation the shop is repeatedly losing; one person declining is noise.
 *
 *   TICKET — a bigger refusal is worth more to reverse, but with a DAMPED
 *   contribution (log, not linear). Otherwise one $1,811 strut job outranks
 *   every high-frequency topic and the feed becomes an ad for the most
 *   expensive service, which is the "hero category" framing this shop's
 *   positioning explicitly rejects.
 */
export function scoreDeclinedTopic(row: DeclinedWorkRow): number {
  const volume = Math.min(row.count, 30) * 2.5;
  const dollars = Math.max(0, row.avgAmountCents) / 100;
  const ticket = dollars > 0 ? Math.log10(dollars + 1) * 6 : 0;
  return Math.round((volume + ticket) * 10) / 10;
}

export interface MineDeclinedOptions {
  /** Rows with fewer declines than this are dropped — one refusal is not a pattern. */
  minCount?: number;
  /** Topics already used recently; near-duplicates are suppressed by the caller. */
  limit?: number;
}

/**
 * Rows → ranked candidates. Rows arrive already aggregated by the caller (a
 * GROUP BY in declinedWorkSignals), because aggregating here would mean this
 * module needed to know about row shapes it should not see.
 */
export function mineDeclinedWorkTopics(
  rows: DeclinedWorkRow[],
  opts: MineDeclinedOptions = {},
): DeclinedTopicCandidate[] {
  const minCount = opts.minCount ?? 2;
  const limit = opts.limit ?? 12;

  const seenParts = new Set<string>();
  const out: DeclinedTopicCandidate[] = [];

  for (const row of rows) {
    if (!row.serviceDescription?.trim()) continue;
    if (row.count < minCount) continue;

    const part = normalizePartName(row.serviceDescription);
    if (!part || part.length < 3) continue;
    // ALG lists the same part at several quantities ("(ONE)" / "(BOTH)"), which
    // normalise to the same name. Collapsing them here stops one repair
    // occupying three queue slots.
    if (seenParts.has(part)) continue;
    seenParts.add(part);

    const angle = angleFor(part, row.avgAmountCents);
    const dollars = Math.round(row.avgAmountCents / 100);
    out.push({
      topic: briefFor(part, angle),
      part,
      angle,
      score: scoreDeclinedTopic(row),
      // Numbers live here and ONLY here — the operator queue shows them, the
      // generator never sees them. See the fabricated-stat note in the header.
      reasons: [
        `${row.count} open estimates declined`,
        `avg ticket $${dollars.toLocaleString("en-US")}`,
        `angle: ${angle}`,
      ],
    });
  }

  // Part-name dedup above catches "(ONE)" vs "(BOTH)". It does NOT catch two
  // genuinely different ALG line items that are the same CONTENT topic — live
  // run: "front strut assembly" and "front struts and align" both surfaced, and
  // a viewer cannot tell those apart. Compose the novelty module rather than
  // inventing a second similarity rule here: same subject AND same angle is the
  // cousin test, and the higher-scoring row wins because it was declined more.
  const ranked = out.sort((a, b) => b.score - a.score);
  const kept: DeclinedTopicCandidate[] = [];
  for (const c of ranked) {
    const isCousin = kept.some(
      (k) => k.angle === c.angle && assessNovelty(c.topic, [k.topic]).collisions.some((x) => x.startsWith("subject:")),
    );
    if (!isCousin) kept.push(c);
    if (kept.length >= limit) break;
  }
  return kept;
}
