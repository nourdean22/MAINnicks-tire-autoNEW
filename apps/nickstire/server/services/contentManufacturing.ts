import { eq, and, desc, sql, gte, lte } from "drizzle-orm";
import { getDbTyped } from "../db";
import {
  contentManufacturingCampaigns,
  socialContentInventory,
  searchPerformance,
  competitorSnapshots
} from "../../drizzle/schema";
import { invokeLLM } from "../_core/llm";
import { createLogger } from "../lib/logger";
import { checkWeatherTriggers } from "./weatherIntelligence";

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

  return {
    safe: errors.length === 0,
    errors
  };
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
  const visualStyle = VISUAL_STYLES[Math.floor(Math.random() * VISUAL_STYLES.length)];

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
          briefJson: { type: "string" }
        },
        required: [
          "hookText", "bodyText", "visualStyle", "persona", "interactiveDmKeyword",
          "caption", "hashtags", "scoreCuriosity", "scoreEmotion", "scoreShareability",
          "scoreCommentPotential", "scoreSavePotential", "scoreLocalRelevance",
          "scoreRevenueRelevance", "scoreAuthority", "scoreHookStrength", "briefJson"
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

    // 1. Explode topic into angles
    const angles = await explodeTopic(topic);
    if (angles.length === 0) {
      return { success: false, draftsCreated: 0, errors: ["No content angles exploded"] };
    }

    let draftsCreated = 0;
    const errors: string[] = [];

    // Process top 3 angles for now to keep generation cost bounded
    const selectedAngles = angles.slice(0, 3);

    for (const angle of selectedAngles) {
      // 2. Generate Hook library for angle
      const hooks = await generateHookLibrary(topic, angle);
      if (hooks.length === 0) continue;

      // Select the single highest scoring hook
      const bestHook = hooks.reduce((prev, current) =>
        (prev.scoreOverall || 0) > (current.scoreOverall || 0) ? prev : current
      );

      // Determine content type cycle (Reels / Carousel / standard Post)
      const contentTypes: Array<"reel" | "carousel" | "post"> = ["reel", "carousel", "post"];
      const contentType = contentTypes[draftsCreated % contentTypes.length];

      // 3. Generate Scored Draft
      let attempts = 0;
      let draft: SocialDraft | null = null;
      let isSafe = false;

      while (attempts < 3 && !isSafe) {
        attempts++;
        try {
          draft = await generateScoredDraft(topic, angle, bestHook, persona, contentType, "both");
          const validation = validateClaimSafety(draft);
          if (validation.safe) {
            isSafe = true;
          } else {
            log.warn(`Safety validation failed for draft on attempt ${attempts}`, { errors: validation.errors });
          }
        } catch (e) {
          log.error("Failed to generate draft attempt:", e);
        }
      }

      if (draft && isSafe) {
        // Calculate overall score
        const overallScore = Math.round(
          draft.scoreCuriosity * 0.15 +
          draft.scoreEmotion * 0.15 +
          draft.scoreShareability * 0.15 +
          draft.scoreCommentPotential * 0.15 +
          draft.scoreSavePotential * 0.1 +
          draft.scoreLocalRelevance * 0.1 +
          draft.scoreRevenueRelevance * 0.1 +
          draft.scoreAuthority * 0.1
        );

        // Overall score gate check (must be >= 75)
        if (overallScore < 75) {
          log.warn(`Overall score ${overallScore} is below gate 75. Skipping draft.`);
          continue;
        }

        // Insert into database
        const draftId = `draft_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        await db.insert(socialContentInventory).values({
          id: draftId,
          campaignId,
          contentType: contentType,
          platform: "both",
          topic,
          seriesName: angle.narrativeFranchise,
          episodeNumber: 1,
          hookCategory: bestHook.hookCategory,
          hookText: draft.hookText,
          bodyText: draft.bodyText,
          visualStyle: draft.visualStyle,
          persona: draft.persona,
          scoreCuriosity: draft.scoreCuriosity,
          scoreEmotion: draft.scoreEmotion,
          scoreShareability: draft.scoreShareability,
          scoreCommentPotential: draft.scoreCommentPotential,
          scoreSavePotential: draft.scoreSavePotential,
          scoreLocalRelevance: draft.scoreLocalRelevance,
          scoreRevenueRelevance: draft.scoreRevenueRelevance,
          scoreAuthority: draft.scoreAuthority,
          scoreHookStrength: draft.scoreHookStrength,
          scoreOverall: overallScore,
          gscQuerySeed: bestHook.hookText, // Use the seed query
          weatherTriggerCondition: draft.weatherTriggerCondition || null,
          interactiveDmKeyword: draft.interactiveDmKeyword,
          status: "pending",
          briefJson: draft.briefJson,
          assetPaths: []
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

export interface ReserveStatus {
  reserves: Record<string, ContentTypeReserve>;
  campaignCoverage: CampaignCoverage[];
  deficitAlerts: string[];
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
      status: socialContentInventory.status
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

  return {
    reserves,
    campaignCoverage,
    deficitAlerts
  };
}

/**
 * Replenishes reserves by triggering pipeline generation for campaigns with deficits.
 */
export async function replenishReserve(): Promise<{ success: boolean; draftsCreated: number; campaignRuns: string[] }> {
  log.info("Starting automated reserve replenishment run");
  const status = await getReserveStatus();

  // Find active campaigns that have deficits (ordered by largest deficit first)
  const sortedCampaigns = [...status.campaignCoverage]
    .filter(c => c.deficit > 0)
    .sort((a, b) => b.deficit - a.deficit);

  const db = await getDbTyped();
  if (!db) throw new Error("Database not available");

  let campaignsToRun = sortedCampaigns.map(c => c.campaignId);
  if (campaignsToRun.length === 0) {
    const hasTypeDeficit = Object.values(status.reserves).some(r => r.deficit > 0);
    if (hasTypeDeficit) {
      const activeCampaigns = await db
        .select()
        .from(contentManufacturingCampaigns)
        .where(eq(contentManufacturingCampaigns.isActive, true));
      campaignsToRun = activeCampaigns.map(c => c.id);
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
