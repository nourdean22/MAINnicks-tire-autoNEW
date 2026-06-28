import { eq, and, desc, sql, gte, lte, like } from "drizzle-orm";
import { getDbTyped } from "../db";
import {
  contentManufacturingCampaigns,
  socialContentInventory,
  searchPerformance,
  competitorSnapshots,
  communicationLog,
  smsMessages,
  smsConversations,
  bookings,
  instagramAnalytics
} from "../../drizzle/schema";
import { invokeLLM } from "../_core/llm";
import { createLogger } from "../lib/logger";
import { checkWeatherTriggers } from "./weatherIntelligence";
import type { ReelBrief } from "../../client/src/lib/facelessReelStudio";

const log = createLogger("services:contentManufacturing");

// Narrative Franchises
export const NARRATIVE_FRANCHISES = [
  { name: "Things We Found This Week", description: "Real diagnostic edge cases, failed components, and rust logs." },
  { name: "The Most Expensive Mistakes Drivers Make", description: "Tires, brakes, suspension, alignment damage." },
  { name: "Cleveland Car Survival Guide", description: "Lake-effect snow, rust, potholes, and construction." },
  { name: "Would You Drive On This?", description: "Shock-value component wear (Tire/Brake Hall of Fame)." },
  { name: "Customer Thought vs. Reality", description: "Customer thought it was a transmission; it was a loose sway bar link." },
  { name: "Mechanic Shower Thoughts", description: "Memorable analogies (A check engine light is your car's version of 'we need to talk')." }
];

// Visual Styles
export const VISUAL_STYLES = [
  { key: "Style A", name: "Cinematic / Luxury", description: "Vibrant grade, slow panning close-ups, premium texture." },
  { key: "Style B", name: "Infographic / Motion Graphics", description: "Clean data overlays, split screens, diagrams." },
  { key: "Style C", name: "Raw Documentary", description: "Handheld footage, mechanic talking head, shop floor noise." },
  { key: "Style D", name: "Local News Alert", description: "Urgent red banners, high-contrast typography, Cuyahoga map." },
  { key: "Style E", name: "Consumer Reports / Review", description: "Clean split comparisons, performance stats side-by-side." }
];

// Personas
export const PERSONAS = [
  { key: "cleveland_car_doctor", name: "Cleveland Car Doctor", description: "High-authority, Cleveland-survival focused, protective." },
  { key: "tire_whisperer", name: "Tire Whisperer", description: "Light-hearted, humorous, personifying component feelings." },
  { key: "shop_insider", name: "Shop Insider", description: "Pulls back the curtain on mechanic secrets and diagnostic loops." },
  { key: "pothole_investigator", name: "Pothole Investigator", description: "Hyper-local reporting on Northeast Ohio road craters." },
  { key: "light_therapist", name: "Dashboard Light Therapist", description: "Emotional support for check-engine light stress." }
];

export interface ContentAngle {
  angle: string;
  narrativeFranchise: string;
  entertainmentPillar: string;
  description: string;
}

export interface Hook {
  hookText: string;
  hookCategory: string; // curiosity, fear, surprise, story, humor, local
  scoreCuriosity: number;
  scoreEmotion: number;
  scoreLocalRelevance: number;
  scoreAuthority: number;
  scoreOverall?: number;
}

export interface SocialDraft {
  hookText: string;
  bodyText: string;
  visualStyle: string;
  persona: string;
  interactiveDmKeyword: string;
  caption: string;
  hashtags: string[];
  scoreCuriosity: number;
  scoreEmotion: number;
  scoreShareability: number;
  scoreCommentPotential: number;
  scoreSavePotential: number;
  scoreLocalRelevance: number;
  scoreRevenueRelevance: number;
  scoreAuthority: number;
  scoreHookStrength: number;
  briefJson: string;
  adCopy: {
    hookYellow: string;
    hookWhite: string;
    hookSub: string;
    valueWhite: string;
    valueYellow: string;
    valueTicks: [string, string, string];
    offerYellow: string;
    offerWhite: string;
    offerSub: string;
  };
  gscQuerySeed?: string;
  weatherTriggerCondition?: string;
}

/**
 * Phase 1: Explode raw topic into narrative content angles.
 * Grounded in local GSC queries, weather, and competitor snapshots.
 */
export async function explodeTopic(
  topic: string,
  options?: { limit?: number }
): Promise<ContentAngle[]> {
  const db = await getDbTyped();
  if (!db) throw new Error("Database not available");

  // A. Query GSC search queries
  const gscQueries = await db
    .select({ query: searchPerformance.query })
    .from(searchPerformance)
    .where(sql`${searchPerformance.query} LIKE ${`%${topic}%`}`)
    .orderBy(desc(searchPerformance.impressions))
    .limit(10);

  const querySeeds = gscQueries.map((q) => q.query).join(", ");

  // B. Query weather triggers
  let weatherDetails = "Normal Cleveland weather";
  try {
    const weather = await checkWeatherTriggers();
    weatherDetails = weather.details;
  } catch (e) {
    log.warn("Weather check failed during explodeTopic:", e);
  }

  // C. Competitor snapshot details
  const comps = await db
    .select({ name: competitorSnapshots.competitorName, rating: competitorSnapshots.rating })
    .from(competitorSnapshots)
    .orderBy(desc(competitorSnapshots.rating))
    .limit(3);
  const compDetails = comps.map((c) => `${c.name} (Rating: ${c.rating})`).join(", ");

  const prompt = `
You are a world-class attention engineer and Cleveland automotive content strategist.
Given the topic: "${topic}", explode it into 15 distinct, highly engaging content angles.

CONTEXT SEEDS:
- Regional GSC query trends: [${querySeeds}]
- Current Cleveland weather state: ${weatherDetails}
- Local competitors: [${compDetails}]

FRANCHISE FRAMEWORKS AVAILABLE:
${NARRATIVE_FRANCHISES.map((f) => `- ${f.name}: ${f.description}`).join("\n")}

PERSONAS:
${PERSONAS.map((p) => `- ${p.name}: ${p.description}`).join("\n")}

For each angle, map it to a Narrative Franchise and an Entertainment Pillar (e.g. "Hall of Shame", "Alternate Reality", "Contrarian Content").
Provide a brief, compelling description of what the content piece is about. Optimize for virality, local relatability, and attention capture.

You must return a valid JSON object matching the requested schema. No conversational prose.
  `;

  const response = await invokeLLM({
    messages: [{ role: "user", content: prompt }],
    outputSchema: {
      name: "topic_explosion",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          angles: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                angle: { type: "string" },
                narrativeFranchise: { type: "string" },
                entertainmentPillar: { type: "string" },
                description: { type: "string" }
              },
              required: ["angle", "narrativeFranchise", "entertainmentPillar", "description"]
            }
          }
        },
        required: ["angles"]
      }
    }
  });

  const parsed = JSON.parse(response.choices[0].message.content as string);
  return parsed.angles || [];
}

/**
 * Phase 2: Generate 12-24 hooks for a specific content angle.
 * Categorized and pre-scored.
 */
export async function generateHookLibrary(
  topic: string,
  angle: ContentAngle
): Promise<Hook[]> {
  const prompt = `
Generate exactly 12 hooks (2 per category: curiosity, fear, surprise, story, humor, local) for the following topic and angle:
Topic: "${topic}"
Angle: "${angle.angle}"
Franchise: "${angle.narrativeFranchise}"
Pillar: "${angle.entertainmentPillar}"

For each hook, assign attention sub-scores (0-100) based on these strict guidelines:
- Curiosity: Induces a cognitive loop or unresolved question.
- Emotion: Evokes fear of mechanical breakdown, regret of overpaying, or relief.
- Local Relevance: Mentions Cleveland, Ohio, Cuyahoga county, potholes, local highways (I-90, I-480, Shoreway).
- Authority: Implies deep mechanical expertise without sounding like a corporate sales pitch.

You must return a valid JSON object matching the requested schema. No conversational prose.
  `;

  const response = await invokeLLM({
    messages: [{ role: "user", content: prompt }],
    outputSchema: {
      name: "hook_library",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          hooks: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                hookText: { type: "string" },
                hookCategory: { type: "string" },
                scoreCuriosity: { type: "number" },
                scoreEmotion: { type: "number" },
                scoreLocalRelevance: { type: "number" },
                scoreAuthority: { type: "number" }
              },
              required: ["hookText", "hookCategory", "scoreCuriosity", "scoreEmotion", "scoreLocalRelevance", "scoreAuthority"]
            }
          }
        },
        required: ["hooks"]
      }
    }
  });

  const parsed = JSON.parse(response.choices[0].message.content as string);
  const hooks: Hook[] = parsed.hooks || [];

  // Calculate weighted overall hook strength programmatically
  return hooks.map((h) => {
    const overall = Math.round(
      h.scoreCuriosity * 0.3 +
      h.scoreEmotion * 0.25 +
      h.scoreLocalRelevance * 0.25 +
      h.scoreAuthority * 0.2
    );
    return { ...h, scoreOverall: overall };
  });
}

/**
 * Claim Safety Validator
 * Checks for hard pricing violations and diagnostic guarantees.
 */
export function validateClaimSafety(draft: SocialDraft): { safe: boolean; errors: string[] } {
  const errors: string[] = [];
  const combinedText = `${draft.hookText} ${draft.bodyText} ${draft.caption}`.toLowerCase();

  // 1. Pricing Quote Validator
  // Regex to match any dollar amounts.
  const dollarMatches = combinedText.match(/\$\d+/g);
  if (dollarMatches) {
    for (const match of dollarMatches) {
      const value = parseInt(match.replace("$", ""), 10);
      // Allowed prices: $49 (conv oil change), $80 (synthetic oil change), $60 (used tires), $25/40/100 (other standard baselines)
      const allowedPrices = [49, 80, 60, 25, 40, 100];
      if (!allowedPrices.includes(value)) {
        errors.push(`Violated Rule 1: Unauthorized pricing mention "${match}". Only standard prices allowed.`);
      }
    }
  }

  // 2. Hard Diagnostic Guarantee Validator
  const hardDiagnostics = [
    "guaranteed",
    "will fix",
    "must replace",
    "definitely broken",
    "broken transmission",
    "blown engine"
  ];
  for (const term of hardDiagnostics) {
    if (combinedText.includes(term)) {
      errors.push(`Violated Rule 2: Hard diagnostic/guarantee term found "${term}". Use soft terms instead.`);
    }
  }

  // 3. Fake Review Validator
  if (combinedText.includes("five stars") || combinedText.includes("5 stars")) {
    if (combinedText.includes("says") || combinedText.includes("reviewed")) {
      // Must not quote fake people
      errors.push("Violated Rule 3: Do not generate fake user testimonials or quotes.");
    }
  }

  // 4. Anti-Boring/Anti-Generic Filter
  const genericCheck = detectGenericMarketingLanguage(combinedText);
  if (genericCheck.generic) {
    errors.push(`Violated Rule 4: Generic/boring marketing phrase found "${genericCheck.matchedPhrase}". Use direct, local mechanic voice.`);
  }

  return {
    safe: errors.length === 0,
    errors
  };
}

export function detectServiceCategory(item: { topic: string; bodyText: string; seriesName?: string }): string {
  const text = `${item.topic} ${item.bodyText} ${item.seriesName || ""}`.toLowerCase();
  if (text.includes("brake")) return "Brakes";
  if (text.includes("alignment") || text.includes("align")) return "Alignment";
  if (text.includes("suspension") || text.includes("shock") || text.includes("strut") || text.includes("bushing") || text.includes("sway bar") || text.includes("tie rod") || text.includes("drive shaft") || text.includes("cv joint")) return "Suspension";
  if (text.includes("oil") || text.includes("lube") || text.includes("viscosity") || text.includes("sludge") || text.includes("dipstick")) return "Oil Changes";
  if (text.includes("battery") || text.includes("batteries") || text.includes("charge") || text.includes("terminal") || text.includes("alternator")) return "Batteries";
  if (text.includes("ac") || text.includes("cooling") || text.includes("coolant") || text.includes("refrigerant") || text.includes("compressor") || text.includes("heater") || text.includes("radiator") || text.includes("thermostat")) return "AC/Cooling";
  if (text.includes("bearing")) return "Wheel Bearings";
  if (text.includes("tire") || text.includes("tread") || text.includes("pressure") || text.includes("tpms") || text.includes("plug") || text.includes("patch") || text.includes("sidewall") || text.includes("lug nut") || text.includes("wheel lock")) return "Tires";
  return "Diagnostics";
}

export function getNarrativeSpineDetails(service: string): { narrative: string; characters: string[] } {
  const clean = service.toLowerCase().trim();
  if (clean.includes("tire")) {
    return {
      narrative: "The Tire Diary (Tires record every other problem. Core line: 'Your tread is a confession.')",
      characters: ["Penny Test Inspector", "Tire Therapist", "Tread Historian"]
    };
  }
  if (clean.includes("brake")) {
    return {
      narrative: "Brake Pad Lifeguard (Every stop costs the pad part of its life.)",
      characters: ["Brake Pad Lifeguard", "Rotor Judge", "Brake Fluid Messenger", "ABS Security Guard"]
    };
  }
  if (clean.includes("align")) {
    return {
      narrative: "The Tightrope Walker (Alignment is balance. Potholes knock it off.)",
      characters: ["Alignment Tightrope Walker", "Pothole Gremlin", "Steering Wheel Translator"]
    };
  }
  if (clean.includes("suspension") || clean.includes("shock") || clean.includes("strut") || clean.includes("bushing")) {
    return {
      narrative: "What The Road Took (Cleveland roads collect a hidden tax.)",
      characters: ["Shoreway Crusher", "Freeze-Thaw Monster", "Salt King", "Suspension Detective"]
    };
  }
  if (clean.includes("oil") || clean.includes("lube") || clean.includes("sludge")) {
    return {
      narrative: "Life Inside The Engine (Old oil changes the whole engine environment.)",
      characters: ["Mayor Oil", "Filter Gatekeeper", "Sludge Monster", "Friction Bandits"]
    };
  }
  if (clean.includes("battery") || clean.includes("batteries") || clean.includes("charge")) {
    return {
      narrative: "Murder Planned In July, Committed In January (Heat damages batteries; cold exposes them.)",
      characters: ["Battery Victim", "Heat Assassin", "Winter Executioner", "Corrosion Parasite"]
    };
  }
  if (clean.includes("ac") || clean.includes("cooling") || clean.includes("coolant")) {
    return {
      narrative: "The Slow Goodbye Of The AC (AC fades slowly and drivers adapt without noticing.)",
      characters: ["Cabin Air Therapist", "Compressor Athlete", "Refrigerant Magician", "Pollen Monster"]
    };
  }
  if (clean.includes("bearing")) {
    return {
      narrative: "Wheel Bearing Whodunit (The hum is the clue. The bearing is the suspect.)",
      characters: ["Detective Bearing", "Highway Witness", "Radio Volume Criminal"]
    };
  }
  return {
    narrative: "Dashboard Light Therapist (Your car is communicating, not panicking.)",
    characters: ["Dashboard Light Therapist", "Mystery Noise Detective", "Check Engine Smoke Alarm", "Smell Investigator"]
  };
}

export const MEDIA_VISUAL_STYLES = [
  { key: "caution-tape", name: "caution-tape cut", description: "High-contrast hazard stripes with stencil cutout frames." },
  { key: "blueprint", name: "garage blueprint negative", description: "Cyan blueprint styling with white technical outline marks." },
  { key: "forensic-tag", name: "forensic tag", description: "Numbered evidence marker tags placed next to worn parts." },
  { key: "salt-crust", name: "salt-crust texture", description: "Gritty, high-contrast texture overlay highlighting corrosion." },
  { key: "rubber-noir", name: "macro rubber noir", description: "Deep charcoal close-ups of tread rubber with dramatic key lighting." },
  { key: "thermal-cam", name: "thermal-cam read", description: "Infrared heat-map color grade showcasing heat stress/friction." },
  { key: "service-manual", name: "service-manual spread", description: "Technical schematics, line art, and specs on off-white paper." },
  { key: "hazard-diamond", name: "hazard-diamond signage", description: "Yellow/black quadrant warning labels and hazard typography." },
  { key: "tread-emboss", name: "tire-tread emboss", description: "Heavy textured tire-tread shadow embossing." },
  { key: "snow-static", name: "snow-static overlay", description: "Frosty, static-noise weather grading for cold-starts." },
  { key: "oscilloscope", name: "oscilloscope diagnostic", description: "Cathode-ray green wave patterns on grid lines." },
  { key: "xray-amber", name: "x-ray amber", description: "Amber duotone lighting revealing internal structural details." },
  { key: "pothole-topo", name: "pothole topography", description: "Relief map lines tracing Cuyahoga asphalt crater depths." },
  { key: "pressure-gauge", name: "pressure-gauge dial", description: "Analog dial graphic with needle tipping into red warning zones." },
  { key: "warning-light", name: "warning-light constellation", description: "Glowing dashboard glyph symbols grouped on dark background." },
  { key: "rust-bloom", name: "rust-bloom overlay", description: "Orange rust texture bleeding into deep black background." },
  { key: "strobe-bay", name: "strobe bay light", description: "Single overhead light beam with dramatic shadows and dust motes." },
  { key: "receipt-minimal", name: "receipt-roll minimal", description: "Monospace receipt printout styling on plain white strip." },
  { key: "inspection-collage", name: "inspection-sticker collage", description: "Overlapping municipal safety inspection stickers." },
  { key: "obd-terminal", name: "diagnostic OBD terminal", description: "Green/amber retro terminal text on black screen." }
];

export function determineVisualStyle(service: string, franchise: string): typeof MEDIA_VISUAL_STYLES[number] {
  const serviceLower = service.toLowerCase();
  const franchiseLower = franchise.toLowerCase();

  if (serviceLower.includes("tire")) {
    if (franchiseLower.includes("mistakes")) return MEDIA_VISUAL_STYLES.find(s => s.key === "pressure-gauge") || MEDIA_VISUAL_STYLES[13];
    return MEDIA_VISUAL_STYLES.find(s => s.key === "rubber-noir") || MEDIA_VISUAL_STYLES[4];
  }
  if (serviceLower.includes("brake")) {
    if (franchiseLower.includes("would you drive")) return MEDIA_VISUAL_STYLES.find(s => s.key === "forensic-tag") || MEDIA_VISUAL_STYLES[2];
    return MEDIA_VISUAL_STYLES.find(s => s.key === "caution-tape") || MEDIA_VISUAL_STYLES[0];
  }
  if (serviceLower.includes("align")) {
    return MEDIA_VISUAL_STYLES.find(s => s.key === "blueprint") || MEDIA_VISUAL_STYLES[1];
  }
  if (serviceLower.includes("suspension")) {
    if (franchiseLower.includes("survival")) return MEDIA_VISUAL_STYLES.find(s => s.key === "pothole-topo") || MEDIA_VISUAL_STYLES[12];
    return MEDIA_VISUAL_STYLES.find(s => s.key === "rust-bloom") || MEDIA_VISUAL_STYLES[15];
  }
  if (serviceLower.includes("oil")) {
    return MEDIA_VISUAL_STYLES.find(s => s.key === "strobe-bay") || MEDIA_VISUAL_STYLES[16];
  }
  if (serviceLower.includes("battery")) {
    return MEDIA_VISUAL_STYLES.find(s => s.key === "xray-amber") || MEDIA_VISUAL_STYLES[11];
  }
  if (serviceLower.includes("ac") || serviceLower.includes("cool")) {
    return MEDIA_VISUAL_STYLES.find(s => s.key === "thermal-cam") || MEDIA_VISUAL_STYLES[5];
  }
  if (serviceLower.includes("bearing")) {
    return MEDIA_VISUAL_STYLES.find(s => s.key === "oscilloscope") || MEDIA_VISUAL_STYLES[10];
  }
  if (franchiseLower.includes("mistakes")) return MEDIA_VISUAL_STYLES.find(s => s.key === "receipt-minimal") || MEDIA_VISUAL_STYLES[17];
  return MEDIA_VISUAL_STYLES.find(s => s.key === "obd-terminal") || MEDIA_VISUAL_STYLES[19];
}

export function detectGenericMarketingLanguage(text: string): { generic: boolean; matchedPhrase?: string } {
  const genericPhrases = [
    "regular maintenance is important",
    "keep your vehicle running smoothly",
    "don't forget to check your tires",
    "schedule your appointment today",
    "your safety is our priority",
    "we offer quality service",
    "trust the experts",
    "call us for all your auto repair needs",
    "automotive needs",
    "hassle-free",
    "peace of mind",
    "ensure your vehicle",
    "optimal performance",
    "look no further",
    "at nick's tire",
    "we've got you covered"
  ];
  
  const clean = text.toLowerCase();
  for (const phrase of genericPhrases) {
    if (clean.includes(phrase)) {
      return { generic: true, matchedPhrase: phrase };
    }
  }
  return { generic: false };
}

export async function generateHookTournament(
  topic: string,
  angle: ContentAngle
): Promise<Hook> {
  log.info(`Running Hook Tournament for topic "${topic}", angle "${angle.angle}"`);
  
  const prompt = `
You are an elite copywriter and attention engineer. Generate exactly 25 hooks for the following:
Topic: "${topic}"
Angle: "${angle.angle}"
Franchise: "${angle.narrativeFranchise}"
Pillar: "${angle.entertainmentPillar}"

INSTRUCTIONS:
1. Generate exactly 25 hooks, distributing them across these 9 categories:
   - fear
   - curiosity
   - local
   - myth-busting
   - money-saving
   - useful absurdity
   - authority
   - story
   - problem-first
2. Group them by category.
3. For each hook, provide realistic scores (0-100) for:
   - scoreCuriosity (induces cognitive loops)
   - scoreEmotion (evokes concern, relief, or interest)
   - scoreLocalRelevance (mentions Cleveland/Euclid/Northeast Ohio landmarks or winter/potholes/salt)
   - scoreAuthority (implies honest expertise without pitchiness)

Return a valid JSON object matching the requested schema. No conversational prose.
`;

  const response = await invokeLLM({
    messages: [{ role: "user", content: prompt }],
    outputSchema: {
      name: "hook_tournament",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          hooks: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                hookText: { type: "string" },
                hookCategory: { type: "string" },
                scoreCuriosity: { type: "number" },
                scoreEmotion: { type: "number" },
                scoreLocalRelevance: { type: "number" },
                scoreAuthority: { type: "number" }
              },
              required: ["hookText", "hookCategory", "scoreCuriosity", "scoreEmotion", "scoreLocalRelevance", "scoreAuthority"]
            }
          }
        },
        required: ["hooks"]
      }
    }
  });

  const parsed = JSON.parse(response.choices[0].message.content as string);
  const rawHooks: Hook[] = parsed.hooks || [];

  const scoredHooks = rawHooks.map(h => {
    const overall = Math.round(
      h.scoreCuriosity * 0.3 +
      h.scoreEmotion * 0.25 +
      h.scoreLocalRelevance * 0.25 +
      h.scoreAuthority * 0.2
    );
    return { ...h, scoreOverall: overall };
  });

  const top3 = scoredHooks.sort((a, b) => (b.scoreOverall || 0) - (a.scoreOverall || 0)).slice(0, 3);
  if (top3.length === 0) {
    throw new Error("No hooks generated in tournament");
  }

  log.info(`Top 3 hooks selected. Running head-to-head critic pass.`);
  
  const criticPrompt = `
You are an independent critic. Evaluate the following 3 hook candidates for a social media post about "${topic}" in Cleveland:
1. "${top3[0]?.hookText}" (Category: ${top3[0]?.hookCategory})
2. "${top3[1]?.hookText}" (Category: ${top3[1]?.hookCategory})
3. "${top3[2]?.hookText}" (Category: ${top3[2]?.hookCategory})

Select the absolute best hook (champion) that:
- Has the strongest first-frame jeopardy/scroll-stop probability.
- Sounds authentic, human, and local (Cleveland-specific).
- Avoids generic AI hype.

Your output must be JSON matching the schema, indicating the index (0, 1, or 2) of the chosen champion and a brief reason.
`;

  const criticRes = await invokeLLM({
    messages: [{ role: "user", content: criticPrompt }],
    outputSchema: {
      name: "champion_selection",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          championIndex: { type: "number", minimum: 0, maximum: 2 },
          reason: { type: "string" }
        },
        required: ["championIndex", "reason"]
      }
    }
  });

  const criticParsed = JSON.parse(criticRes.choices[0].message.content as string);
  const champIdx = criticParsed.championIndex ?? 0;
  const champion = top3[champIdx] || top3[0];
  log.info(`Champion selected: "${champion.hookText}" (Reason: ${criticParsed.reason})`);
  return champion;
}

/**
 * Phase 3: Generate Social Draft
 */
export async function generateScoredDraft(
  topic: string,
  angle: ContentAngle,
  hook: Hook,
  personaKey: string,
  contentType: "reel" | "carousel" | "post" | "story",
  platform: "instagram" | "facebook" | "both"
): Promise<SocialDraft> {
  const persona = PERSONAS.find((p) => p.key === personaKey) || PERSONAS[0];
  
  const serviceCat = detectServiceCategory({ topic, bodyText: angle.description, seriesName: angle.narrativeFranchise });
  const spine = getNarrativeSpineDetails(serviceCat);
  const charHash = (topic + angle.angle).split("").reduce((a, b) => a + b.charCodeAt(0), 0);
  const character = spine.characters[charHash % spine.characters.length];
  const visualStyle = determineVisualStyle(serviceCat, angle.narrativeFranchise || "");

  // Gather current weather state for weather trigger check
  let weatherCond = "";
  try {
    const weather = await checkWeatherTriggers();
    if (weather.triggered.length > 0) {
      weatherCond = weather.triggered[0];
    }
  } catch (e) {
    log.warn("Weather trigger check failed during draft:", e);
  }

  const prompt = `
Generate a full social media post draft using the following specifications:
Topic: "${topic}"
Angle: "${angle.angle}"
Franchise: "${angle.narrativeFranchise}"
Hook: "${hook.hookText}"
Hook Category: "${hook.hookCategory}"
Persona: "${persona.name}" (${persona.description})
Visual Style: "${visualStyle.name}" (${visualStyle.description})
Content Type: "${contentType}"
Platform: "${platform}"

INSTRUCTIONS:
1. Make the draft extremely engaging and native-feeling.
2. Include an Interactive DM Keyword (e.g. "SURVIVE", "COST", "TIRES") that users can comment to receive a DM automation loop.
3. Write a high-converting Caption and list of Hashtags.
4. Set scored metrics (0-100) for attention potential:
   - scoreCuriosity
   - scoreEmotion
   - scoreShareability
   - scoreCommentPotential
   - scoreSavePotential
   - scoreLocalRelevance
   - scoreRevenueRelevance
   - scoreAuthority
   - scoreHookStrength (should match ${hook.scoreOverall})
5. Output detailed "briefJson" mapping out the visual storyboard or slide deck beats.
6. Guard: Avoid hard price quotes (except $49 conventional oil change, $80 synthetic oil change, $60 used tires installed) and do not make absolute mechanical diagnostic guarantees.

You must return a valid JSON object matching the requested schema. No conversational prose.
  `;

  const response = await invokeLLM({
    messages: [{ role: "user", content: prompt }],
    outputSchema: {
      name: "scored_draft",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          hookText: { type: "string" },
          bodyText: { type: "string" },
          visualStyle: { type: "string" },
          persona: { type: "string" },
          interactiveDmKeyword: { type: "string" },
          caption: { type: "string" },
          hashtags: { type: "array", items: { type: "string" } },
          scoreCuriosity: { type: "number" },
          scoreEmotion: { type: "number" },
          scoreShareability: { type: "number" },
          scoreCommentPotential: { type: "number" },
          scoreSavePotential: { type: "number" },
          scoreLocalRelevance: { type: "number" },
          scoreRevenueRelevance: { type: "number" },
          scoreAuthority: { type: "number" },
          scoreHookStrength: { type: "number" },
          briefJson: { type: "string" },
          adCopy: {
            type: "object",
            description: "Ad Copy for AdStudio carousel generation",
            properties: {
              hookYellow: { type: "string" },
              hookWhite: { type: "string" },
              hookSub: { type: "string" },
              valueWhite: { type: "string" },
              valueYellow: { type: "string" },
              valueTicks: {
                type: "array",
                items: { type: "string" },
                minItems: 3,
                maxItems: 3
              },
              offerYellow: { type: "string" },
              offerWhite: { type: "string" },
              offerSub: { type: "string" }
            },
            required: ["hookYellow", "hookWhite", "hookSub", "valueWhite", "valueYellow", "valueTicks", "offerYellow", "offerWhite", "offerSub"]
          }
        },
        required: [
          "hookText", "bodyText", "visualStyle", "persona", "interactiveDmKeyword",
          "caption", "hashtags", "scoreCuriosity", "scoreEmotion", "scoreShareability",
          "scoreCommentPotential", "scoreSavePotential", "scoreLocalRelevance",
          "scoreRevenueRelevance", "scoreAuthority", "scoreHookStrength", "briefJson", "adCopy"
        ]
      }
    }
  });

  const parsed = JSON.parse(response.choices[0].message.content as string) as SocialDraft;

  // Ground weather trigger field if weather condition matches
  if (weatherCond) {
    parsed.weatherTriggerCondition = weatherCond;
  }

  return parsed;
}

/**
 * Phase 0: Independent Critic Pass (second model call).
 * Grades the draft objectively across all attention metrics.
 */
export async function critiqueSocialDraft(
  draft: SocialDraft,
  topic: string,
  angle: ContentAngle
): Promise<Record<string, number>> {
  const prompt = `
You are an elite, independent critic and attention auditor for local automotive content.
Your job is to objectively score the following social media post draft. Do not inflate scores. Be brutal and realistic.

Post Topic: "${topic}"
Content Angle: "${angle.angle}"
Post Type: "${draft.visualStyle}"
Persona: "${draft.persona}"
Caption: "${draft.caption}"
On-screen/Body text: "${draft.bodyText}"

Score the draft on the following 9 dimensions from 0 to 100:
1. scoreCuriosity: Induces a cognitive loop or unresolved question.
2. scoreEmotion: Evokes relief, concern, or curiosity without fearmongering.
3. scoreShareability: Realistically, would someone share/send this to a friend? (Needs clear tag-bait or callout).
4. scoreCommentPotential: Will this trigger comments/questions? (Needs a prompt or interactive loop).
5. scoreSavePotential: Is it a glovebox cheat-sheet, reference-worthy tip, or checklist?
6. scoreLocalRelevance: Mentions Cleveland, Ohio, Cuyahoga county, local roads, or weather.
7. scoreRevenueRelevance: Does it naturally tie back to one of Nick's core services?
8. scoreAuthority: Implies deep expertise without sounding like a corporate ad.
9. scoreHookStrength: Does the hook (first frame/line) grab attention instantly? (Should reflect how strong the hook text is).

You must return a valid JSON object matching the requested schema. No conversational prose.
  `;

  const response = await invokeLLM({
    messages: [{ role: "user", content: prompt }],
    outputSchema: {
      name: "critic_score",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          scoreCuriosity: { type: "number" },
          scoreEmotion: { type: "number" },
          scoreShareability: { type: "number" },
          scoreCommentPotential: { type: "number" },
          scoreSavePotential: { type: "number" },
          scoreLocalRelevance: { type: "number" },
          scoreRevenueRelevance: { type: "number" },
          scoreAuthority: { type: "number" },
          scoreHookStrength: { type: "number" }
        },
        required: [
          "scoreCuriosity", "scoreEmotion", "scoreShareability", "scoreCommentPotential",
          "scoreSavePotential", "scoreLocalRelevance", "scoreRevenueRelevance", "scoreAuthority", "scoreHookStrength"
        ]
      }
    }
  });

  return JSON.parse(response.choices[0].message.content as string);
}

/**
 * Grades a Reel brief objectively across attention metrics.
 */
export async function critiqueReelBrief(
  brief: ReelBrief,
  topic: string
): Promise<Record<string, number>> {
  const prompt = `
You are an elite, independent critic and attention auditor for local automotive content.
Your job is to objectively score the following Instagram Reel brief. Do not inflate scores. Be brutal and realistic.

Post Topic: "${topic}"
Reel Archetype: "${brief.archetype}"
Reel Motion Lens: "${brief.motionLens}"
Reel Object Character: "${brief.objectCharacter}"
Caption: "${brief.selectedCaption}"
Voiceover script: "${brief.voiceoverScript || ""}"
Storyboard Beats:
${brief.storyboardBeats.map(b => `- Beat ${b.beatNumber}: ${b.visual} (Text: "${b.onScreenText || ""}")`).join("\n")}

Score the reel on the following 9 dimensions from 0 to 100:
1. scoreCuriosity: Induces a cognitive loop or unresolved question.
2. scoreEmotion: Evokes relief, concern, or curiosity without fearmongering.
3. scoreShareability: Realistically, would someone share/send this to a friend? (Needs clear tag-bait or callout).
4. scoreCommentPotential: Will this trigger comments/questions? (Needs a prompt or interactive loop).
5. scoreSavePotential: Is it a glovebox cheat-sheet, reference-worthy tip, or checklist?
6. scoreLocalRelevance: Mentions Cleveland, Ohio, Cuyahoga county, local roads, or weather.
7. scoreRevenueRelevance: Does it naturally tie back to one of Nick's core services?
8. scoreAuthority: Implies deep expertise without sounding like a corporate ad.
9. scoreHookStrength: Does the hook (first frame/line) grab attention instantly? (Should reflect how strong the hook text is).

You must return a valid JSON object matching the requested schema. No conversational prose.
  `;

  const response = await invokeLLM({
    messages: [{ role: "user", content: prompt }],
    outputSchema: {
      name: "critic_score",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          scoreCuriosity: { type: "number" },
          scoreEmotion: { type: "number" },
          scoreShareability: { type: "number" },
          scoreCommentPotential: { type: "number" },
          scoreSavePotential: { type: "number" },
          scoreLocalRelevance: { type: "number" },
          scoreRevenueRelevance: { type: "number" },
          scoreAuthority: { type: "number" },
          scoreHookStrength: { type: "number" }
        },
        required: [
          "scoreCuriosity", "scoreEmotion", "scoreShareability", "scoreCommentPotential",
          "scoreSavePotential", "scoreLocalRelevance", "scoreRevenueRelevance", "scoreAuthority", "scoreHookStrength"
        ]
      }
    }
  });

  return JSON.parse(response.choices[0].message.content as string);
}

/**
 * Full content manufacturing pipeline.
 * Explodes topic -> Generates hooks -> Generates draft -> Runs claim safety checks -> Persists draft.
 */
export async function runManufacturingPipeline(
  campaignId: string,
  topic: string,
  persona: string,
  options?: { limit?: number }
): Promise<{ success: boolean; draftsCreated: number; errors?: string[] }> {
  try {
    const db = await getDbTyped();
    if (!db) throw new Error("Database not available");

    log.info(`Starting Content Manufacturing pipeline for topic "${topic}"`);

    // 1. Distinctiveness / Novelty check:
    // skip any topic shipped/published in the last 14 days
    const recentItems = await db
      .select({ topic: socialContentInventory.topic })
      .from(socialContentInventory)
      .where(
        and(
          eq(socialContentInventory.status, "published"),
          gte(socialContentInventory.publishedAt, new Date(Date.now() - 14 * 24 * 60 * 60 * 1000))
        )
      );
    const recentTopics = recentItems.map(i => i.topic.toLowerCase().trim());
    if (recentTopics.includes(topic.toLowerCase().trim())) {
      log.info(`Topic "${topic}" was already published in the last 14 days. Skipping for distinctiveness.`);
      return { success: false, draftsCreated: 0, errors: [`Topic "${topic}" recently published`] };
    }

    // 2. Explode topic into angles
    const angles = await explodeTopic(topic);
    if (angles.length === 0) {
      return { success: false, draftsCreated: 0, errors: ["No content angles exploded"] };
    }

    let draftsCreated = 0;
    const errors: string[] = [];

    // Process top 3 angles for now to keep generation cost bounded
    const selectedAngles = angles.slice(0, 3);

    for (const angle of selectedAngles) {
      // Determine content type cycle (Reels / Carousel / standard Post)
      const contentTypes: Array<"reel" | "carousel" | "post"> = ["reel", "carousel", "post"];
      const contentType = contentTypes[draftsCreated % contentTypes.length];

      // 3. Generate Scored Draft
      let attempts = 0;
      let draft: SocialDraft | null = null;
      let isSafe = false;
      let isAbsurdDraft = false;
      let bestHook: Hook | null = null;

      while (attempts < 3 && !isSafe) {
        attempts++;
        try {
          const topicAngleHash = (topic + angle.angle).split("").reduce((a, b) => a + b.charCodeAt(0), 0);
          const useAbsurdity = (topicAngleHash % 10) < 3;
          if (true) {
            // Run Hook Tournament for angle
            try {
              bestHook = await generateHookTournament(topic, angle);
            } catch (e) {
              log.error("Hook tournament failed, falling back to generateHookLibrary:", e);
              const hooks = await generateHookLibrary(topic, angle);
              if (hooks.length === 0) continue;
              bestHook = hooks.reduce((prev, current) =>
                (prev.scoreOverall || 0) > (current.scoreOverall || 0) ? prev : current
              );
            }
            draft = await generateScoredDraft(topic, angle, bestHook!, persona, contentType, "both");
            isAbsurdDraft = false;
          }

          if (draft) {
            const validation = validateClaimSafety(draft);
            if (validation.safe) {
              isSafe = true;
            } else {
              log.warn(`Safety validation failed for draft on attempt ${attempts}`, { errors: validation.errors });
            }
          }
        } catch (e) {
          log.error("Failed to generate draft attempt:", e);
        }
      }

      if (draft && isSafe) {
        // Run Independent Critic Pass (second model call)
        let criticScores: Record<string, number>;
        try {
          criticScores = await critiqueSocialDraft(draft, topic, angle);
        } catch (e) {
          log.error("Independent critic pass failed, falling back to draft self-scores:", e);
          criticScores = {
            scoreCuriosity: draft.scoreCuriosity,
            scoreEmotion: draft.scoreEmotion,
            scoreShareability: draft.scoreShareability,
            scoreCommentPotential: draft.scoreCommentPotential,
            scoreSavePotential: draft.scoreSavePotential,
            scoreLocalRelevance: draft.scoreLocalRelevance,
            scoreRevenueRelevance: draft.scoreRevenueRelevance,
            scoreAuthority: draft.scoreAuthority,
            scoreHookStrength: draft.scoreHookStrength,
          };
        }

        // Calculate overall score with new weights:
        // Curiosity: 0.125, Emotion: 0.125, Shareability: 0.125, CommentPotential: 0.125
        // SavePotential: 0.10, LocalRelevance: 0.15, RevenueRelevance: 0.10, Authority: 0.15
        const overallScore = Math.round(
          criticScores.scoreCuriosity * 0.125 +
          criticScores.scoreEmotion * 0.125 +
          criticScores.scoreShareability * 0.125 +
          criticScores.scoreCommentPotential * 0.125 +
          criticScores.scoreSavePotential * 0.10 +
          criticScores.scoreLocalRelevance * 0.15 +
          criticScores.scoreRevenueRelevance * 0.10 +
          criticScores.scoreAuthority * 0.15
        );

        // Overall score gate check (must be >= 90)
        if (overallScore < 90) {
          log.warn(`Critic overall score ${overallScore} is below gate 90. Skipping draft.`);
          continue;
        }

        // Insert into database
        const draftId = `draft_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        
        let assetPaths: string[] = [];
        let finalStatus = "approved";
        let finalBriefJson = draft.briefJson;

        if (contentType === "reel") {
          try {
            log.info("Generating Reel Brief and Enqueueing Job...");
            const { generateReelBriefAI } = await import("./reelBriefGen");
            const { enqueueReelJob } = await import("./reelPipeline");

            const { brief } = await generateReelBriefAI({ topic });
            brief.id = draftId;

            const { jobId } = await enqueueReelJob(brief, "cron");

            finalStatus = "generating";
            assetPaths = [];
            
            let parsedBrief = {};
            try {
              parsedBrief = JSON.parse(draft.briefJson);
            } catch (e) {
              // Ignore
            }
            finalBriefJson = JSON.stringify({
              ...parsedBrief,
              reelJobId: jobId,
              reelBrief: brief,
            });
          } catch (e) {
            log.warn("Reel generation failed, falling back", { e: e instanceof Error ? e.message : String(e) });
          }
        } else if (contentType === "carousel") {
          try {
            log.info("Generating Option C Hybrid Carousel Assets...");
            const { generateImage } = await import("../_core/imageGeneration");
            const { renderAdSlides } = await import("./adStudio/adRender");
            
            // 1. Hook Image via AI
            const hookPrompt = `A stunning, hyper-realistic photo. ${draft.visualStyle}. Concept: ${draft.hookText}. No text. Cinematic lighting.`;
            const hookImageRes = await generateImage({ prompt: hookPrompt });
            const aiImageUrl = hookImageRes.url;
            
            // 2. Typography slides via AdStudio
            const copy = {
              ...draft.adCopy,
              caption: draft.caption
            };
            const rendered = await renderAdSlides(copy);
            
            if (aiImageUrl) {
              // Replace the AdStudio hook slide (index 0) with the AI image
              rendered.slideUrls[0] = aiImageUrl;
            }
            assetPaths = rendered.slideUrls;
          } catch (e) {
            log.warn("Hybrid Carousel generation failed, falling back to empty assets", { e: e instanceof Error ? e.message : String(e) });
          }
        }

        await db.insert(socialContentInventory).values({
          id: draftId,
          campaignId,
          contentType: contentType,
          platform: "both",
          topic,
          seriesName: isAbsurdDraft ? "Useful Absurdity" : angle.narrativeFranchise,
          episodeNumber: 1,
          hookCategory: isAbsurdDraft ? "humor" : (bestHook?.hookCategory || "general"),
          hookText: draft.hookText,
          bodyText: draft.bodyText,
          visualStyle: draft.visualStyle,
          persona: draft.persona,
          scoreCuriosity: criticScores.scoreCuriosity,
          scoreEmotion: criticScores.scoreEmotion,
          scoreShareability: criticScores.scoreShareability,
          scoreCommentPotential: criticScores.scoreCommentPotential,
          scoreSavePotential: criticScores.scoreSavePotential,
          scoreLocalRelevance: criticScores.scoreLocalRelevance,
          scoreRevenueRelevance: criticScores.scoreRevenueRelevance,
          scoreAuthority: criticScores.scoreAuthority,
          scoreHookStrength: criticScores.scoreHookStrength,
          scoreOverall: overallScore,
          gscQuerySeed: isAbsurdDraft ? draft.hookText : (bestHook?.hookText || ""),
          weatherTriggerCondition: draft.weatherTriggerCondition || null,
          interactiveDmKeyword: draft.interactiveDmKeyword,
          status: finalStatus,
          briefJson: finalBriefJson,
          assetPaths: assetPaths
        });

        draftsCreated++;
      } else {
        errors.push(`Failed to generate a safe draft for angle: ${angle.angle}`);
      }
    }

    return {
      success: draftsCreated > 0,
      draftsCreated,
      errors: errors.length > 0 ? errors : undefined
    };
  } catch (err) {
    log.error("Pipeline generation error:", err);
    return {
      success: false,
      draftsCreated: 0,
      errors: [err instanceof Error ? err.message : String(err)]
    };
  }
}

export interface ContentTypeReserve {
  contentType: "reel" | "carousel" | "post" | "story";
  count: number;
  days: number;
  threshold: number;
  deficit: number;
}

export interface CampaignCoverage {
  campaignId: string;
  topic: string;
  count: number;
  deficit: number;
  warning: string | null;
}

export interface ServiceCoverageInfo {
  count: number;
  percentage: number;
}

export interface ReserveStatus {
  reserves: Record<string, ContentTypeReserve>;
  campaignCoverage: CampaignCoverage[];
  deficitAlerts: string[];
  serviceCoverage: Record<string, ServiceCoverageInfo>;
  diversityReport: {
    underCoveredServices: string[];
    overCoveredServices: string[];
    tiresPercentage: number;
    isTireLimitExceeded: boolean;
  };
}

export const ALL_SERVICES = [
  "Tires",
  "Brakes",
  "Alignment",
  "Suspension",
  "Diagnostics",
  "Oil Changes",
  "Batteries",
  "AC/Cooling",
  "Wheel Bearings"
];

export function getServiceCoverageStatus(inventory: { topic: string; bodyText: string; seriesName?: string }[]): Record<string, ServiceCoverageInfo> {
  const serviceCounts: Record<string, number> = {};
  for (const s of ALL_SERVICES) {
    serviceCounts[s] = 0;
  }
  for (const item of inventory) {
    const category = detectServiceCategory(item);
    serviceCounts[category] = (serviceCounts[category] || 0) + 1;
  }
  const total = inventory.length;
  const coverage: Record<string, ServiceCoverageInfo> = {};
  for (const s of ALL_SERVICES) {
    const count = serviceCounts[s] || 0;
    coverage[s] = {
      count,
      percentage: total > 0 ? Math.round((count / total) * 100) : 0
    };
  }
  return coverage;
}

export function selectUnderservedService(coverage: Record<string, ServiceCoverageInfo>): string {
  const priorityList = [
    "Brakes",
    "Suspension",
    "Diagnostics",
    "Alignment",
    "Batteries",
    "AC/Cooling",
    "Wheel Bearings",
    "Oil Changes",
    "Tires"
  ];
  
  for (const service of priorityList) {
    if (coverage[service] && coverage[service].count === 0) {
      return service;
    }
  }
  
  let bestService = priorityList[0];
  let minCount = Infinity;
  for (const service of priorityList) {
    const count = coverage[service]?.count ?? 0;
    if (count < minCount) {
      minCount = count;
      bestService = service;
    }
  }
  return bestService;
}

export function enforceServiceDiversityQuota(campaigns: any[], coverage: Record<string, ServiceCoverageInfo>): any[] {
  const total = Object.values(coverage).reduce((acc, curr) => acc + curr.count, 0);
  const tireCount = coverage["Tires"]?.count ?? 0;
  const tirePercentage = total > 0 ? (tireCount / total) * 100 : 0;
  
  if (tirePercentage > 40) {
    log.info(`Tires active inventory quota exceeded (${Math.round(tirePercentage)}% > 40%). Filtering/demoting Tires campaigns.`);
    const nonTireCampaigns = campaigns.filter(c => {
      const cat = detectServiceCategory({ topic: c.topic, bodyText: "" });
      return cat !== "Tires";
    });
    const tireCampaigns = campaigns.filter(c => {
      const cat = detectServiceCategory({ topic: c.topic, bodyText: "" });
      return cat === "Tires";
    });
    return [...nonTireCampaigns, ...tireCampaigns];
  }
  return campaigns;
}

/**
 * Calculates current content reserve levels and triggers alarms if reserves fall below safety thresholds.
 */
export async function getReserveStatus(): Promise<ReserveStatus> {
  const db = await getDbTyped();
  if (!db) throw new Error("Database not available");

  // Fetch all active campaigns
  const activeCampaigns = await db
    .select()
    .from(contentManufacturingCampaigns)
    .where(eq(contentManufacturingCampaigns.isActive, true));

  // Fetch all non-rejected social content inventory
  const inventory = await db
    .select({
      id: socialContentInventory.id,
      contentType: socialContentInventory.contentType,
      topic: socialContentInventory.topic,
      status: socialContentInventory.status,
      bodyText: socialContentInventory.bodyText,
      seriesName: socialContentInventory.seriesName
    })
    .from(socialContentInventory)
    .where(sql`${socialContentInventory.status} != 'rejected'`);

  // Target metrics: daily published
  const targets = {
    reel: 2,
    post: 2,
    story: 2,
    carousel: 1
  };

  const thresholds = {
    reel: 60,
    post: 60,
    story: 60,
    carousel: 30
  };

  // Group inventory by content type
  const typeCounts = {
    reel: 0,
    post: 0,
    story: 0,
    carousel: 0
  };

  for (const item of inventory) {
    if (item.contentType in typeCounts) {
      typeCounts[item.contentType as keyof typeof typeCounts]++;
    }
  }

  const reserves: Record<string, ContentTypeReserve> = {};
  const deficitAlerts: string[] = [];

  for (const type of ["reel", "post", "story", "carousel"] as const) {
    const count = typeCounts[type];
    const target = targets[type];
    const threshold = thresholds[type];
    const days = Math.round((count / target) * 10) / 10;
    const deficit = Math.max(0, threshold - days);

    reserves[type] = {
      contentType: type,
      count,
      days,
      threshold,
      deficit
    };

    if (deficit > 0) {
      const assetDeficit = Math.ceil(deficit * target);
      deficitAlerts.push(`Reserve Deficit: Need ${assetDeficit} more ${type}s to meet the ${threshold}-day safety threshold.`);
    }
  }

  // Calculate campaign coverage
  const campaignCoverage: CampaignCoverage[] = [];
  for (const camp of activeCampaigns) {
    const topicCount = inventory.filter(i => i.topic.toLowerCase() === camp.topic.toLowerCase()).length;
    const requiredCoverage = 15;
    const campDeficit = Math.max(0, requiredCoverage - topicCount);
    let warning = null;
    if (campDeficit > 0) {
      warning = `Topic "${camp.topic}" has only ${topicCount} drafts (deficit: ${campDeficit} assets).`;
      deficitAlerts.push(`Campaign Gap: "${camp.topic}" has low coverage. Generate ${campDeficit} more drafts.`);
    }

    campaignCoverage.push({
      campaignId: camp.id,
      topic: camp.topic,
      count: topicCount,
      deficit: campDeficit,
      warning
    });
  }

  // Calculate service coverage and diversity report
  const serviceCoverage = getServiceCoverageStatus(inventory);
  const totalActive = inventory.length;
  const tireCount = serviceCoverage["Tires"]?.count ?? 0;
  const tiresPercentage = totalActive > 0 ? Math.round((tireCount / totalActive) * 100) : 0;
  const isTireLimitExceeded = tiresPercentage > 40;

  const underCoveredServices: string[] = [];
  const overCoveredServices: string[] = [];

  for (const s of ALL_SERVICES) {
    const info = serviceCoverage[s];
    if (s === "Tires" && info.percentage > 40) {
      overCoveredServices.push(s);
    } else if (s !== "Tires" && info.percentage > 25) {
      overCoveredServices.push(s);
    }
    if (info.count === 0 || (totalActive >= 10 && info.percentage < 5)) {
      underCoveredServices.push(s);
    }
  }

  const diversityReport = {
    underCoveredServices,
    overCoveredServices,
    tiresPercentage,
    isTireLimitExceeded
  };

  return {
    reserves,
    campaignCoverage,
    deficitAlerts,
    serviceCoverage,
    diversityReport
  };
}

/**
 * Replenishes reserves by triggering pipeline generation for campaigns with deficits.
 */
export async function replenishReserve(): Promise<{ success: boolean; draftsCreated: number; campaignRuns: string[] }> {
  log.info("Starting automated reserve replenishment run");
  const status = await getReserveStatus();

  const db = await getDbTyped();
  if (!db) throw new Error("Database not available");

  // Fetch all active campaigns
  const activeCampaigns = await db
    .select()
    .from(contentManufacturingCampaigns)
    .where(eq(contentManufacturingCampaigns.isActive, true));

  // Build a lookup map of campaign ID to campaign row
  const campaignMap = new Map(activeCampaigns.map(c => [c.id, c]));

  // Enforce diversity quota on active campaigns list
  const coverage = status.serviceCoverage;
  const orderedActiveCampaigns = enforceServiceDiversityQuota(activeCampaigns, coverage);

  // Filter and prioritize campaigns with deficits based on the ordered campaign order
  const sortedCampaigns = [...status.campaignCoverage]
    .filter(c => c.deficit > 0);

  const tiresLimitExceeded = status.diversityReport.isTireLimitExceeded;
  const sortedCampaignsMapped = sortedCampaigns
    .map(c => campaignMap.get(c.campaignId))
    .filter((c): c is NonNullable<typeof c> => !!c);

  sortedCampaignsMapped.sort((a, b) => {
    const aCat = detectServiceCategory({ topic: a.topic, bodyText: "" });
    const bCat = detectServiceCategory({ topic: b.topic, bodyText: "" });
    
    if (tiresLimitExceeded) {
      if (aCat === "Tires" && bCat !== "Tires") return 1;
      if (aCat !== "Tires" && bCat === "Tires") return -1;
    }
    
    const aDef = status.campaignCoverage.find(c => c.campaignId === a.id)?.deficit ?? 0;
    const bDef = status.campaignCoverage.find(c => c.campaignId === b.id)?.deficit ?? 0;
    return bDef - aDef;
  });

  let campaignsToRun = sortedCampaignsMapped.map(c => c.id);
  if (campaignsToRun.length === 0) {
    const hasTypeDeficit = Object.values(status.reserves).some(r => r.deficit > 0);
    if (hasTypeDeficit) {
      const prioritizedCampaigns = tiresLimitExceeded
        ? activeCampaigns.filter(c => detectServiceCategory({ topic: c.topic, bodyText: "" }) !== "Tires")
        : activeCampaigns;
      campaignsToRun = prioritizedCampaigns.length > 0
        ? prioritizedCampaigns.map(c => c.id)
        : activeCampaigns.map(c => c.id);
    }
  }

  if (campaignsToRun.length === 0) {
    log.info("No reserve replenishment needed at this time.");
    return { success: true, draftsCreated: 0, campaignRuns: [] };
  }

  let totalDraftsCreated = 0;
  const campaignRuns: string[] = [];
  const limitCampaigns = campaignsToRun.slice(0, 2);

  for (const campaignId of limitCampaigns) {
    const campaign = await db
      .select()
      .from(contentManufacturingCampaigns)
      .where(eq(contentManufacturingCampaigns.id, campaignId))
      .limit(1)
      .then(rows => rows[0]);

    if (campaign && campaign.isActive) {
      log.info(`Replenishing campaign topic "${campaign.topic}"`);
      const result = await runManufacturingPipeline(campaign.id, campaign.topic, campaign.persona);
      if (result.success) {
        totalDraftsCreated += result.draftsCreated;
        campaignRuns.push(campaign.topic);
      }
    }
  }

  return {
    success: totalDraftsCreated > 0,
    draftsCreated: totalDraftsCreated,
    campaignRuns
  };
}

/**
 * Matches instagramAnalytics records to socialContentInventory items (via caption check),
 * copying reach, engagement (likes + comments), shares, saves, and comments count.
 */
export async function syncSocialMetrics(): Promise<{ matched: number; updated: number }> {
  log.info("Running syncSocialMetrics loop");
  const db = await getDbTyped();
  if (!db) return { matched: 0, updated: 0 };

  const inventoryItems = await db
    .select()
    .from(socialContentInventory)
    .where(eq(socialContentInventory.status, "published"));

  const analyticsPosts = await db
    .select()
    .from(instagramAnalytics);

  let matched = 0;
  let updated = 0;

  const cleanText = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, "");

  for (const item of inventoryItems) {
    const matchingPost = analyticsPosts.find((post) => {
      if (!post.caption) return false;
      const cleanCaption = cleanText(post.caption);

      // Match 1: caption contains clean hookText
      if (item.hookText && cleanCaption.includes(cleanText(item.hookText))) {
        return true;
      }
      // Match 2: caption contains clean bodyText
      if (item.bodyText && cleanCaption.includes(cleanText(item.bodyText))) {
        return true;
      }
      // Match 3: keyword match + content type alignment
      if (item.interactiveDmKeyword && item.interactiveDmKeyword.length > 2) {
        const cleanKeyword = cleanText(item.interactiveDmKeyword);
        if (cleanCaption.includes(cleanKeyword)) {
          const typeMatch =
            (item.contentType === "reel" && post.postType === "VIDEO") ||
            (item.contentType === "carousel" && post.postType === "CAROUSEL_ALBUM") ||
            (item.contentType === "post" && post.postType === "IMAGE");
          if (typeMatch) return true;
        }
      }
      return false;
    });

    if (matchingPost) {
      matched++;
      const reach = matchingPost.reach || 0;
      const likes = matchingPost.likes || 0;
      const comments = matchingPost.comments || 0;
      const engagement = likes + comments;
      const shares = matchingPost.shares || 0;
      const saves = matchingPost.saved || 0;

      if (
        item.metricsReach !== reach ||
        item.metricsEngagement !== engagement ||
        item.metricsShares !== shares ||
        item.metricsSaves !== saves ||
        item.metricsComments !== comments
      ) {
        await db
          .update(socialContentInventory)
          .set({
            metricsReach: reach,
            metricsEngagement: engagement,
            metricsShares: shares,
            metricsSaves: saves,
            metricsComments: comments,
          })
          .where(eq(socialContentInventory.id, item.id));
        updated++;
      }
    }
  }

  log.info(`syncSocialMetrics finished: matched=${matched} updated=${updated}`);
  return { matched, updated };
}

/**
 * Attributes bookings back to socialContentInventory items based on customer phone numbers
 * that interacted with the interactiveDmKeyword.
 */
export async function attributeRevenueToSocial(): Promise<{ itemsProcessed: number; bookingsAttributed: number }> {
  log.info("Running attributeRevenueToSocial loop");
  const db = await getDbTyped();
  if (!db) return { itemsProcessed: 0, bookingsAttributed: 0 };

  // Fetch all published content inventory items with DM keywords
  const items = await db
    .select()
    .from(socialContentInventory)
    .where(
      and(
        eq(socialContentInventory.status, "published"),
        sql`${socialContentInventory.interactiveDmKeyword} IS NOT NULL`
      )
    );

  let itemsProcessed = 0;
  let bookingsAttributed = 0;

  const ATTRIBUTION_WINDOW_DAYS = 14;

  for (const item of items) {
    const keyword = item.interactiveDmKeyword;
    if (!keyword) continue;
    itemsProcessed++;

    const publishedAt = item.publishedAt || item.createdAt;

    // Find communications containing the keyword since publication
    const comms = await db
      .select({
        phone: communicationLog.customerPhone,
        createdAt: communicationLog.createdAt,
      })
      .from(communicationLog)
      .where(
        and(
          like(communicationLog.body, `%${keyword}%`),
          gte(communicationLog.createdAt, publishedAt)
        )
      );

    const sms = await db
      .select({
        phone: smsConversations.phone,
        createdAt: smsMessages.createdAt,
      })
      .from(smsMessages)
      .innerJoin(smsConversations, eq(smsMessages.conversationId, smsConversations.id))
      .where(
        and(
          like(smsMessages.body, `%${keyword}%`),
          gte(smsMessages.createdAt, publishedAt)
        )
      );

    const phoneInteractions = new Map<string, Date>();

    const addInteraction = (phone: string | null, date: Date) => {
      if (!phone) return;
      const norm = phone.replace(/\D/g, "").slice(-10);
      if (norm.length !== 10) return;

      const existing = phoneInteractions.get(norm);
      if (!existing || date < existing) {
        phoneInteractions.set(norm, date);
      }
    };

    for (const c of comms) addInteraction(c.phone, c.createdAt);
    for (const s of sms) addInteraction(s.phone, s.createdAt);

    let postBookingsCount = 0;

    for (const [phone, interactionDate] of phoneInteractions.entries()) {
      const windowEnd = new Date(interactionDate.getTime() + ATTRIBUTION_WINDOW_DAYS * 24 * 60 * 60 * 1000);

      // Find bookings for this phone number inside the attribution window
      const matchedBookings = await db
        .select()
        .from(bookings)
        .where(
          and(
            sql`RIGHT(REGEXP_REPLACE(${bookings.phone}, '[^0-9]', ''), 10) = ${phone}`,
            gte(bookings.createdAt, interactionDate),
            lte(bookings.createdAt, windowEnd)
          )
        );

      // Apply 50% decay every 7 days (exponential time-decay)
      let phoneBookingWeight = 0;
      for (const b of matchedBookings) {
        const bookingTime = new Date(b.createdAt).getTime();
        const diffMs = bookingTime - interactionDate.getTime();
        const diffDays = Math.max(0, diffMs / (24 * 60 * 60 * 1000));
        const weight = Math.pow(0.5, diffDays / 7);
        phoneBookingWeight += weight;
      }
      postBookingsCount += phoneBookingWeight;
    }

    const roundedBookingsCount = Math.round(postBookingsCount);
    bookingsAttributed += roundedBookingsCount;

    // Update the inventory item
    await db
      .update(socialContentInventory)
      .set({
        metricsBookingsAttributed: roundedBookingsCount,
      })
      .where(eq(socialContentInventory.id, item.id));
  }

  log.info(`attributeRevenueToSocial finished: itemsProcessed=${itemsProcessed} bookingsAttributed=${bookingsAttributed}`);
  return { itemsProcessed, bookingsAttributed };
}
