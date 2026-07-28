/**
 * Recovery Targeting · wave-181.82 (Gates leverage move)
 *
 * Two functions:
 *
 *   scoreEstimateForRecovery(estimate, customer?) · 0-100 score ranking
 *     declined estimates by likelihood-to-convert. The recovery cron uses
 *     this to send to the highest-leverage rows first (within the 20/run
 *     cap · matters when the cap is binding).
 *
 *   buildPersonalizedRecoveryMessage(tier, est, customer?) · vehicle-
 *     specific SMS copy that beats the generic "Hey {{name}} — that
 *     {{$amount}} quote" by referencing the customer's actual vehicle,
 *     repeat-customer status, and the service category in language they
 *     recognize. Falls back to the generic template if customer data is
 *     missing (cron rows aren't always joined to customers · join failure
 *     shouldn't break the send).
 *
 * Design rationale · the highest-leverage move surfaced by the wave-181.80
 * Gates-lens analysis: don't add a new vendor channel · USE the customer
 * data you already have. Same SMS cost · same delivery channel · higher
 * conversion rate via personalization.
 *
 * Scoring signals (each capped 0-25 · max total 100):
 *   - amountSignal · log-scaled · big-ticket quotes get more attention
 *   - ageSignal · sweet spot 7-21 days · before warm but after the
 *     emotion settles · degrades after 30 days
 *   - repeatCustomerSignal · prior visits → assumed higher recovery odds
 *   - vehicleSignal · mid-life vehicles (5-12 yrs old) assumed likelier
 *     to fix than brand-new (dealer) or end-of-life (scrap/owner-fix)
 *
 * EPISTEMIC STATUS (revenue-truth-correction 2026-07-28): every weight
 * and multiplier in this file is a HAND-TUNED PRIOR — plausible-sounding
 * defaults, NOT fit to this shop's data. (An earlier version of this
 * header claimed calibration from "historical conversion data + industry
 * benchmarks"; no such fitting ever happened.) The score is a triage
 * ordering, nothing more. Re-derive the weights from recovery outcomes
 * (sms_messages variantKey → matched_invoice_id) once sample size allows.
 */

interface ScoreInputs {
  estimatedAmount: number | null;      // cents
  estimateDate: Date | null | string;
  customer?: {
    totalVisits?: number | null;
    vehicleYear?: string | null;
  } | null;
}

const NOW_FALLBACK = () => Date.now();

/**
 * Lookup of service-category keywords → priority multiplier (PRIOR, not
 * measured — see header). Rationale for the priors: customers physically
 * feel brake/tire problems worsening; oil/battery are scheduled
 * maintenance; catalytic/transmission quotes hit the total-cost-of-
 * ownership cliff (customer often sells the car instead).
 */
const SERVICE_CATEGORY_WEIGHTS: ReadonlyArray<[RegExp, number]> = [
  [/\b(brake|brakes|caliper|rotor|pad)\b/i, 2.0],
  [/\b(tire|tires|alignment|rotation)\b/i, 1.8],
  [/\b(suspension|strut|shock|control arm|ball joint)\b/i, 1.5],
  [/\b(oil|filter|fluid|coolant|antifreeze)\b/i, 1.2],
  [/\b(battery|alternator|starter)\b/i, 1.1],
  [/\b(transmission|engine|catalytic|head gasket)\b/i, 0.7],
];

function serviceMultiplier(serviceDescription: string | null | undefined): number {
  if (!serviceDescription) return 1.0;
  for (const [pattern, mult] of SERVICE_CATEGORY_WEIGHTS) {
    if (pattern.test(serviceDescription)) return mult;
  }
  return 1.0;
}

/**
 * Score an estimate for recovery priority (0-100).
 *
 * Algorithm:
 *   - amount component (0-25) · log-scaled · $100 quote = 5pts ·
 *     $1000 = 15pts · $5000+ = 25pts
 *   - age component (0-25) · 0pts at <7d (too fresh · let buyer's-remorse
 *     fade first) · 25pts at 10-21d (sweet spot · pain present but
 *     emotion settled) · degrades to 5pts by 60d
 *   - repeat-customer component (0-25) · 0 visits = 5pts · 1-2 visits =
 *     15pts · 3+ visits = 25pts (returning customer = higher trust)
 *   - vehicle-age component (0-25) · brand-new (<3y) = 5pts (owner sells
 *     before paying) · sweet spot 5-12y = 25pts (mature owner ·
 *     conventional fixes) · >15y = 10pts (junk-vs-fix cliff)
 *
 * Service-category multiplier applied to the final score (0.7× to 2.0×).
 * Clamped to [0, 100].
 */
export function scoreEstimateForRecovery(input: ScoreInputs & {
  serviceDescription?: string | null;
}): number {
  const amountCents = input.estimatedAmount ?? 0;
  const amountDollars = amountCents / 100;
  // Log-scaled · log10($100) = 2 · log10($5000) = 3.7 · maps to 0-25
  const amountPts = Math.max(0, Math.min(25, (Math.log10(Math.max(1, amountDollars)) - 1) * 11));

  const ageDays = input.estimateDate
    ? Math.max(0, (NOW_FALLBACK() - new Date(input.estimateDate).getTime()) / 86_400_000)
    : 0;
  // Bell curve · peak at ~12 days · width ~10 days
  let agePts = 0;
  if (ageDays >= 7 && ageDays <= 30) {
    const distFromPeak = Math.abs(ageDays - 12);
    agePts = 25 * Math.exp(-(distFromPeak * distFromPeak) / (2 * 8 * 8));
  } else if (ageDays > 30 && ageDays <= 60) {
    agePts = 25 * Math.exp(-((ageDays - 30) / 15)); // exponential decay
  }
  agePts = Math.max(0, Math.min(25, agePts));

  const visits = Number(input.customer?.totalVisits ?? 0);
  const repeatPts = visits === 0 ? 5 : visits <= 2 ? 15 : 25;

  const vehicleYearStr = input.customer?.vehicleYear;
  const vehicleYear = vehicleYearStr ? parseInt(vehicleYearStr, 10) : NaN;
  const currentYear = new Date().getFullYear();
  let vehiclePts = 15; // unknown vehicle · neutral
  if (Number.isFinite(vehicleYear) && vehicleYear > 1900 && vehicleYear <= currentYear) {
    const age = currentYear - vehicleYear;
    if (age < 3) vehiclePts = 5;
    else if (age <= 12) vehiclePts = 25;
    else if (age <= 15) vehiclePts = 18;
    else vehiclePts = 10;
  }

  const base = amountPts + agePts + repeatPts + vehiclePts;
  const mult = serviceMultiplier(input.serviceDescription);
  return Math.max(0, Math.min(100, Math.round(base * mult)));
}

/**
 * Build a personalized recovery SMS · falls back to the generic template
 * shipped in declinedWorkRecovery.ts (buildSevenDay/ThirtyDayMessage)
 * when customer data is missing. Personalization layers:
 *
 *   1. Vehicle reference · "your 2018 camry" — specifics are assumed to
 *      out-engage generic copy (prior, not measured on this shop).
 *   2. Repeat-customer warmth · 3+ visits gets "you've trusted us before"
 *      framing.
 *   3. Service-category language · brake jobs get safety-framing ·
 *      tire jobs get tread-life framing.
 *
 * Always closes with the Repair Haiku (wave-181.43) and STOP opt-out.
 * Claim rule (revenue-truth-correction): the quote is described as ON
 * FILE — never "still good" / "we'll honor that pricing", which are
 * price commitments this system has no authority to make.
 */
export function buildPersonalizedRecoveryMessage(params: {
  tier: "7d" | "30d";
  name: string;
  amountCents: number;
  serviceDescription: string | null;
  customer?: {
    totalVisits?: number | null;
    vehicleYear?: string | null;
    vehicleMake?: string | null;
    vehicleModel?: string | null;
  } | null;
}): string {
  const { tier, name, amountCents, serviceDescription, customer } = params;
  const dollars = Math.round(amountCents / 100);
  const moneyStr = `$${dollars.toLocaleString()}`;

  // Vehicle reference · "your 2018 Camry" or "your Camry" or fallback
  const vehicleYear = customer?.vehicleYear?.trim();
  const vehicleMake = customer?.vehicleMake?.trim();
  const vehicleModel = customer?.vehicleModel?.trim();
  const vehicleRef = [vehicleYear, vehicleMake, vehicleModel]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/\bnull\b/g, "");
  const vehicleClause = vehicleRef ? `your ${vehicleRef}` : "your vehicle";

  // Service-category specific framing
  const svcLower = (serviceDescription || "").toLowerCase();
  let serviceClause: string;
  if (/\b(brake|caliper|rotor|pad)\b/.test(svcLower)) {
    serviceClause = "brake job";
  } else if (/\b(tire|alignment|rotation)\b/.test(svcLower)) {
    serviceClause = "tire work";
  } else if (/\b(suspension|strut|shock|control arm|ball joint)\b/.test(svcLower)) {
    serviceClause = "suspension work";
  } else if (/\b(oil|filter|fluid|coolant)\b/.test(svcLower)) {
    serviceClause = "maintenance";
  } else if (/\b(transmission|engine|catalytic)\b/.test(svcLower)) {
    serviceClause = "the repair";
  } else if (serviceDescription && serviceDescription.length > 0 && serviceDescription.length < 40) {
    serviceClause = serviceDescription.toLowerCase();
  } else {
    serviceClause = "the work we quoted";
  }

  // Repeat-customer warmth
  const visits = Number(customer?.totalVisits ?? 0);
  const repeatPrefix = visits >= 3
    ? `you've trusted us before — `
    : "";

  if (tier === "7d") {
    return (
      `Hey ${name}, Nick's Tire & Auto here. ${repeatPrefix}` +
      `That ${moneyStr} quote for ${serviceClause} on the ${vehicleClause} is still on file. ` +
      `Free re-check, no charge, you don't pay until you say yes. ` +
      `Drop off anytime. Reply STOP to opt out.`
    );
  }

  // 30d tier · slightly different framing · urgency cue without nagging
  return (
    `Hey ${name}, Nick's here. ${repeatPrefix}` +
    `just following up on the ${moneyStr} quote for ${serviceClause} on the ${vehicleClause} from a month ago. ` +
    `It's still on file — free re-check first, and you don't pay until you say yes. ` +
    `(216) 862-0005. Reply STOP to opt out.`
  );
}
