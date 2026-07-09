import { isEnabled } from "./featureFlags";
import { 
  buildAdCreativeSkill, 
  buildFacelessReelSkill, 
  buildTrendTopicSkill, 
  TrendTopic 
} from "../prompts/creativeSkillPacks";

export type SkillContext = 
  | { type: "ad_composition" }
  | { type: "reel_brief" }
  | { type: "reel_ingest_beats" }
  | { type: "topic_selection", data: any };

export type SkillResult = 
  | { fragment: string }
  | { topicSeeds: TrendTopic[] };

export interface OfflineOverrideFlags {
  skill_ad_creative_enabled?: boolean;
  skill_reel_script_enabled?: boolean;
  skill_trend_topics_enabled?: boolean;
}

/**
 * Route context to the appropriate creative skill pack.
 * Safely evaluates feature flags (fail-open) and returns prompt fragments or structured data.
 * @param context Discriminant union defining the injection site and any required data
 * @param offlineOverride Optional explicitly provided flags for offline/CLI usage, bypassing DB lookup
 */
export async function applyCreativeSkills(
  context: SkillContext, 
  offlineOverride?: OfflineOverrideFlags
): Promise<SkillResult> {
  try {
    switch (context.type) {
      case "ad_composition": {
        const enabled = offlineOverride?.skill_ad_creative_enabled ?? await isEnabled("skill_ad_creative_enabled");
        if (!enabled) return { fragment: "" };
        return { fragment: buildAdCreativeSkill() };
      }
      case "reel_brief":
      case "reel_ingest_beats": {
        const enabled = offlineOverride?.skill_reel_script_enabled ?? await isEnabled("skill_reel_script_enabled");
        if (!enabled) return { fragment: "" };
        return { fragment: buildFacelessReelSkill() };
      }
      case "topic_selection": {
        const enabled = offlineOverride?.skill_trend_topics_enabled ?? await isEnabled("skill_trend_topics_enabled");
        if (!enabled) return { topicSeeds: [] };
        return { topicSeeds: buildTrendTopicSkill(context.data) };
      }
      default:
        return { fragment: "" };
    }
  } catch (error) {
    // Fail-open: if DB flag check fails or anything crashes, gracefully degrade
    if (context.type === "topic_selection") {
      return { topicSeeds: [] };
    }
    return { fragment: "" };
  }
}
