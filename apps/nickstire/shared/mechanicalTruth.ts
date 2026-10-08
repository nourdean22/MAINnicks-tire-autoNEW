/**
 * Mechanical Truth Packets (2026-10-08) — the technical facts a piece of
 * content may rest on, per recurring topic, and the shortcuts it may never
 * imply.
 *
 * WHY A SEPARATE LAYER. reelClaimAudit.ts vetoes scripts a human has already
 * condemned, keyed to past jobs and their wording. Nothing stopped a NEW script
 * from teaching an unsafe shortcut — "a plug is a permanent fix", "sidewall
 * punctures can be patched" — in words no audited reel happened to use. Those
 * are not brand-voice problems; a polished reel that teaches one is worse than
 * no reel. So the prohibited patterns here block at the same publish door
 * (condemnedContentProblem), whatever a human approved.
 *
 * STATUS IS STATED, NOT IMPLIED. Each packet records who approved it. Until a
 * Nick's technician signs a packet, `technicianApproval` is null: the sourced
 * regulator / trade facts still apply (they come from NHTSA, USTMA, Ohio EPA and
 * the Car Care Council, not from us), but nothing here claims shop sign-off it
 * does not have. A packet with no source states only cautious, multi-cause
 * facts and prohibits certainty. Packets carry a
 * review-by date; a stale packet is a reason to re-read the sources, not a
 * reason to stop blocking.
 *
 * PATTERNS ARE NARROW ON PURPOSE. Each one matches an AFFIRMATIVE unsafe claim
 * and is tested against every caption, concept and approved pack in the repo
 * (mechanicalTruth.test.ts) so a correct sentence like "in the sidewall,
 * usually not repairable" is never blocked.
 */

export type TruthTopic =
  | "puncture_repair"
  | "tread_depth"
  | "uneven_wear"
  | "vibration"
  | "pothole_damage"
  | "brake_wear"
  | "echeck_readiness"
  | "no_start";

export interface ProhibitedClaim {
  id: string;
  pattern: RegExp;
  /** Why it is wrong, in words an operator can act on. */
  reason: string;
}

export interface TruthPacket {
  topic: TruthTopic;
  version: string;
  sources: Array<{ name: string; url: string; tier: "regulator" | "trade" }>;
  /** Statements content may make on this topic. */
  allowed: string[];
  prohibited: ProhibitedClaim[];
  technicianApproval: null | { by: string; at: string };
  reviewBy: string;
}

const TRUTH_PACKETS: readonly TruthPacket[] = [
  {
    topic: "puncture_repair",
    version: "2026-10-08",
    sources: [
      { name: "USTMA — Tire Repair Basics", url: "https://www.ustires.org/tire-care-safety/tire-repair-basics", tier: "trade" },
      { name: "USTMA — Puncture Repair Procedures for Passenger and Light Truck Tires", url: "https://www.ustires.org/resources/puncture-repair-procedures-passenger-and-light-truck-tires-0", tier: "trade" },
    ],
    allowed: [
      "A puncture in the tread area is often repairable.",
      "A proper repair means taking the tire off the wheel, inspecting it inside, and filling the hole with a plug (stem) plus sealing it with an inside patch.",
      "Punctures in the sidewall or shoulder, or larger than 1/4 inch, are not repairable; the tire is replaced.",
    ],
    prohibited: [
      {
        id: "plug_alone_is_proper_repair",
        pattern: /\bplug(?:s|ged|ging)?\b[^.!\n]{0,40}\b(?:is|are|=|makes? (?:it|for))\b[^.!\n]{0,20}\b(?:permanent|proper|complete|full|real|safe) (?:fix|repair)/i,
        reason: "A plug alone is not a complete repair: the tire must come off the wheel and get a plug plus an inside patch (USTMA).",
      },
      {
        id: "sidewall_is_repairable",
        // The first span may cross a "?" on purpose: "Nail in the sidewall? It
        // can be patched" is the question-then-answer shape a script uses.
        // Affirmative forms only. "No patch fixes a sidewall" and "can't be
        // repaired — the sidewall" are the CORRECT statement and must pass, so
        // the verb-first form needs a subject that can do the repair.
        pattern: /\b(?:sidewall|shoulder)\b[^.!\n]{0,40}\b(?:can|could|will) be (?:patched|plugged|repaired|fixed)\b|\b(?:we|you|they|shops?) (?:can|could|will) (?:patch|plug|repair|fix) (?:a |the |your |any )?(?:sidewall|shoulder)\b/i,
        reason: "Sidewall and shoulder punctures are not repairable; the tire is replaced (USTMA).",
      },
      {
        id: "every_puncture_repairable",
        pattern: /\b(?:every|any|all) (?:nail|nails|puncture|punctures|screw|screws)\b[^.!\n]{0,25}\b(?:is|are|can be) (?:repairable|patched|plugged|fixed|repaired)\b/i,
        reason: "Only tread-area injuries up to 1/4 inch are repairable (USTMA); not every puncture is.",
      },
    ],
    technicianApproval: null,
    reviewBy: "2027-04-08",
  },
  {
    topic: "tread_depth",
    version: "2026-10-08",
    sources: [
      { name: "NHTSA — Tires", url: "https://www.nhtsa.gov/vehicle-safety/tires", tier: "regulator" },
    ],
    allowed: [
      "Tires should be replaced when tread is worn down to 2/32 of an inch (NHTSA).",
      "Lower tread channels less water, so wet grip drops before the tire is bald.",
    ],
    prohibited: [
      {
        id: "safe_until_bald",
        pattern: /\b(?:safe|fine|good|okay|ok)\b[^.!\n]{0,20}\b(?:until|till|unless) (?:they(?:'re| are)|it(?:'s| is)|the tires? (?:are|is)) bald\b/i,
        reason: "NHTSA says to replace tires at 2/32 inch, well before bald.",
      },
      {
        id: "two_32_is_plenty",
        pattern: /\b2\/32(?:"|-inch| inch|nds?)?\b[^.!\n]{0,15}\b(?:is|=) (?:plenty|safe|fine|good|enough)\b/i,
        reason: "2/32 inch is the replace-now point (NHTSA), not a comfortable margin.",
      },
      {
        id: "wrong_legal_minimum",
        // Requires the number to BE the legal limit ("4/32 is the legal
        // minimum"), so "5/32 — not the legal minimum" and "double the legal
        // minimum" pass.
        pattern: /\b(?:[3-9]|1[0-9])\/32(?:"|-inch| inch|nds?)?(?: of an inch)?,? (?:is|=) (?:the )?(?:legal|law|legally required) (?:minimum|limit)\b/i,
        reason: "The commonly cited legal minimum is 2/32 inch; stating a different legal limit is a claim about the law we cannot back.",
      },
    ],
    technicianApproval: null,
    reviewBy: "2027-04-08",
  },
  {
    topic: "uneven_wear",
    version: "2026-10-08",
    sources: [
      { name: "NHTSA — Tires", url: "https://www.nhtsa.gov/vehicle-safety/tires", tier: "regulator" },
    ],
    allowed: [
      "Uneven wear can point to alignment, inflation, worn suspension parts or skipped rotations; an inspection tells which.",
    ],
    prohibited: [
      {
        id: "uneven_wear_always_alignment",
        pattern: /\buneven (?:tire )?(?:tread )?wear\b[^.!\n]{0,25}(?<!almost )\b(?:always|definitely|100%|guaranteed|for sure)\b[^.!\n]{0,25}\b(?:alignment|suspension)\b/i,
        reason: "Uneven wear has several causes (inflation, alignment, suspension, rotation); naming one as certain is a diagnosis by video.",
      },
    ],
    technicianApproval: null,
    reviewBy: "2027-04-08",
  },
  {
    topic: "vibration",
    version: "2026-10-08",
    sources: [],
    allowed: [
      "A shake at highway speed is often wheel balance, but alignment, a damaged tire or worn parts can cause it too; an inspection tells which.",
    ],
    prohibited: [
      {
        id: "vibration_single_certain_cause",
        pattern: /\b(?:shak(?:e|es|ing)|vibrat(?:e|es|ion|ing)|shimm(?:y|ies))\b[^.!\n]{0,40}(?<!almost )\b(?:always|definitely|100%|guaranteed|for sure)\b[^.!\n]{0,25}\b(?:balance|alignment|rotors?|tie rods?|bearing)\b/i,
        reason: "Vibration has several causes; stating one as certain is a diagnosis without inspection.",
      },
    ],
    technicianApproval: null,
    reviewBy: "2027-04-08",
  },
  {
    topic: "pothole_damage",
    version: "2026-10-08",
    sources: [],
    allowed: [
      "A hard pothole hit can damage a tire, wheel, alignment or suspension; damage is not always visible, so a check after a hard hit is reasonable.",
    ],
    prohibited: [
      {
        id: "pothole_certain_damage",
        pattern: /\bpothole\b[^.!\n]{0,50}(?<!almost )\b(?:always|definitely|guaranteed to|will always)\b[^.!\n]{0,20}\b(?:bend|crack|break|damage|ruin|knock)/i,
        reason: "Not every pothole hit causes damage; claiming it always does is fear marketing.",
      },
      {
        id: "pothole_no_feel_no_damage",
        pattern: /\b(?:if|when) (?:you|it) (?:don'?t|doesn'?t|didn'?t) (?:feel|notice|hear) [^.!\n]{0,40}\b(?:no damage|you'?re fine|nothing(?:'s| is) wrong|it'?s fine)\b/i,
        reason: "Pothole damage is not always felt; telling drivers they are fine if they felt nothing is unsafe advice.",
      },
    ],
    technicianApproval: null,
    reviewBy: "2027-04-08",
  },
  {
    // Pilot A004 (inner pad gone, outer pad still thick), A049, A054.
    topic: "brake_wear",
    version: "2026-10-08",
    sources: [
      { name: "Car Care Council — Stop and Check Your Brakes", url: "https://www.carcare.org/?p=65", tier: "trade" },
    ],
    allowed: [
      "Pulling to one side, odd noises when braking, a brake warning light, grabbing, vibration, or a pedal that feels low or hard are reasons to have the brakes inspected (Car Care Council).",
      "An inspection measures pad wear and rotor thickness and checks the fluid, hoses and lines; the pad you can see through the wheel is only one of the pads.",
      "Brakes should never be run down to metal-to-metal: it is unsafe and makes the repair cost more (Car Care Council).",
    ],
    prohibited: [
      {
        id: "grinding_is_normal",
        // "isn't normal", "is not normal" and "can't wait" are the correct
        // statements and must pass.
        pattern: /\bgrind(?:s|ing)?\b[^.!\n]{0,30}\b(?:is|are|it(?:['’]s| is)|sounds?) (?:normal|harmless|fine|nothing to worry about)\b|\bgrind(?:s|ing)?\b[^.!\n]{0,40}\bcan wait\b/i,
        reason: "Grinding can mean the pads are worn to metal, and the Car Care Council says brakes should never reach metal-to-metal; it is not normal and not something to wait on.",
      },
      {
        id: "visible_pad_means_brakes_fine",
        pattern: /\b(?:if|when) (?:the |your )?(?:outer |outside )?pads? (?:look|looks|is|are) (?:fine|good|thick|okay|ok)\b[^.!\n]{0,40}\b(?:(?:your |the )?brakes? (?:are|is)|you(?:['’]re| are)) (?:fine|good|okay|ok|good to go)\b/i,
        reason: "The pad you can see through the wheel is only one of the pads; the inner pad can be worn out while the outer one looks thick, so an inspection measures them all.",
      },
    ],
    technicianApproval: null,
    reviewBy: "2027-04-08",
  },
  {
    // Pilot A007 (E-Check says not ready).
    topic: "echeck_readiness",
    version: "2026-10-08",
    sources: [
      { name: "Ohio EPA — OBD Vehicle \"Readiness\" Fact Sheet", url: "https://dam.assets.ohio.gov/image/upload/epa.ohio.gov/Portals/27/echeck/docs/Readiness-fact-sheet.pdf", tier: "regulator" },
      { name: "Ohio E-Check — Preparing for an Inspection", url: "https://www.ohioecheck.info/pages/preparing-for-an-inspection", tier: "regulator" },
    ],
    allowed: [
      "Clearing trouble codes or disconnecting the battery resets the readiness monitors to not ready, and a vehicle that is not ready is rejected from the E-Check test (Ohio EPA).",
      "Clearing the codes also turns the check engine light off, so a dark light does not show the monitors are ready; an OBD scan tool does (Ohio EPA).",
      "The monitors set again through normal driving, usually two or three days of city and highway miles, longer on some older vehicles (Ohio EPA).",
    ],
    prohibited: [
      {
        id: "clear_codes_to_pass",
        // An outcome is required ("and you'll pass", "gets you through"), and a
        // negated one ("won't get you through", "can't pass") is the correct
        // statement, so it is excluded.
        pattern: /\b(?:clear(?:s|ed|ing)?|reset(?:s|ting)?|eras(?:e|es|ed|ing)|disconnect(?:s|ed|ing)?)\b[^.!\n]{0,40}\b(?:codes?|battery|light)\b[^.!\n]{0,40}(?<!(?:n['’]t|not|never) )\b(?:(?:and )?(?:you|it)(?:['’]ll| will) (?:pass|get through)|gets? you through|passes)\b[^.!\n]{0,20}\b(?:e-?check|emissions?|inspection|the test)\b/i,
        reason: "Clearing codes or disconnecting the battery leaves the monitors not ready, and Ohio rejects a vehicle that is not ready (Ohio EPA); it never gets a car through E-Check.",
      },
      {
        id: "light_off_means_ready",
        pattern: /\blight(?:['’]s| is| went| goes| turned| turns)? (?:off|out)\b[^.!\n]{0,30}(?<!(?:n['’]t|not|never) )\b(?:means?|so) (?:you(?:['’]re| are) |it(?:['’]s| is) |the car(?:['’]s| is) )?(?:ready|good to go|set to pass|going to pass)\b/i,
        reason: "Clearing the codes turns the light off before the monitors are ready (Ohio EPA); only an OBD scan tool or the test itself shows readiness.",
      },
    ],
    technicianApproval: null,
    reviewBy: "2027-04-08",
  },
  {
    // Pilot A006 (clicks but will not start), A059, A060.
    topic: "no_start",
    version: "2026-10-08",
    sources: [],
    allowed: [
      "A click with no crank can come from a weak battery, a loose or corroded connection, the starter or the charging system; a battery, starting and charging test tells which.",
      "Lights and the radio can still work on a battery too weak to crank the engine.",
    ],
    prohibited: [
      {
        id: "no_start_single_certain_cause",
        pattern: /\bclick(?:s|ing)?\b[^.!\n]{0,40}(?<!almost )\b(?:always|definitely|100%|guaranteed|for sure)\b[^.!\n]{0,25}\b(?:battery|starter|alternator|solenoid)\b/i,
        reason: "A click with no crank has several causes (battery, connection, starter, charging); naming one as certain is a diagnosis without a test.",
      },
      {
        id: "lights_work_battery_fine",
        pattern: /\b(?:if|when|since) (?:the |your )?(?:lights?|headlights?|radio|dash(?:board)?(?: lights)?)\b[^.!\n]{0,25}\b(?:work|works|come on|comes on|turn on|turns on)\b[^.!\n]{0,30}\b(?:(?:the |your )?battery(?:['’]s| is) (?:fine|good|ok|okay|not the problem)|it(?:['’]s| is)(?:n['’]t| not) the battery)\b/i,
        reason: "Lights can work on a battery too weak to crank the engine; working lights do not clear the battery.",
      },
    ],
    technicianApproval: null,
    reviewBy: "2027-04-08",
  },
];

/** The topics that have a packet, in packet order: the one list the angle bank validates against. */
export const TRUTH_TOPICS: readonly TruthTopic[] = TRUTH_PACKETS.map((p) => p.topic);

export interface TruthViolation {
  topic: TruthTopic;
  id: string;
  reason: string;
  match: string;
}

/** Every prohibited claim the text makes, across all packets. Pure. */
export function mechanicalTruthViolations(text: string): TruthViolation[] {
  const out: TruthViolation[] = [];
  if (!text) return out;
  for (const packet of TRUTH_PACKETS) {
    for (const p of packet.prohibited) {
      const m = p.pattern.exec(text);
      if (m) out.push({ topic: packet.topic, id: p.id, reason: p.reason, match: m[0] });
    }
  }
  return out;
}

/**
 * The packets as a prompt fragment for generators, so a script is written true
 * instead of being refused at the publish door after the render money is spent.
 * Allowed statements are what to say; each prohibited claim is given as its
 * reason, never as the bad sentence, so the model is not primed with it.
 */
export function buildTruthPacketFragment(): string {
  const lines = ["MECHANICAL TRUTH — when the reel touches one of these topics, stay inside these facts (a script that breaks one is refused at publish):"];
  for (const p of TRUTH_PACKETS) {
    lines.push(`- ${p.topic.replace(/_/g, " ")}: ${p.allowed.join(" ")} Never imply: ${p.prohibited.map((c) => c.reason).join(" ")}`);
  }
  return lines.join("\n");
}
