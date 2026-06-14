/*
 * IG Carousel Intelligence Studio — SAMPLE seed briefs.
 *
 * These exist for UI demonstration and tests only. They are clearly labelled
 * SAMPLE (isSample: true), have never been posted, and use source LABELS
 * (not live citations). Replace with generated/current content before any
 * real publishing workflow.
 */

import type { CarouselBrief, CarouselConcept, CarouselSlide } from "./igCarouselStudio";

const T0 = "2026-06-10T00:00:00.000Z";

function slides(s: Omit<CarouselSlide, "slideNumber" | "role">[]): CarouselSlide[] {
  const roles = [
    "pattern_interrupt",
    "plain_english_truth",
    "the_clue",
    "what_to_do",
    "saveable_recap",
  ] as const;
  return s.map((x, i) => ({ ...x, slideNumber: (i + 1) as 1 | 2 | 3 | 4 | 5, role: roles[i] }));
}

// ─── SAMPLE 1 · TPMS / tire pressure — Myth Courtroom ──────────────

const pressureConcepts: CarouselConcept[] = [
  {
    id: "pressure-courtroom",
    hook: "The number on your sidewall just went on trial.",
    mechanicTruth: "The sidewall number is the tire's MAXIMUM pressure, not your target. The correct spec lives on the driver-door jamb sticker.",
    driverEmotion: "Quiet doubt — 'have I been filling these wrong the whole time?'",
    campaignKeyword: "PRESSURE",
    creativeTerritory: "myth_courtroom",
    usefulAbsurdity: "A courtroom where a tire sidewall sits in the witness box under a tiny spotlight, gavel mid-strike.",
    localAngle: "Cleveland temperature swings move tire pressure roughly 1 PSI per 10°F — spring and fall mornings mislead drivers here.",
    slideOutline: [
      "Courtroom gavel + tire in witness box",
      "Verdict: sidewall = max, door jamb = target",
      "The clue: morning TPMS light that turns off by noon",
      "What to do: check cold, fill to the door-jamb number",
      "Recap card + PRESSURE keyword",
    ],
    saveShareReason: "Settles a debate most households actually have — save-to-show-someone material.",
    boostReason: "Universally relevant, zero price talk, evergreen with a seasonal spike.",
    nickFitReason: "Air checks and tire service are core Nick's work; teaching it builds the 'they explain clearly' trust.",
    nonGenericReason: "Courtroom framing + door-jamb specificity beats the generic 'check your tire pressure' post.",
    rejectionRisk: "Low — the only risk is being too text-heavy on slide 2.",
    scores: { hook: 10, truth: 10, save: 10, local: 9, absurdity: 10, fit: 10 },
  },
  {
    id: "pressure-tiny-crew",
    hook: "There's a night shift living inside your tire.",
    mechanicTruth: "Tires lose roughly 1 PSI per month naturally — slow loss is normal, fast loss is a clue.",
    driverEmotion: "Curiosity",
    campaignKeyword: "PRESSURE",
    creativeTerritory: "tiny_world",
    usefulAbsurdity: "Miniature workers with headlamps patching a glowing seam inside a tire dome.",
    localAngle: "Road salt season ends; pressure checks catch the slow leaks potholes started.",
    slideOutline: ["Tiny crew reveal", "1 PSI/month truth", "The clue: one tire lower than its siblings", "What to do", "Recap"],
    saveShareReason: "Charming visual + a number worth remembering.",
    boostReason: "Distinctive look in the feed.",
    nickFitReason: "Leads naturally to a free air check.",
    nonGenericReason: "Tiny-world craft beats stock-photo gauges.",
    rejectionRisk: "Medium — absurdity could overpower the teaching if slide 2 is weak.",
    scores: { hook: 9, truth: 9, save: 8, local: 7, absurdity: 9, fit: 9 },
  },
  {
    id: "pressure-weather-alert",
    hook: "Tonight's forecast: your TPMS light at 7 a.m.",
    mechanicTruth: "A 30°F overnight drop can pull tire pressure below threshold and trigger the TPMS light by morning.",
    driverEmotion: "Recognition — 'that exact thing happened to me'",
    campaignKeyword: "TPMS",
    creativeTerritory: "weather_local_alert",
    usefulAbsurdity: "A weather anchor pointing at a radar map of glowing TPMS icons over the east side.",
    localAngle: "Lake-effect temperature swings make this a Cleveland-specific morning ritual.",
    slideOutline: ["Forecast frame", "Cold = lower PSI truth", "The clue: light off by lunch", "What to do", "Recap"],
    saveShareReason: "Explains a recurring morning mystery.",
    boostReason: "High recognition factor in late fall.",
    nickFitReason: "Free check invitation fits perfectly.",
    nonGenericReason: "Forecast framing is ownable.",
    rejectionRisk: "Seasonal — weaker in summer.",
    scores: { hook: 9, truth: 9, save: 8, local: 9, absurdity: 7, fit: 9 },
  },
];

const samplePressure: CarouselBrief = {
  id: "sample-pressure",
  createdAt: T0,
  updatedAt: T0,
  status: "draft",
  mode: "draft",
  isSample: true,
  topic: "The sidewall is not your target pressure",
  mechanicTruth:
    "The PSI printed on the sidewall is the tire's maximum rated pressure. The vehicle's correct spec is on the driver-door jamb placard, and pressure should be checked cold.",
  driverConfusion: "Drivers fill to the big number on the tire because it looks official.",
  clevelandAngle: "Cleveland's big day-night temperature swings move PSI enough to confuse anyone who filled to the wrong number.",
  seasonality: "Spring/fall mornings; first cold snap.",
  sourceNotes: [
    { label: "AAA tire pressure guidance", kind: "proof", supports: "Door-jamb placard is the correct spec; check cold." },
    { label: "Tire Rack inflation education", kind: "proof", supports: "Sidewall number = max pressure, not recommended pressure." },
    { label: "Google autocomplete: 'why is my tire light on in the morning'", kind: "pain_point", supports: "Drivers actually ask this." },
  ],
  campaignKeyword: "PRESSURE",
  creativeTerritory: "myth_courtroom",
  usefulAbsurdity: "Put the sidewall number on trial — verdict framing makes the correction memorable.",
  concepts: pressureConcepts,
  winningConceptId: "pressure-courtroom",
  slides: slides([
    {
      headline: "THIS NUMBER IS LYING TO YOU*",
      body: "*Well — it's answering a different question.",
      visualPrompt:
        "Dramatic courtroom scene, a single car tire seated in a wooden witness box, harsh single spotlight, dust in the air, cinematic 35mm, dark mahogany tones, clean empty space upper third for overlay.",
      textOverlayPlan: "Headline top third, white condensed caps; asterisk line small near bottom.",
      qaNotes: "No readable text in the render itself.",
    },
    {
      headline: "Sidewall = MAX. Door jamb = TARGET.",
      body: "The sidewall prints the most the tire can hold. Your car's correct number is on the sticker inside the driver's door.",
      visualPrompt:
        "Split composition: left, macro tire sidewall embossing out of focus; right, a glowing driver-door jamb sticker, shallow depth of field, garage lighting, negative space center for overlay.",
      textOverlayPlan: "Two-line verdict centered; small 'check it cold' footnote.",
      qaNotes: "Door sticker must be generic — no real VIN or plate.",
    },
    {
      headline: "The clue: a morning light that quits by noon",
      body: "Cold air shrinks, pressure drops, the light comes on. Sun warms the tire, it turns off. That pattern is information.",
      visualPrompt:
        "Dawn driveway scene, frost on glass, amber TPMS icon reflected softly in a side mirror, cool blue palette, copy space on the right half.",
      textOverlayPlan: "Headline right side; tiny clock icons 7am/12pm.",
      qaNotes: "TPMS icon as reflection, not dashboard text.",
    },
    {
      headline: "Do this: check cold, fill to the door number",
      body: "Before driving, not after. If one tire keeps drifting lower than its siblings, do not guess — that's a slow-leak clue worth checking.",
      visualPrompt:
        "Overhead flat-lay of a quality tire gauge on clean concrete, morning light, one chalk arrow pointing to a door-jamb sticker illustration, lots of top copy space.",
      textOverlayPlan: "Checklist style, two lines.",
      qaNotes: "Keep gauge brandless.",
    },
    {
      headline: "Save this before the next cold snap",
      body: "Sidewall = max. Door jamb = target. Check cold. One low tire = clue. Stop by for a free check — no guessing required.",
      visualPrompt:
        "Clean recap card aesthetic: deep navy field, subtle tire-tread texture border, generous center negative space, premium print-ad lighting.",
      textOverlayPlan: "Recap bullets centered; PRESSURE keyword chip bottom.",
      qaNotes: "This slide is mostly overlay by design.",
    },
  ]),
  higgsfieldPrompts: [], // derived view — built from slides via buildHiggsfieldPromptPack
  typographyPlan: "Condensed bold caps for headlines (white/amber), humanist sans for body overlays, keyword chip in brand gold.",
  captionHooks: [
    "The big number on your tire is answering a question you didn't ask.",
    "Your door jamb knows something your sidewall doesn't.",
    "That morning tire light isn't broken — it's early.",
    "We watched someone fill all four tires to the wrong number yesterday.",
    "Cold mornings don't lie. Sidewalls kind of do.",
    "Two numbers. Only one of them is about YOUR car.",
    "The light is not the diagnosis. It is the smoke alarm.",
    "Cleveland mornings run a quiet experiment on your tires.",
    "If your tire light quits by lunch, read this.",
    "Your car usually gives clues before it gives you a bill.",
  ],
  selectedCaption:
    "The big number on your tire is answering a question you didn't ask.\n\nSidewall PSI = the tire's maximum. Your car's real target lives on the driver-door jamb sticker — and it wants to be checked cold, before you drive.\n\nCleveland drivers ask us this all the time, especially the first cold week. One tire reading lower than its siblings? Do not guess — that's usually a slow leak telling on itself.",
  hashtags: ["cleveland", "euclid", "tirepressure", "tpms", "cartips", "clevelanddrivers", "tireshop"],
  avoidedForRepetition: "Skipped TREAD-depth topic — used in a recent post per content log.",
  boostScore: 0,
  assetPaths: [],
  instagramUrl: null,
  operatorNotes: "SAMPLE seed brief — replace with generated/current content before publishing.",
};

// ─── SAMPLE 2 · Pothole clues — CSI / Evidence Board ────────────────

const potholeConcepts: CarouselConcept[] = [
  {
    id: "pothole-csi",
    hook: "Potholes leave receipts.",
    mechanicTruth: "A hard pothole hit can bend a rim, knock alignment out, or bruise a tire's sidewall — and each failure leaves a distinct, checkable clue.",
    driverEmotion: "Suspicion after a hit — 'did that just cost me money?'",
    campaignKeyword: "POTHOLE",
    creativeTerritory: "csi_evidence_board",
    usefulAbsurdity: "An evidence board with red string connecting a pothole photo to a wobbly steering wheel, a bulged sidewall, and a crooked steering-wheel-while-straight photo.",
    localAngle: "East-side spring streets after freeze-thaw season are pothole bingo cards.",
    slideOutline: ["Evidence board reveal", "Three damage truths", "The clue set: pull, wobble, bulge", "What to do after a hit", "Recap"],
    saveShareReason: "A checkable after-the-hit checklist people genuinely keep.",
    boostReason: "Every Cleveland driver has a pothole story; recognition is instant.",
    nickFitReason: "Alignment checks and tire inspection are exactly Nick's lane.",
    nonGenericReason: "Evidence-board craft beats 'watch out for potholes' fluff.",
    rejectionRisk: "Low.",
    scores: { hook: 10, truth: 10, save: 10, local: 10, absurdity: 9, fit: 10 },
  },
  {
    id: "pothole-villain",
    hook: "Meet the most expensive villain on your street.",
    mechanicTruth: "Pothole impact force rises sharply with speed; slowing before the hit (without swerving blind) reduces damage.",
    driverEmotion: "Grim humor",
    campaignKeyword: "POTHOLE",
    creativeTerritory: "road_villain",
    usefulAbsurdity: "A pothole with a tiny villain monocle and a ledger of 'collected' rims.",
    localAngle: "Freeze-thaw is the villain's origin story.",
    slideOutline: ["Villain intro", "Physics truth", "The clue", "What to do", "Recap"],
    saveShareReason: "Funny + true.",
    boostReason: "Meme energy with substance.",
    nickFitReason: "Post-hit checks.",
    nonGenericReason: "Character framing is ownable.",
    rejectionRisk: "Medium — humor can dilute the checklist.",
    scores: { hook: 9, truth: 8, save: 8, local: 9, absurdity: 9, fit: 9 },
  },
  {
    id: "pothole-before-bill",
    hook: "The $0 minute that saves the $400 month.",
    mechanicTruth: "A two-minute post-hit walkaround (tire face, sidewall, rim lip, steering feel) catches most pothole damage early.",
    driverEmotion: "Relief-seeking",
    campaignKeyword: "POTHOLE",
    creativeTerritory: "before_the_bill",
    usefulAbsurdity: "A literal fork-in-the-road timeline rendered as two diverging streets.",
    localAngle: "Spring street budgets vs your suspension.",
    slideOutline: ["Timeline split", "Walkaround truth", "Clues", "What to do", "Recap"],
    saveShareReason: "Two-minute ritual people adopt.",
    boostReason: "Loss-aversion framing without fear.",
    nickFitReason: "Free look invitation.",
    nonGenericReason: "Timeline visual.",
    rejectionRisk: "Medium — '$400' style numbers must stay OUT of copy (price rule); keep it abstract.",
    scores: { hook: 8, truth: 9, save: 9, local: 8, absurdity: 7, fit: 9 },
  },
];

const samplePothole: CarouselBrief = {
  id: "sample-pothole",
  createdAt: T0,
  updatedAt: T0,
  status: "draft",
  mode: "draft",
  isSample: true,
  topic: "Potholes leave receipts",
  mechanicTruth:
    "A serious pothole hit can bend a rim, push alignment out of spec, or damage a tire internally — and each shows a distinct clue: steering pull, new vibration at speed, or a sidewall bulge.",
  driverConfusion: "After a hard hit, drivers don't know whether to worry or what to even look for.",
  clevelandAngle: "Freeze-thaw cycles crater Cleveland streets every spring; pothole hits are a shared local experience.",
  seasonality: "Late winter through spring.",
  sourceNotes: [
    { label: "AAA pothole damage guidance", kind: "proof", supports: "Pothole impacts cause tire, wheel, and alignment damage; post-hit inspection recommended." },
    { label: "NHTSA tire safety education", kind: "proof", supports: "Sidewall bulges indicate internal damage and warrant inspection." },
    { label: "Reddit r/Cleveland pothole threads", kind: "pain_point", supports: "Locals actively complain and ask what to check after hits." },
  ],
  campaignKeyword: "POTHOLE",
  creativeTerritory: "csi_evidence_board",
  usefulAbsurdity: "Treat the aftermath like a crime scene — the car is the witness, the clues are checkable.",
  concepts: potholeConcepts,
  winningConceptId: "pothole-csi",
  slides: slides([
    {
      headline: "POTHOLES LEAVE RECEIPTS",
      body: "Your car keeps the evidence.",
      visualPrompt:
        "Detective evidence board, cork texture, polaroids of a cratered street and a car wheel connected by red string, moody desk lamp lighting, film grain, clean upper band for overlay.",
      textOverlayPlan: "Headline across top band in stencil caps.",
      qaNotes: "Polaroids blurred enough to avoid fake-text artifacts.",
    },
    {
      headline: "Three things a hard hit can actually do",
      body: "Bend a rim. Shift alignment. Bruise the tire from the inside. None of them announce themselves politely.",
      visualPrompt:
        "Triptych composition: macro rim lip, steering wheel slightly off-center while road is straight, subtle tire sidewall bulge — garage documentary style, neutral tones, left-side copy space.",
      textOverlayPlan: "Three short labels, one per panel.",
      qaNotes: "Keep damage realistic, not catastrophic.",
    },
    {
      headline: "The clue set",
      body: "Car pulling to one side. New shake at highway speed. A bump or bulge on the sidewall. If your car changed after a hit, do not guess.",
      visualPrompt:
        "Single magnifying glass over a tire sidewall, dramatic but warm light, evidence-tag props, generous right-side negative space.",
      textOverlayPlan: "Three-clue checklist right side.",
      qaNotes: "Evidence tags blank — overlay adds labels.",
    },
    {
      headline: "What to do after a hard hit",
      body: "Two-minute walkaround: tire faces, sidewalls, rim edges. Then drive a quiet street and feel for pull or shake. Anything new is worth checking.",
      visualPrompt:
        "Overhead of a person crouched by a front wheel doing a walkaround, golden-hour driveway, honest documentary feel, top copy space.",
      textOverlayPlan: "Numbered 1-2-3 steps top.",
      qaNotes: "No branding on clothing.",
    },
    {
      headline: "Save this for pothole season",
      body: "Pull. Shake. Bulge. Three clues, two minutes, zero guessing. We see this after pothole hits — come by and we'll take a look.",
      visualPrompt:
        "Recap card: asphalt texture background with one stylized crack, evidence-tag motif corners, large central negative space, premium print finish.",
      textOverlayPlan: "Recap bullets + POTHOLE keyword chip.",
      qaNotes: "Mostly overlay by design.",
    },
  ]),
  higgsfieldPrompts: [],
  typographyPlan: "Stencil/condensed caps headlines, evidence-tag accent labels, keyword chip in brand gold.",
  captionHooks: [
    "Potholes leave receipts. Your car keeps them.",
    "That clunk had a paper trail.",
    "Cleveland streets file their paperwork in your suspension.",
    "Three clues your car saves after a hard hit.",
    "If your car changed after a hit, do not guess.",
    "The pothole is gone. The evidence isn't.",
    "Your steering wheel is pointing at the suspect.",
    "We see this after pothole hits — every spring.",
    "A two-minute walkaround beats a mystery vibration.",
    "Spring pothole season has a checklist. Save it.",
  ],
  selectedCaption:
    "Potholes leave receipts. Your car keeps them.\n\nA hard hit can bend a rim, shift alignment, or bruise a tire from the inside — and each one leaves a clue: a pull to one side, a new shake at speed, a bulge on the sidewall.\n\nWe see this after pothole hits all spring. If your car changed after a hit, do not guess — a two-minute look beats a month of wondering.",
  hashtags: ["cleveland", "euclid", "potholeseason", "alignment", "tiredamage", "clevelanddrivers", "cartips"],
  avoidedForRepetition: "Skipped ALIGNMENT keyword — used recently; POTHOLE chosen instead.",
  boostScore: 0,
  assetPaths: [],
  instagramUrl: null,
  operatorNotes: "SAMPLE seed brief — replace with generated/current content before publishing.",
};

// ─── SAMPLE 3 · Brake squeal — Warning System ───────────────────────

const brakesConcepts: CarouselConcept[] = [
  {
    id: "brakes-warning",
    hook: "That squeal is a clue, not a verdict.",
    mechanicTruth: "Many brake pads include a built-in wear indicator that squeals on purpose as pads get low — it's an early-warning feature, not proof of failure.",
    driverEmotion: "Anxiety the system can convert to competence.",
    campaignKeyword: "BRAKES",
    creativeTerritory: "warning_system",
    usefulAbsurdity: "The wear-indicator tab drawn as a tiny whistle-blowing referee inside the wheel.",
    localAngle: "Around here, road salt works quietly — winter residue makes some morning squeals temporary, which is exactly why patterns matter.",
    slideOutline: ["Sound-wave pattern interrupt", "Wear-indicator truth", "Clue: when/what kind of squeal", "What to do", "Recap"],
    saveShareReason: "Converts a scary sound into a readable signal.",
    boostReason: "A lot of brake conversations start with this sound.",
    nickFitReason: "Brake checks are core Nick's work; calm teaching builds trust.",
    nonGenericReason: "Referee-whistle metaphor + pattern-reading beats 'squealing? come in now!' fear posts.",
    rejectionRisk: "Low — must keep diagnosis soft (sound ≠ verdict).",
    scores: { hook: 9, truth: 10, save: 9, local: 8, absurdity: 8, fit: 10 },
  },
  {
    id: "brakes-translation",
    hook: "Brake noises, translated.",
    mechanicTruth: "Squeal, grind, and pulse are different signals: squeal can be the wear indicator; grind may indicate metal contact; pulsing can point to rotor issues.",
    driverEmotion: "Curiosity",
    campaignKeyword: "BRAKES",
    creativeTerritory: "mechanic_translation",
    usefulAbsurdity: "A phrasebook page: 'Squeak — early heads-up. Grind — stop guessing.'",
    localAngle: "Salt-season mornings add temporary squeaks — the phrasebook teaches the difference.",
    slideOutline: ["Phrasebook cover", "Three sounds", "Clue patterns", "What to do", "Recap"],
    saveShareReason: "Reference-card energy.",
    boostReason: "Highly saveable.",
    nickFitReason: "Invites a listen-and-look visit.",
    nonGenericReason: "Translation framing.",
    rejectionRisk: "Medium — must avoid hard diagnosis per sound.",
    scores: { hook: 8, truth: 9, save: 10, local: 7, absurdity: 7, fit: 9 },
  },
  {
    id: "brakes-body-language",
    hook: "Your car talks with its feet.",
    mechanicTruth: "Brake feel (soft pedal, pulsing, pull under braking) communicates as much as sound does.",
    driverEmotion: "Recognition",
    campaignKeyword: "BRAKES",
    creativeTerritory: "car_body_language",
    usefulAbsurdity: "A car rendered mid-gesture like a mime, 'speaking' through stance.",
    localAngle: "Stop-and-go on Euclid Ave is a daily brake conversation.",
    slideOutline: ["Mime car", "Feel truths", "Clues", "What to do", "Recap"],
    saveShareReason: "Novel framing.",
    boostReason: "Distinct visual.",
    nickFitReason: "Brake checks.",
    nonGenericReason: "Body-language metaphor.",
    rejectionRisk: "Medium-high — abstract visual may underperform.",
    scores: { hook: 8, truth: 8, save: 8, local: 7, absurdity: 8, fit: 9 },
  },
];

const sampleBrakes: CarouselBrief = {
  id: "sample-brakes",
  createdAt: T0,
  updatedAt: T0,
  status: "draft",
  mode: "draft",
  isSample: true,
  topic: "That squeal is a clue",
  mechanicTruth:
    "Many brake pads have a built-in wear indicator designed to squeal as the pad gets low — an early-warning signal. Persistent squeal, grinding, or a change in pedal feel are different clues with different meanings.",
  driverConfusion: "Drivers hear any brake noise and jump straight to 'my brakes are shot' — or ignore it entirely.",
  clevelandAngle: "Salt season leaves residue that can cause temporary morning squeaks, so locals learn to read the PATTERN, not panic at one sound.",
  seasonality: "Late winter into spring (post-salt), plus any season for wear indicators.",
  sourceNotes: [
    { label: "Car Care Council brake maintenance education", kind: "proof", supports: "Wear indicators squeal by design as an early warning." },
    { label: "Bridgestone brake noise education", kind: "proof", supports: "Different brake noises point to different causes; persistent noise warrants inspection." },
    { label: "Google autocomplete: 'brakes squeak in the morning'", kind: "pain_point", supports: "Common driver confusion worth addressing." },
  ],
  campaignKeyword: "BRAKES",
  creativeTerritory: "warning_system",
  usefulAbsurdity: "The wear tab as a tiny referee blowing a whistle — the squeal is the system DOING ITS JOB.",
  concepts: brakesConcepts,
  winningConceptId: "brakes-warning",
  slides: slides([
    {
      headline: "THAT SQUEAL IS A CLUE",
      body: "Not a verdict.",
      visualPrompt:
        "Stylized sound wave erupting from a car wheel in profile, high-contrast studio lighting, deep charcoal background with one amber wave, large top negative space.",
      textOverlayPlan: "Headline top, sub-line under the wave.",
      qaNotes: "Wave abstract — no lettering in render.",
    },
    {
      headline: "Some pads squeal ON PURPOSE",
      body: "Many pads carry a small wear indicator that sings when material runs low. It's an early-warning feature — the smoke alarm, not the fire.",
      visualPrompt:
        "Macro cutaway-style shot of a brake pad with the wear-indicator tab gently highlighted in amber glow, technical-illustration mood, blueprint hints, right-side copy space.",
      textOverlayPlan: "Headline + one explainer line right side.",
      qaNotes: "Cutaway look without fake schematic text.",
    },
    {
      headline: "Read the pattern, not the panic",
      body: "Morning-only squeak after salt season? Often temporary. Squeal that stays all day? Heads-up. Grinding or a pedal that feels different? Do not guess.",
      visualPrompt:
        "Three-panel rhythm strip like a heartbeat monitor for sounds: soft blip, steady tone, jagged spike — clinical-clean aesthetic with warm accents, bottom copy space.",
      textOverlayPlan: "One label per panel, bottom band.",
      qaNotes: "Monitor lines abstract, no words baked in.",
    },
    {
      headline: "What to do",
      body: "Note when it happens, what it sounds like, and whether the pedal changed. Then have it looked at — a quick listen-and-look beats weeks of wondering.",
      visualPrompt:
        "Notebook-and-keys flat-lay on a workbench, warm shop lighting, honest and calm, generous top copy space.",
      textOverlayPlan: "Three-question checklist top.",
      qaNotes: "Notebook pages blank.",
    },
    {
      headline: "Save this sound guide",
      body: "Squeal can be the early warning. Grind means stop guessing. New pedal feel is worth checking. A lot of brake conversations start with this sound — we'll take a look.",
      visualPrompt:
        "Recap card: charcoal field, single amber sound-wave motif border, premium print-ad finish, large central negative space.",
      textOverlayPlan: "Recap bullets + BRAKES keyword chip.",
      qaNotes: "Overlay-first slide.",
    },
  ]),
  higgsfieldPrompts: [],
  typographyPlan: "High-contrast condensed caps, amber accent on key words, keyword chip in brand gold.",
  captionHooks: [
    "That squeal is a clue, not a verdict.",
    "Some brake pads squeal on purpose. Really.",
    "A lot of brake conversations start with this sound.",
    "The squeak has a schedule. Learn to read it.",
    "Around here, road salt works quietly.",
    "Your brakes have a built-in heads-up. Most people panic at it.",
    "Morning squeak vs all-day squeal — different stories.",
    "The light is not the diagnosis. Neither is the sound.",
    "Grinding means stop guessing.",
    "Your car usually gives clues before it gives you a bill.",
  ],
  selectedCaption:
    "That squeal is a clue, not a verdict.\n\nMany brake pads carry a built-in wear indicator that's DESIGNED to squeal as the pad gets low — an early heads-up, not a failure announcement. Salt-season mornings can add their own temporary squeaks, which is why the pattern matters more than the panic.\n\nSqueal that stays all day, any grinding, or a pedal that suddenly feels different? Do not guess — stop by and we'll take a look.",
  hashtags: ["cleveland", "euclid", "brakes", "brakecheck", "cartips", "clevelanddrivers", "autorepair"],
  avoidedForRepetition: "Skipped NOISE keyword — adjacent post ran recently; BRAKES chosen.",
  boostScore: 0,
  assetPaths: [],
  instagramUrl: null,
  operatorNotes: "SAMPLE seed brief — replace with generated/current content before publishing.",
};

export const SAMPLE_BRIEFS: CarouselBrief[] = [samplePressure, samplePothole, sampleBrakes];
