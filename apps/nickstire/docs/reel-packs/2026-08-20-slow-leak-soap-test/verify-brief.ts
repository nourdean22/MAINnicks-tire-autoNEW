/**
 * Reproduces this pack's quality receipt. From this directory:
 *
 *   node --experimental-strip-types verify-brief.ts
 *
 * No pnpm install, no bundler, no database: facelessReelStudio.ts has zero
 * imports and is pure, so Node's type-stripping runs the real gates directly.
 * Expected output: 75/75, gate=pass, 0 safety findings, preflight pass.
 */
import {
  calculateReelQualityScore,
  runSafetyChecks,
  runReelPreflight,
  validateReelLengthTarget,
  validateBeatCount,
  validateHashtagCap,
  scoreReelConcept,
  detectForbiddenReelClaims,
  detectOverdiagnosis,
  detectFearmongering,
  detectPriceClaims,
  detectGenericAdLanguage,
  detectFabricatedStats,
} from "../../../client/src/lib/facelessReelStudio.ts";

const beats = [
  {
    beatNumber: 1,
    startSecond: 0,
    endSecond: 4,
    visual:
      "Extreme macro on a rubber tire valve stem where it meets the alloy wheel, a single soap bubble swelling outward from the base of the stem and quivering in cold morning light, shallow depth of field, dark wet pavement bokeh behind.",
    motion: "Slow continuous macro push-in; the bubble grows, trembles, and holds without popping.",
    onScreenText: "SAME TIRE. EVERY WEEK.",
    purpose: "Scroll-stop on the exact physical moment a slow leak reveals itself.",
    audioCue: "Low ambient hiss of escaping air, no music sting.",
    safeZoneNotes: "Bubble center-frame; keep top 12% / bottom 20% clear for IG UI.",
  },
  {
    beatNumber: 2,
    startSecond: 4,
    endSecond: 9,
    visual:
      "Tight low-angle three-quarter view of a single tire's contact patch bulging visibly flatter against the pavement, the tire behind it sitting taut and round in soft background blur, faint frost on the asphalt, early flat daylight.",
    motion: "Slow creeping dolly that settles on the soft tire's contact patch, shallow focus throughout.",
    onScreenText: "1 LB A MONTH = NORMAL",
    purpose: "Separate normal pressure loss from a real leak.",
    audioCue: "Quiet outdoor morning ambience.",
    safeZoneNotes: "Contact patch center-frame, pavement horizon low.",
  },
  {
    beatNumber: 3,
    startSecond: 9,
    endSecond: 14,
    visual:
      "Three objects isolated on a clean dark field: a roofing nail sunk into a block of tread rubber, a split and perished rubber valve stem, and a pale crust of corrosion along the bead seat where rubber meets alloy.",
    motion: "The frame glides between the three objects in turn, each rotating slowly on its own axis.",
    onScreenText: "NAIL / VALVE STEM / RIM",
    purpose: "Name the three usual causes as physical objects, not jargon.",
    audioCue: "Soft mechanical tick as the frame settles on each object.",
    safeZoneNotes: "Objects held to the middle band of frame.",
  },
  {
    beatNumber: 4,
    startSecond: 14,
    endSecond: 18,
    visual:
      "A film of soapy water clinging across a tire's bead seat and valve stem, a cluster of bubbles inflating outward from one single spot as escaping air pushes through the film.",
    motion: "Macro push-in on the bubble cluster as it swells and multiplies at the leak point.",
    onScreenText: "BUBBLES MARK THE SPOT",
    purpose: "Give the driver a test they can actually run at home.",
    audioCue: "Faint wet fizzing.",
    safeZoneNotes: "Bubble cluster center-frame.",
  },
  {
    beatNumber: 5,
    startSecond: 18,
    endSecond: 21,
    visual:
      "The same valve stem and bead seat, soap film gone, rubber still and dry, warm late-afternoon shop light raking across it, matching the opening angle.",
    motion: "Camera settles into a still hold on the opening framing for a seamless loop.",
    onScreenText: "NICK'S TIRE & AUTO / EUCLID AVE",
    purpose: "Close calm and loop the last frame back into the first.",
    audioCue: "Ambience settles to quiet.",
    safeZoneNotes: "End-card overlay composited in post, bottom-safe.",
  },
];

const concept = {
  id: "slow-leak-soap-test",
  hook: "A soap bubble swelling out of a valve stem in macro",
  coreFact:
    "A tire losing pressure weekly rather than monthly is leaking at the tread, the valve stem, or the rim bead seat, and soapy water localizes which.",
  factBucket: "wallet_protectors",
  driverEmotion: "low-grade annoyance that has quietly become a recurring chore",
  campaignKeyword: "PRESSURE",
  archetype: "one_second_hook_payoff",
  motionLens: "extreme_macro_push_in",
  objectCharacter: "valve_stem_traffic_controller",
  usefulAbsurdity: "The valve stem as an air-traffic tower that has started leaking clearance out the back door.",
  localAngle:
    "Cleveland freeze-thaw and road salt attack the alloy bead seat, so rim-corrosion leaks are common here in a way they are not in milder metros.",
  beatOutline: [
    "Bubble swells at the valve stem",
    "One tire sits softer than its neighbour",
    "Three causes as objects: nail, valve stem, rim corrosion",
    "Soapy water localizes the leak",
    "Calm loop back to the opening frame",
  ],
  loopIdea:
    "The final dry valve-stem framing matches the opening macro exactly, so the first bubble appears to begin forming again on replay.",
  captionAngle: "Reassure that monthly loss is normal, then hand over a test they can run themselves.",
  saveShareReason: "The soapy-water test is a concrete at-home action worth saving before the next top-off.",
  nickFitReason: "Tire leak diagnosis and repair is the shop's core daily service.",
  nonGenericReason:
    "Most tire content stops at tread depth; this covers leak localization, which the existing library has not.",
  rejectionRisk: "Bubble macro could read as a stock soap advert if the rim and tread context is cropped out.",
  scores: { hook: 10, truth: 10, save: 10, local: 9, absurdity: 9, fit: 10 },
};

const hashtags = ["#ClevelandMechanic", "#TireRepair", "#EuclidOhio", "#CarCareTips", "#TirePressure"];

const brief = {
  id: "pack-2026-08-20-slow-leak-soap-test",
  createdAt: "2026-08-20T17:00:00.000Z",
  updatedAt: "2026-08-20T17:00:00.000Z",
  status: "draft",
  mode: "SCHEDULED",
  topic: "Why one tire keeps losing air (tread vs. valve stem vs. rim)",
  mechanicTruth:
    "A tire that loses roughly a pound of pressure per month is behaving normally; one needing air weekly is leaking, and the three common sites are a tread puncture, a perished valve stem, and corrosion at the rim bead seat. Soapy water bubbles at the leak point localize which.",
  driverConfusion:
    "Drivers assume weekly top-offs are just cold weather, so a repairable puncture or a five-minute valve stem quietly becomes a habit instead of a fix.",
  clevelandAngle:
    "Freeze-thaw cycling and winter road salt corrode alloy bead seats here, making rim leaks a genuinely local cause rather than a textbook footnote.",
  sourceNotes: [
    {
      label: "NHTSA tire maintenance guidance (pressure loss and inspection)",
      kind: "proof",
      supports: "Tires lose pressure gradually over time and should be checked monthly.",
    },
    {
      label: "Tire Industry Association repair practice (puncture repair limited to the tread crown area)",
      kind: "proof",
      supports: "Whether a leak is repairable depends on where it is, which is why localizing it matters.",
    },
    {
      label: "Recurring shop intake question: 'I keep putting air in one tire'",
      kind: "pain_point",
      supports: "Drivers ask about repeated top-offs on a single tire.",
    },
  ],
  factBucket: "wallet_protectors",
  campaignKeyword: "PRESSURE",
  archetype: "one_second_hook_payoff",
  motionLens: "extreme_macro_push_in",
  objectCharacter: "valve_stem_traffic_controller",
  usefulAbsurdity: concept.usefulAbsurdity,
  concepts: [concept],
  winningConceptId: concept.id,
  storyboardBeats: beats,
  higgsfieldPromptPack: [],
  ffmpegAssemblyNotes:
    "Five beats hard-cut, 21s of motion, then a 3.0s frozen end card composited with logo and address. Container target 24.0s.",
  voiceoverScript:
    "Topping off the same tire every week? That's a leak. Losing a pound a month is normal. Weekly top-offs can point to a leak. Usually it's a nail, a cracked valve stem, or corrosion at the rim. Soapy water finds all three — bubbles mark the spot. Do not guess. Stop by and we'll take a look.",
  captionHooks: [
    "Topping off the same tire every week? That's not the weather.",
    "Water and dish soap will show you exactly where your tire is leaking.",
  ],
  selectedCaption:
    "Topping off the same tire every week? That's not the weather — that's a leak. A healthy tire loses about a pound a month, not a pound a week. Soapy water on the tread, the valve stem, and the rim edge will bubble right where the air is escaping. Where it bubbles decides the fix, so do not guess. Nick's Tire & Auto, 17625 Euclid Ave, Cleveland - (216) 862-0005",
  hashtags,
  avoidedForRepetition:
    "Avoided tread depth / penny test (already covered), TPMS light behaviour (covered), and plug-vs-patch repair method (covered) — this pack is leak LOCALIZATION only.",
  qualityScore: 0,
  assetPlan:
    "Cover frame = beat 1 bubble at maximum swell. Files: slowleak_b1..b5.mp4, slowleak_vo.wav, slowleak_final.mp4.",
  instagramUrl: null,
  operatorNotes: "Scheduled run, no live operator. Pack only — nothing rendered, nothing published.",
} as never;

const q = calculateReelQualityScore(brief);
const safety = runSafetyChecks(brief);
const pre = runReelPreflight(brief);

console.log("QUALITY:", q.overall + "/75", "gate=" + q.gate, "passing=" + q.passing);
for (const p of q.parts) console.log("  ", p.ok ? "PASS" : "FAIL", p.label, p.points + "/" + p.max, "-", p.detail);
console.log("CONCEPT:", scoreReelConcept(concept as never).total + "/60");
console.log("LENGTH:", JSON.stringify(validateReelLengthTarget(beats as never)));
console.log("BEATCOUNT:", JSON.stringify(validateBeatCount(beats as never)));
console.log("HASHTAGS:", JSON.stringify(validateHashtagCap(hashtags)));
console.log("SAFETY blocked=" + safety.blocked, "findings=" + safety.findings.length);
for (const f of safety.findings) console.log("   [" + f.severity + "]", f.rule, "|", f.match, "|", f.where);
console.log("PREFLIGHT:", pre.status, "blocking=" + pre.blocking.length);

// The ad-ready variants and burned-in overlays are publishable copy that the
// brief object itself does not carry, so they are scanned separately.
const extraCopy: Record<string, string> = {
  "variant A hook": "Your tire isn't losing air because it's cold.",
  "variant A caption": "Weekly top-offs mean it's leaking. Dish soap and water will show you exactly where.",
  "variant A cta": "Stop by and we'll take a look.",
  "variant B hook": "Stop topping off that one tire.",
  "variant B caption":
    "Nail, valve stem, or rim corrosion — the bubbles tell you which, and which one it is decides the fix.",
  "variant B cta": "Free check, honest answer — Nick's Tire & Auto on Euclid.",
  "end card": "NICK'S TIRE & AUTO | 17625 Euclid Ave, Cleveland | (216) 862-0005",
};
let extra = 0;
for (const [where, text] of Object.entries(extraCopy)) {
  const findings = [
    ...detectForbiddenReelClaims(text, where),
    ...detectOverdiagnosis(text, where),
    ...detectFearmongering(text, where),
    ...detectPriceClaims(text, where),
    ...detectGenericAdLanguage(text, where),
    ...detectFabricatedStats(text, where),
  ];
  extra += findings.length;
  for (const f of findings) console.log("   [" + f.severity + "]", where, "|", f.rule, "|", f.match);
}
console.log("AD-VARIANT + OVERLAY COPY findings:", extra);
