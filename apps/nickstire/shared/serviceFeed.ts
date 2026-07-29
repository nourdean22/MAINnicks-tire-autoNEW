/**
 * Service feed (Ads-Manager steal #10): content generation starts from a
 * SERVICE OBJECT — its pain, its confusion, its visual objects, its local
 * angle — instead of a blank topic box.
 *
 * TRUTH CONSTRAINT (load-bearing): `mechanicTruths` and `approvedClaims`
 * ship EMPTY and may only ever be populated from verified evidence records
 * (reviews, declined-work rows, operator-confirmed facts). The structural
 * fields below are creative FRAMING — they assert nothing measurable about
 * the business and contain no prices, counts, guarantees, or urgency. The
 * claim-safety gates downstream still run on every caption regardless.
 */

export interface ServiceFeedItem {
  id: string;
  name: string;
  /** The driver's felt problem, in their words — hooks start here. */
  customerPain: string;
  /** What drivers commonly get wrong — myth-vs-truth material. */
  commonConfusion: string;
  /** Only from verified evidence records. NEVER hand-write here. */
  mechanicTruths: string[];
  /** Only from verified evidence records. NEVER hand-write here. */
  approvedClaims: string[];
  /** Real, filmable shop objects for this service — evidence-first visuals. */
  visualObjects: string[];
  /** Cleveland/Euclid realities that make it locally specific. */
  localAngles: string[];
  /** One action each — the CTA picker offers these. */
  ctaOptions: string[];
}

export const SERVICE_FEED: readonly ServiceFeedItem[] = [
  {
    id: "new_tires", name: "New tires",
    customerPain: "Sliding in rain, worn tread, failed inspection",
    commonConfusion: "Tires 'look fine' long after the tread stopped working",
    mechanicTruths: [], approvedClaims: [],
    visualObjects: ["tread-depth gauge", "new vs worn tread side by side", "tire wall markings"],
    localAngles: ["Cleveland rain on worn tread", "freeze-thaw seasons"],
    ctaOptions: ["Pull up for a tread check", "Call before the weather turns"],
  },
  {
    id: "used_tires", name: "Used tires",
    customerPain: "Needs a safe tire today without the new-tire price",
    commonConfusion: "Assuming every used tire is a gamble",
    mechanicTruths: [], approvedClaims: [],
    visualObjects: ["tread gauge on a used tire", "sidewall inspection", "mounted wheel"],
    localAngles: ["get-to-work-tomorrow reality"],
    ctaOptions: ["Call for today's sizes", "Pull up and see them"],
  },
  {
    id: "mount_balance", name: "Mount & balance",
    customerPain: "Steering-wheel shake at highway speed",
    commonConfusion: "Blaming the road or the alignment for a balance problem",
    mechanicTruths: [], approvedClaims: [],
    visualObjects: ["wheel on the balancer", "wheel weights", "spin test"],
    localAngles: ["I-90 speeds make imbalance obvious"],
    ctaOptions: ["Pull up for a balance check"],
  },
  {
    id: "alignment", name: "Alignment",
    customerPain: "Car pulls after a pothole; tires wearing on one edge",
    commonConfusion: "New tires fix pulling (alignment may still be off)",
    mechanicTruths: [], approvedClaims: [],
    visualObjects: ["alignment readout screen", "uneven tread wear pattern", "steering wheel off-center"],
    localAngles: ["Cleveland potholes", "Euclid Ave impacts"],
    ctaOptions: ["If it pulls after a hit, get it checked"],
  },
  {
    id: "brakes", name: "Brakes",
    customerPain: "Squeal, grind, soft pedal, longer stops",
    commonConfusion: "Diagnosing the part from the sound alone",
    mechanicTruths: [], approvedClaims: [],
    visualObjects: ["pad thickness comparison", "rotor surface close-up", "wheel-off reveal"],
    localAngles: ["stop-and-go on Euclid Ave"],
    ctaOptions: ["Hear it? Get it looked at"],
  },
  {
    id: "oil_change", name: "Oil change",
    customerPain: "Overdue and unsure what the sticker interval really means",
    commonConfusion: "One interval fits every car and every driver",
    mechanicTruths: [], approvedClaims: [],
    visualObjects: ["dipstick check", "clean vs dark oil", "filter comparison"],
    localAngles: ["short-trip winter driving"],
    ctaOptions: ["Pull up — no appointment needed"],
  },
  {
    id: "battery", name: "Battery",
    customerPain: "Slow cranks on cold mornings; died overnight",
    commonConfusion: "Blaming winter for damage summer heat started",
    mechanicTruths: [], approvedClaims: [],
    visualObjects: ["battery tester readout", "corroded terminal", "jump box"],
    localAngles: ["first cold snap exposes weak batteries"],
    ctaOptions: ["Weak starts are a clue — test it"],
  },
  {
    id: "suspension", name: "Suspension",
    customerPain: "Clunks over bumps, floaty ride, nose-dive braking",
    commonConfusion: "Treating noises as cosmetic until something fails",
    mechanicTruths: [], approvedClaims: [],
    visualObjects: ["strut close-up", "bounce test", "worn bushing"],
    localAngles: ["pothole season eats suspensions"],
    ctaOptions: ["Clunk over bumps? Have it checked"],
  },
  {
    id: "tpms", name: "TPMS / tire pressure",
    customerPain: "The light that comes on every cold morning",
    commonConfusion: "Assuming the light means a broken sensor, or ignoring it",
    mechanicTruths: [], approvedClaims: [],
    visualObjects: ["TPMS dash light", "pressure gauge on valve stem", "air hose"],
    localAngles: ["cold mornings drop pressure"],
    ctaOptions: ["Light on? Pull up for a pressure check"],
  },
  {
    id: "flat_repair", name: "Flat repair",
    customerPain: "Nail in the tire; slow leak every few days",
    commonConfusion: "Plug vs patch vs replace — and driving on it meanwhile",
    mechanicTruths: [], approvedClaims: [],
    visualObjects: ["nail in tread", "soapy-water bubble test", "patch from inside"],
    localAngles: ["construction-zone debris"],
    ctaOptions: ["Slow leak? Bring it in before it strands you"],
  },
  {
    id: "check_engine", name: "Check-engine diagnosis",
    customerPain: "The light is on and the internet says ten different things",
    commonConfusion: "The light tells you the part (it tells you where to LOOK)",
    mechanicTruths: [], approvedClaims: [],
    visualObjects: ["scan tool plugged in", "code readout screen", "dash light"],
    localAngles: ["E-Check anxiety"],
    ctaOptions: ["Get it scanned before guessing"],
  },
  {
    id: "no_start", name: "No-start diagnosis",
    customerPain: "Car won't start and every guess costs money",
    commonConfusion: "Battery, starter, and alternator symptoms overlap",
    mechanicTruths: [], approvedClaims: [],
    visualObjects: ["voltage test at the terminal", "starter location shot", "key-turn moment"],
    localAngles: ["cold-morning no-starts"],
    ctaOptions: ["Have it tested before replacing parts"],
  },
];

export function serviceFeedItem(id: string): ServiceFeedItem | null {
  return SERVICE_FEED.find((s) => s.id === id) ?? null;
}
