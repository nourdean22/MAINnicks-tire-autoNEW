/*
 * Faceless Reel Intelligence Studio — SAMPLE seed briefs.
 *
 * Three fully-worked example briefs so the Studio renders something real on
 * first open. Every brief is flagged isSample and titled SAMPLE; none claims
 * to have been posted (instagramUrl stays null) and no URL is fabricated —
 * source notes use accepted label-only proof families.
 */

import type { ReelBrief, ReelConcept, StoryboardBeat } from "./facelessReelStudio";

const T0 = "2026-06-10T12:00:00.000Z";

const concept = (c: Omit<ReelConcept, "id">, id: string): ReelConcept => ({ id, ...c });

// ─── SAMPLE 1 · Tire pressure / door sticker (PRESSURE · Myth Buster) ──

const pressureBeats: StoryboardBeat[] = [
  { beatNumber: 1, startSecond: 0, endSecond: 3, visual: "Extreme macro: a tire sidewall's embossed 'MAX PRESS 44 PSI' lettering, lit like a crime scene; a scan-line sweeps across it", motion: "Slow push-in with a diagnostic HUD reticle locking onto the number", onScreenText: "Everyone checks the WRONG number", purpose: "Scroll-stop: name the mistake in frame one", audioCue: "Low hum + single sonar ping on lock", safeZoneNotes: "Number centered; HUD elements inside middle 60%" },
  { beatNumber: 2, startSecond: 3, endSecond: 8, visual: "HUD flags the sidewall number with an amber 'NOT YOUR PSI' tag; the view x-rays through the tire to the door jamb", motion: "Match-cut morph from sidewall curve to door-jamb edge", onScreenText: "Sidewall = the tire's MAX. Not your car's setting.", purpose: "The myth, stated plainly", audioCue: "Soft whoosh on the morph", safeZoneNotes: "Tag text upper-middle, clear of top 12%" },
  { beatNumber: 3, startSecond: 8, endSecond: 13, visual: "The driver-door sticker glows green as the HUD locks on; the recommended PSI highlights", motion: "Reticle re-locks, green confirmation pulse", onScreenText: "Your number lives on the door sticker", purpose: "The verified truth + where to find it", audioCue: "Confirmation chime", safeZoneNotes: "Sticker centered; keep bottom 20% clear" },
  { beatNumber: 4, startSecond: 13, endSecond: 18, visual: "Split gauge animation: same tire at sticker PSI vs sidewall-max PSI; wear pattern heat-map diverges", motion: "Side-by-side gauges sweep in opposite directions", onScreenText: "Overinflated = center wear + harsh ride", purpose: "Why it matters to the wallet", audioCue: "Two gauge ticks panning L/R", safeZoneNotes: "Gauges in middle band" },
  { beatNumber: 5, startSecond: 18, endSecond: 21, visual: "The scan-line sweeps back toward the sidewall number from beat 1, dimming it as the door sticker stays lit", motion: "Pull-back that mirrors the opening push-in (loop seam)", onScreenText: "Comment PRESSURE — we'll check it when you stop by", purpose: "Soft CTA + loop handoff", audioCue: "Hum fades to the opening tone", safeZoneNotes: "CTA text middle band, clear of bottom 20%" },
];

const pressureBrief: ReelBrief = {
  id: "sample-pressure-door-sticker",
  createdAt: T0,
  updatedAt: T0,
  status: "ready_for_assets",
  mode: "draft",
  isSample: true,
  topic: "SAMPLE — The tire-pressure number most drivers check is the wrong one",
  mechanicTruth: "The PSI embossed on the tire sidewall is the tire's maximum rated pressure, not the vehicle's recommended setting; the correct spec lives on the driver-door jamb placard.",
  driverConfusion: "The sidewall number is the biggest, most visible number on the tire — so drivers inflate to it and ride around overinflated.",
  clevelandAngle: "Cleveland's big day-night temperature swings move PSI noticeably; a cold morning after a warm fill makes the sticker number matter even more.",
  sourceNotes: [
    { label: "NHTSA tire pressure guidance", kind: "proof", supports: "Door placard is the vehicle's recommended pressure; sidewall is the tire maximum" },
    { label: "Tire Rack education — inflation basics", kind: "proof", supports: "Overinflation causes center wear and harsher ride" },
    { label: "Aggregated shop questions: 'what PSI should my tires be?'", kind: "pain_point", supports: "Drivers ask this constantly at the counter" },
  ],
  factBucket: "myth_buster",
  campaignKeyword: "PRESSURE",
  archetype: "myth_vs_reality",
  motionLens: "xray_cutaway",
  objectCharacter: "tire_pressure_balloonist",
  usefulAbsurdity: "A forensic HUD treats a tire sidewall like a crime scene and acquits the door sticker.",
  concepts: [
    concept({ hook: "Everyone checks the WRONG number", coreFact: "Sidewall PSI is the max, not the spec", factBucket: "myth_buster", driverEmotion: "wait, I've been doing this wrong?", campaignKeyword: "PRESSURE", archetype: "myth_vs_reality", motionLens: "xray_cutaway", objectCharacter: "tire_pressure_balloonist", usefulAbsurdity: "HUD crime-scene treatment of a number on rubber", localAngle: "Cleveland temp swings move PSI", beatOutline: ["Macro the sidewall number", "Flag it as NOT your PSI", "Door sticker glows green", "Overinflation wear split-screen", "CTA + loop"], loopIdea: "Closing pull-back lands on the same sidewall framing the opener pushes into", captionAngle: "The biggest number on your tire is a trap", saveShareReason: "People save the 'where to find my real PSI' frame", nickFitReason: "Tire shop teaching tire truth — exactly our lane", nonGenericReason: "HUD-forensics on a door sticker is not stock-footage tire content", rejectionRisk: "HUD overlays must stay legible at phone size", scores: { hook: 10, truth: 10, save: 10, local: 9, absurdity: 10, fit: 10 } }, "c-pressure-1"),
    concept({ hook: "Your tire knows its limit. Your car knows its setting.", coreFact: "Two different numbers, two different jobs", factBucket: "myth_buster", driverEmotion: "clarity", campaignKeyword: "PRESSURE", archetype: "part_as_character_drama", motionLens: "anthropomorphized_object", objectCharacter: "tire_pressure_balloonist", usefulAbsurdity: "A balloonist whose altitude is your PSI", localAngle: "Cold mornings drop the balloonist", beatOutline: ["Balloonist rises at dawn", "Cold front hits, altitude drops", "Door sticker = flight plan", "Re-inflate to plan", "Loop"], loopIdea: "Sunrise loops to sunrise", captionAngle: "Meet the balloonist living in your tire", saveShareReason: "Cute mental model that sticks", nickFitReason: "Approachable, not salesy", nonGenericReason: "Balloonist metaphor is ownable", rejectionRisk: "Metaphor may bury the practical takeaway", scores: { hook: 8, truth: 9, save: 8, local: 8, absurdity: 9, fit: 9 } }, "c-pressure-2"),
  ],
  winningConceptId: "c-pressure-1",
  storyboardBeats: pressureBeats,
  higgsfieldPromptPack: [],
  ffmpegAssemblyNotes: "5 clips, hard cuts on beats 2/4, morph transition beat 2->3 baked into generation. Text overlays added in assembly, not generation.",
  voiceoverScript: "",
  captionHooks: [
    "The biggest number on your tire is a trap.",
    "You've been reading the wrong number.",
    "Your real PSI hides on the door, not the tire.",
    "That 44 on your sidewall? Not for you.",
    "Two numbers. Only one is yours.",
    "Cleveland mornings move this number more than you think.",
    "The door sticker outranks the sidewall. Every time.",
  ],
  selectedCaption:
    "The biggest number on your tire is a trap.\nThe sidewall shows the tire's MAX - your car's real setting lives on the driver-door sticker.\nComment PRESSURE and we'll check it when you stop by.\nNick's Tire & Auto - 17625 Euclid Ave, Cleveland - (216) 862-0005 - nickstire.org",
  hashtags: ["#ClevelandDrivers", "#TirePressure", "#CarTipsCleveland", "#EuclidAve", "#TireShopCleveland", "#CarEducation"],
  avoidedForRepetition: "Penny-test topic (used in a recent carousel sample); satisfying_loop archetype",
  qualityScore: 0,
  assetPlan: "Cover frame: beat 3 door-sticker glow with 'Your number lives here' framing; export 1080x1920 JPEG.",
  instagramUrl: null,
  operatorNotes: "SAMPLE brief — replace with a live run before any real production.",
};

// ─── SAMPLE 2 · Pothole clues (POTHOLE · Cleveland Survival) ───────

const potholeBeats: StoryboardBeat[] = [
  { beatNumber: 1, startSecond: 0, endSecond: 3, visual: "Grainy dashcam-style night shot: an empty Cleveland street, one pothole lit by a streetlight like a suspect under interrogation", motion: "Slow zoom toward the pothole, timestamp flicker", onScreenText: "CASE FILE: the hit you forgot about", purpose: "Documentary hook — the pothole as suspect", audioCue: "Tape-deck click + low drone", safeZoneNotes: "Timestamp top-left inside safe area; title middle" },
  { beatNumber: 2, startSecond: 3, endSecond: 8, visual: "Evidence-scan pass over a steering wheel held at a slight angle on a straight road (no hands visible)", motion: "UV-style scan sweep, evidence marker '1' pins the off-center wheel", onScreenText: "Clue 1: wheel sits crooked on a straight road", purpose: "First observable clue", audioCue: "Scanner sweep", safeZoneNotes: "Marker + text center band" },
  { beatNumber: 3, startSecond: 8, endSecond: 13, visual: "Evidence marker '2' pins a tire shoulder wearing faster than its center — macro tread pass", motion: "Macro dolly along the tread, wear zone highlighted", onScreenText: "Clue 2: one shoulder wearing fast", purpose: "Second clue drivers can check themselves", audioCue: "Second scanner sweep, slightly higher pitch", safeZoneNotes: "Highlight inside middle 60%" },
  { beatNumber: 4, startSecond: 13, endSecond: 17, visual: "Evidence marker '3' pins a subtle on-screen vibration blur at highway speed (dash POV, no humans)", motion: "Stabilized shot with a controlled shake on the dash silhouette", onScreenText: "Clue 3: new shake after the hit", purpose: "Third clue + ties back to the hit", audioCue: "Low rumble swells", safeZoneNotes: "Keep blur effect away from text" },
  { beatNumber: 5, startSecond: 17, endSecond: 21, visual: "The three evidence markers fly onto a corkboard with red string converging on the streetlit pothole from beat 1", motion: "Snap-zoom out to the full evidence board, then drift toward the pothole photo (loop seam)", onScreenText: "3 clues after a hit? Do not guess. Comment POTHOLE.", purpose: "Recap + soft CTA + loop", audioCue: "String tension note resolving to the opening drone", safeZoneNotes: "CTA middle band; board edges out of UI zones" },
];

const potholeBrief: ReelBrief = {
  id: "sample-pothole-clues",
  createdAt: T0,
  updatedAt: T0,
  status: "ready_for_assets",
  mode: "draft",
  isSample: true,
  topic: "SAMPLE — Three clues your car keeps after a pothole hit",
  mechanicTruth: "A hard pothole impact can knock wheel alignment out of spec; the observable signs include an off-center steering wheel, uneven shoulder tire wear, and new vibration.",
  driverConfusion: "The hit happened weeks ago and nothing 'broke', so drivers don't connect today's crooked wheel to that pothole.",
  clevelandAngle: "Freeze-thaw season turns Cleveland streets into pothole country every spring — these hits are a local routine, not an exception.",
  sourceNotes: [
    { label: "AAA pothole damage guidance", kind: "proof", supports: "Pothole impacts cause alignment and wheel/tire damage with these symptom patterns" },
    { label: "Car Care Council — alignment symptoms", kind: "proof", supports: "Off-center wheel and uneven wear indicate alignment issues worth inspecting" },
    { label: "Aggregated shop questions: 'car pulls after hitting a pothole'", kind: "pain_point", supports: "Drivers describe exactly this sequence at the counter" },
  ],
  factBucket: "cleveland_survival",
  campaignKeyword: "POTHOLE",
  archetype: "caught_on_camera_documentary",
  motionLens: "forensic_evidence_scan",
  objectCharacter: "pothole_gremlin",
  usefulAbsurdity: "A true-crime case file where the suspect is a hole in Euclid Ave.",
  concepts: [
    concept({ hook: "CASE FILE: the hit you forgot about", coreFact: "Pothole hits leave 3 observable clues", factBucket: "cleveland_survival", driverEmotion: "oh no, that WAS weeks ago", campaignKeyword: "POTHOLE", archetype: "caught_on_camera_documentary", motionLens: "forensic_evidence_scan", objectCharacter: "pothole_gremlin", usefulAbsurdity: "True-crime treatment of a road defect", localAngle: "Freeze-thaw season is pothole season here", beatOutline: ["Suspect under the streetlight", "Clue 1 crooked wheel", "Clue 2 shoulder wear", "Clue 3 new shake", "Evidence board + CTA"], loopIdea: "Board drift lands back on the streetlit pothole the opener zooms into", captionAngle: "Your car remembers the pothole you forgot", saveShareReason: "A 3-clue self-check drivers save for later", nickFitReason: "Alignment + tires are core services; teaching the clue invites the check", nonGenericReason: "Evidence-board framing beats generic 'pothole season!' posts", rejectionRisk: "Documentary grain must not read as low quality", scores: { hook: 10, truth: 10, save: 10, local: 10, absurdity: 9, fit: 10 } }, "c-pothole-1"),
    concept({ hook: "The gremlin only collects. It never returns.", coreFact: "Impacts knock alignment out", factBucket: "cleveland_survival", driverEmotion: "amused dread", campaignKeyword: "POTHOLE", archetype: "part_as_character_drama", motionLens: "tilt_shift_miniature", objectCharacter: "pothole_gremlin", usefulAbsurdity: "A tiny gremlin hoarding wheel weights in a pothole", localAngle: "Cleveland spring feeds the gremlin", beatOutline: ["Gremlin waits", "The hit", "It collects a wheel weight", "Your wheel leans left forever", "CTA"], loopIdea: "Gremlin re-settles into the same waiting pose", captionAngle: "Meet the gremlin under Euclid Ave", saveShareReason: "Character is shareable", nickFitReason: "Playful, on-brand villain", nonGenericReason: "Ownable character", rejectionRisk: "Whimsy can dilute the 3 practical clues", scores: { hook: 9, truth: 9, save: 8, local: 10, absurdity: 10, fit: 9 } }, "c-pothole-2"),
  ],
  winningConceptId: "c-pothole-1",
  storyboardBeats: potholeBeats,
  higgsfieldPromptPack: [],
  ffmpegAssemblyNotes: "Documentary grain LUT across all clips; evidence markers as assembly overlays (not generated); hard cut beats 1-4, snap-zoom transition into beat 5.",
  voiceoverScript: "",
  captionHooks: [
    "Your car remembers the pothole you forgot.",
    "Three clues. One suspect. Case open.",
    "That hit from March? Still on the record.",
    "Cleveland streets keep receipts.",
    "Crooked wheel on a straight road? Evidence.",
    "The pothole left fingerprints.",
    "Open the case file on your last big hit.",
  ],
  selectedCaption:
    "Your car remembers the pothole you forgot.\nCrooked wheel. One shoulder wearing fast. A new shake. Three clues worth checking - do not guess.\nComment POTHOLE and we'll take a look when you stop by.\nNick's Tire & Auto - 17625 Euclid Ave, Cleveland - (216) 862-0005 - nickstire.org",
  hashtags: ["#ClevelandPotholes", "#EuclidAve", "#WheelAlignment", "#ClevelandDrivers", "#CarCluesCleveland", "#TireShopCleveland", "#PotholeSeason"],
  avoidedForRepetition: "Road-salt villain topic; weather_radar_overlay lens (saved for a winter reel)",
  qualityScore: 0,
  assetPlan: "Cover frame: beat 5 evidence board with red string converging; export 1080x1920 JPEG.",
  instagramUrl: null,
  operatorNotes: "SAMPLE brief — replace with a live run before any real production.",
};

// ─── SAMPLE 3 · Brake squeal (BRAKES · Wallet Protectors) ──────────

const brakeBeats: StoryboardBeat[] = [
  { beatNumber: 1, startSecond: 0, endSecond: 3, visual: "POV from INSIDE the brake caliper: the rotor face rushes toward the viewer and stops millimeters away", motion: "First-person lunge + hard stop, dust motes drift", onScreenText: "POV: you are the brake pad", purpose: "Instant novelty hook — the viewer becomes the part", audioCue: "Muffled whoosh + soft clamp thud", safeZoneNotes: "Title centered; rotor texture fills frame safely" },
  { beatNumber: 2, startSecond: 3, endSecond: 8, visual: "Pad-POV montage: stop, stop, stop — each clamp shaves a visible micro-layer off the pad edge shown in a corner wear meter", motion: "Rhythmic clamp cycles, wear meter ticks down", onScreenText: "Every stop costs a layer", purpose: "Teach wear as a visible budget", audioCue: "Heartbeat-tempo clamps", safeZoneNotes: "Wear meter inside middle 60%, not in bottom UI zone" },
  { beatNumber: 3, startSecond: 8, endSecond: 13, visual: "The embedded metal wear-indicator tab finally touches the rotor: a tiny bright contact point sings", motion: "Macro push to the contact point; sound-wave rings ripple outward", onScreenText: "That squeal? Built-in on purpose.", purpose: "The verified truth: the squealer is a designed alert", audioCue: "Clean high squeal note, musical not painful", safeZoneNotes: "Contact point center frame" },
  { beatNumber: 4, startSecond: 13, endSecond: 18, visual: "Cutaway x-ray: pad thickness vs rotor with a 'heard early vs ignored' split — the ignored side shows rotor scoring", motion: "Split-screen wipe, scoring etches in on the right", onScreenText: "Heard early: pads. Ignored: pads + rotors.", purpose: "Wallet math without prices", audioCue: "Left side calm tone, right side gritty scrape", safeZoneNotes: "Split labels in middle band" },
  { beatNumber: 5, startSecond: 18, endSecond: 21, visual: "Return to the beat-1 POV: rotor face approaches and stops again — this time the wear meter is full after service", motion: "Same lunge as the opener with a restored meter (loop seam)", onScreenText: "Hear it once? Worth checking. Comment BRAKES.", purpose: "Loop + soft CTA", audioCue: "Clamp thud resolving to the opening whoosh", safeZoneNotes: "CTA middle band, clear of bottom 20%" },
];

const brakeBrief: ReelBrief = {
  id: "sample-brake-squeal",
  createdAt: T0,
  updatedAt: T0,
  status: "ready_for_assets",
  mode: "draft",
  isSample: true,
  topic: "SAMPLE — The brake squeal is a feature, not a failure",
  mechanicTruth: "Most brake pads include a metal wear indicator that intentionally contacts the rotor and squeals when the pad material is low — it is an early-warning device, and ignoring it long enough risks rotor damage.",
  driverConfusion: "Drivers hear the squeal, assume 'brakes are expensive', turn the radio up, and convert a pad job into a pads-plus-rotors job.",
  clevelandAngle: "Stop-and-go on Euclid Ave and salt-season moisture make Cleveland pads talk earlier and more often than highway-town pads.",
  sourceNotes: [
    { label: "Bridgestone education — brake wear indicators", kind: "proof", supports: "Wear indicators are designed to squeal as an early warning" },
    { label: "Consumer Reports — brake maintenance", kind: "proof", supports: "Delaying pad replacement can damage rotors and raise repair scope" },
    { label: "Aggregated shop questions: 'brakes squeak but feel fine'", kind: "pain_point", supports: "The exact confusion this reel resolves" },
  ],
  factBucket: "wallet_protectors",
  campaignKeyword: "BRAKES",
  archetype: "pov_you_are_the_part",
  motionLens: "product_ad_macro",
  objectCharacter: "brake_pad_lifeguard",
  usefulAbsurdity: "You live one workday as a brake pad whose smoke alarm is a song.",
  concepts: [
    concept({ hook: "POV: you are the brake pad", coreFact: "The squeal is a designed wear indicator", factBucket: "wallet_protectors", driverEmotion: "empathy for a car part (weirdly)", campaignKeyword: "BRAKES", archetype: "pov_you_are_the_part", motionLens: "product_ad_macro", objectCharacter: "brake_pad_lifeguard", usefulAbsurdity: "First-person shift work as a consumable part", localAngle: "Euclid Ave stop-and-go wears pads faster", beatOutline: ["POV clamp open", "Every stop costs a layer", "The squealer sings", "Heard vs ignored split", "Loop + CTA"], loopIdea: "Final clamp mirrors the opening lunge with a restored wear meter", captionAngle: "Your brakes told you. Politely. Once.", saveShareReason: "Reframes a scary sound as a friendly alarm — savable peace of mind", nickFitReason: "Brake checks are a core service; the reel invites a listen, not a sale", nonGenericReason: "Pad-POV beats every stock 'brake warning signs' listicle", rejectionRisk: "POV must stay readable — too abstract loses the teach", scores: { hook: 10, truth: 10, save: 10, local: 9, absurdity: 10, fit: 10 } }, "c-brakes-1"),
    concept({ hook: "The rotor is the bell. The pad is the ringer.", coreFact: "Indicator contact rings the rotor", factBucket: "wallet_protectors", driverEmotion: "aha", campaignKeyword: "BRAKES", archetype: "tiny_cinematic_story", motionLens: "xray_cutaway", objectCharacter: "rotor_alarm_bell", usefulAbsurdity: "A church-bell drama inside a wheel", localAngle: "Salt season makes morning rings common", beatOutline: ["Quiet bell", "Ringer descends", "First ring", "Why it rings", "CTA"], loopIdea: "Bell stills back to the quiet opening", captionAngle: "When the wheel rings, listen once", saveShareReason: "Strong metaphor", nickFitReason: "Calm authority", nonGenericReason: "Bell metaphor is ownable", rejectionRisk: "Slower build may lose the first-second hook", scores: { hook: 8, truth: 10, save: 9, local: 8, absurdity: 9, fit: 9 } }, "c-brakes-2"),
  ],
  winningConceptId: "c-brakes-1",
  storyboardBeats: brakeBeats,
  higgsfieldPromptPack: [],
  ffmpegAssemblyNotes: "POV clips need consistent caliper framing across beats 1/5 for the loop; wear-meter overlay added in assembly; squeal note mixed musically, never harsh.",
  voiceoverScript: "",
  captionHooks: [
    "Your brakes told you. Politely. Once.",
    "POV: you spend a workday as a brake pad.",
    "That squeal is a feature, not a failure.",
    "The polite alarm most drivers turn the radio up over.",
    "Pads sing before rotors pay.",
    "One sound separates a small job from a big one.",
    "Cleveland stop-and-go makes pads talk early.",
  ],
  selectedCaption:
    "That squeal is a feature, not a failure.\nMost pads carry a built-in metal tab that sings when material runs low - one clue, heard early, keeps the job small. Worth checking, not worth guessing.\nComment BRAKES and we'll take a listen when you stop by.\nNick's Tire & Auto - 17625 Euclid Ave, Cleveland - (216) 862-0005 - nickstire.org",
  hashtags: ["#BrakeCheck", "#ClevelandDrivers", "#EuclidAve", "#CarSoundsExplained", "#BrakesCleveland", "#CarEducation"],
  avoidedForRepetition: "Check-engine smoke-alarm character (recently used in a carousel sample); diagnostic_hud_reveal lens (used by the PRESSURE sample)",
  qualityScore: 0,
  assetPlan: "Cover frame: beat 3 bright contact point with sound rings; export 1080x1920 JPEG.",
  instagramUrl: null,
  operatorNotes: "SAMPLE brief — replace with a live run before any real production.",
};

export const SAMPLE_REEL_BRIEFS: ReelBrief[] = [pressureBrief, potholeBrief, brakeBrief];
