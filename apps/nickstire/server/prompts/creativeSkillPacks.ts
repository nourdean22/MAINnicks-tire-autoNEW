export function buildAdCreativeSkill(): string {
  return `
[SKILL PACK: AD_CREATIVE]
You are composing a direct-response Meta Ad for Nick's Tire (Cleveland's walk-in tire & auto shop).
CRITICAL RULES:
1. Sell the visit, not a quote. DO NOT mention specific prices or pricing transparency.
2. Emphasize "Same-Day Service" and "Local Trust" (e.g., serving Cleveland).
3. Do not invent any promotional offers.
4. Keep the persona warm, authoritative, and direct.
`.trim();
}

export function buildFacelessReelSkill(): string {
  return `
[SKILL PACK: FACELESS_REEL_SCRIPT]
You are structuring a faceless Reel for Nick's Tire.
CRITICAL RULES:
1. No faces, no license plates, no generic stock footage. Focus on the car parts, the tools, the shop environment, and macro shots.
2. Maintain extremely fast-paced visual storytelling (B-roll changes every 1-2 seconds).
3. Ensure the on-screen text creates a cognitive loop (unresolved curiosity hook).
4. The visuals should describe lighting, motion, and subject matter without dictating exact camera settings unless necessary for the effect.
`.trim();
}

export interface TrendTopic {
  topic: string;
  angle: string;
  context: string;
}

export function buildTrendTopicSkill(data: {
  diversityReport?: {
    underCoveredServices: string[];
    overCoveredServices: string[];
    tiresPercentage: number;
    isTireLimitExceeded: boolean;
  };
  localWeather?: string;
}): TrendTopic[] {
  // Constraint: Must only consume provided contextual data.
  // It may NOT query external APIs or fabricate platform metrics.
  
  const topics: TrendTopic[] = [];

  // Weather-based
  if (data.localWeather && data.localWeather.toLowerCase().includes("rain")) {
    topics.push({
      topic: "Wiper Blades & Rain Repellent",
      angle: "Visibility Safety",
      context: "It is currently raining in Cleveland. Promote safe driving visibility.",
    });
  }

  // Service deficits
  if (data.diversityReport && data.diversityReport.underCoveredServices.length > 0) {
    // Top priority deficit
    const topDeficit = data.diversityReport.underCoveredServices[0];
    if (topDeficit) {
      topics.push({
        topic: `${topDeficit} Inspection`,
        angle: "Preventative Maintenance",
        context: `Service gap identified: ${topDeficit}. Focus on early warning signs.`,
      });
      topics.push({
        topic: `${topDeficit} Wear & Tear`,
        angle: "Educational Breakdown",
        context: `Service gap identified: ${topDeficit}. Explain how it fails over time.`,
      });
    }
  }

  // Fallback if no specific trend data yielded topics
  if (topics.length === 0) {
    topics.push({
      topic: "Same-Day Service Basics",
      angle: "Walk-In Convenience",
      context: "General fallback for Nick's Tire core value proposition.",
    });
  }

  return topics;
}
