import { CampaignOutput } from "../schemas/output.js";

export interface CreativeBriefPayload {
  contentType: "post" | "reel" | "carousel" | "story" | "poll";
  platform: "both" | "instagram" | "facebook" | "tiktok" | "youtube";
  topic: string;
  seriesName: string;
  hookCategory: string;
  hookText: string;
  bodyText: string;
  visualStyle: string;
  persona: string;
  briefJson: string;
  status: "pending";
}

export function extractCreativeBriefs(plan: CampaignOutput): CreativeBriefPayload[] {
  const payloads: CreativeBriefPayload[] = [];
  const campaignName = plan.campaignArchitecture.namingConventions.campaign;

  // Extract Reel Prompts
  for (const reel of plan.creativePrompts.reelPrompts) {
    payloads.push({
      contentType: "reel",
      platform: "both",
      topic: campaignName,
      seriesName: "Paid Reel Ads",
      hookCategory: "Reel Hook",
      hookText: reel.hookFirst2Seconds,
      bodyText: `Scene Beats:\n${reel.sceneBeats.join("\n")}\n\nOn Screen Text:\n${reel.onScreenTextPlan}\n\nCTA:\n${reel.endFrameCta}`,
      visualStyle: "Reel",
      persona: "Brand Voice",
      briefJson: JSON.stringify(reel),
      status: "pending",
    });
  }

  // Extract Image Prompts
  for (const img of plan.creativePrompts.imagePrompts) {
    payloads.push({
      contentType: "post",
      platform: "both",
      topic: campaignName,
      seriesName: "Paid Image Ads",
      hookCategory: "Visual Hook",
      hookText: `${img.subject} - ${img.scene}`,
      bodyText: `Lighting: ${img.lighting}\nComposition: ${img.composition}\nNegative Instructions: ${img.negativeInstructions}\nSafe Space: ${img.textSafeSpaceInstruction}`,
      visualStyle: img.format, // 1:1, 4:5, 9:16
      persona: "Brand Voice",
      briefJson: JSON.stringify(img),
      status: "pending",
    });
  }

  // Extract Ad Copy Variants
  for (const bundle of plan.adCopyFactory) {
    for (const shortText of bundle.shortPrimaryTexts) {
      payloads.push({
        contentType: "post",
        platform: "both",
        topic: campaignName,
        seriesName: `Copy: ${bundle.bundleName}`,
        hookCategory: "Short Copy",
        hookText: bundle.headlines[0] || "Headline",
        bodyText: `${shortText}\n\nDescriptions: ${bundle.descriptions.join(" | ")}\nCTA: ${bundle.ctaButtonRecommendations.join(" | ")}`,
        visualStyle: "Copy Only",
        persona: "Brand Voice",
        briefJson: JSON.stringify(bundle),
        status: "pending",
      });
    }

    payloads.push({
      contentType: "post",
      platform: "both",
      topic: campaignName,
      seriesName: `Copy: ${bundle.bundleName}`,
      hookCategory: "Long Copy",
      hookText: bundle.headlines[1] || "Headline",
      bodyText: `${bundle.longPrimaryText}\n\nDescriptions: ${bundle.descriptions.join(" | ")}\nCTA: ${bundle.ctaButtonRecommendations.join(" | ")}`,
      visualStyle: "Copy Only",
      persona: "Brand Voice",
      briefJson: JSON.stringify(bundle),
      status: "pending",
    });
  }

  return payloads;
}
