/*
 * IG Carousel Intelligence Studio — prompt engine.
 *
 * Builds the copyable MASTER CREATIVE PROMPT (for use in any LLM session),
 * the Higgsfield prompt pack, and the caption block. Pure string builders:
 * nothing here calls an LLM, an image API, or the network.
 */

import {
  ALLOWED_SERVICES,
  APPROVED_USED_TIRE_PRICE_LINE,
  CAMPAIGN_KEYWORDS,
  CREATIVE_TERRITORIES,
  type CarouselBrief,
  type CarouselStudioMode,
  type CreativeTerritory,
  FORBIDDEN_CLAIM_PATTERNS,
  IMPLIED_PROOF_PHRASES,
  OVERDIAGNOSIS_PATTERNS,
  PROOF_SOURCE_FAMILIES,
  SLIDE_ROLES,
  SOFT_DIAGNOSTIC_ALLOWED,
  STUDIO_BRAND,
  STUDIO_DEFAULTS,
} from "./igCarouselStudio";

export interface AnonymizedCaseStudy {
  vehicle: string;
  symptom: string;
  failedComponent: string;
  condition: "yellow" | "red";
  techNotes: string;
  recommendedAction: string;
}

export interface ProprietaryEvidence {
  recentCaseStudy: AnonymizedCaseStudy | null;
  localStats: {
    brakeRustRatioPercent: number;
    potholeDamageCount: number;
    commonVehicles: string[];
    averageMileage: number;
  } | null;
  clevelandAngle: string | null;
  testimonials?: string[];
  pastSocialOutputs?: { topic: string; contentType: string; campaignKeyword?: string }[];
  availability?: "available" | "unavailable";
}

export interface MasterPromptOptions {
  mode: CarouselStudioMode;
  topicOverride?: string;
  keywordOverride?: string;
  territory?: CreativeTerritory;
  seasonLocalAngle?: string;
  avoidTopics?: string[];
  avoidKeywords?: string[];
  proprietaryEvidence?: ProprietaryEvidence;
}

/** Section headers the tests assert on — keep stable. */
export const MASTER_PROMPT_SECTIONS = [
  "## ROLE",
  "## BUSINESS FACTS",
  "## PROPRIETARY SHOP EVIDENCE",
  "## HIDDEN PERSUASION LAYER",
  "## RESEARCH STANDARD",
  "## CONCEPT IDEATION",
  "## SCORING SYSTEM",
  "## USEFUL ABSURDITY",
  "## FIVE-SLIDE STRUCTURE",
  "## HIGGSFIELD PROMPT REQUIREMENTS",
  "## CAPTION REQUIREMENTS",
  "## BOOST QUALITY GATE",
  "## LOGGING REQUIREMENTS",
  "## PUBLISHING SAFETY",
  "## FORBIDDEN CLAIMS",
] as const;

export function buildCarouselStudioSystemPrompt(opts: MasterPromptOptions): string {
  const territory = opts.territory ? CREATIVE_TERRITORIES[opts.territory] : null;
  const lines: string[] = [];

  lines.push("# NICK'S TIRE — IG CAROUSEL INTELLIGENCE STUDIO · MASTER CREATIVE PROMPT");
  lines.push("");
  lines.push(`Mode: ${opts.mode.toUpperCase()} (draft = plan only; asset_prep = prompts ready; publish_prep = checklist only — NEVER post)`);
  lines.push("");

  lines.push("## ROLE");
  lines.push(
    "You are a premium creative director + automotive educator + local growth strategist for a real Cleveland tire & auto shop. " +
      "You produce boost-worthy, source-grounded, 5-slide educational Instagram carousels. You never invent facts, prices, or urgency.",
  );
  lines.push("");

  lines.push("## BUSINESS FACTS");
  lines.push(`- ${STUDIO_BRAND.name} · ${STUDIO_BRAND.handle} · ${STUDIO_BRAND.website}`);
  lines.push(`- ${STUDIO_BRAND.address} · ${STUDIO_BRAND.phone}`);
  lines.push(`- ${STUDIO_BRAND.reputation} · ${STUDIO_BRAND.reviews} · ${STUDIO_BRAND.certification}`);
  lines.push(`- Services you may reference: ${ALLOWED_SERVICES.join(", ")}.`);
  lines.push(`- The ONLY approved price wording (use only when relevant): "${APPROVED_USED_TIRE_PRICE_LINE}"`);
  lines.push("");

  lines.push("## PROPRIETARY SHOP EVIDENCE");
  if (opts.proprietaryEvidence && opts.proprietaryEvidence.availability !== "unavailable") {
    const pe = opts.proprietaryEvidence;
    if (pe.localStats) {
      lines.push("- Cleveland Repair Stats:");
      lines.push(`  - Brake rust/seizure ratio: ${pe.localStats.brakeRustRatioPercent}% of inspected brakes show salt/seizure issues.`);
      lines.push(`  - Recent pothole/rim damage bookings: ${pe.localStats.potholeDamageCount} incidents recorded.`);
      lines.push(`  - Common vehicles serviced: ${pe.localStats.commonVehicles.join(", ")}.`);
      lines.push(`  - Average Cleveland vehicle mileage: ${pe.localStats.averageMileage.toLocaleString()} miles.`);
    }
    if (pe.clevelandAngle) {
      lines.push(`  - Cleveland Road Angle: ${pe.clevelandAngle}`);
    }
    if (pe.recentCaseStudy) {
      const cs = pe.recentCaseStudy;
      lines.push("- Real Anonymized Shop Case Study (Grounding Evidence):");
      lines.push(`  - Vehicle: ${cs.vehicle}`);
      lines.push(`  - Driver Symptom: ${cs.symptom}`);
      lines.push(`  - Failed Component: ${cs.failedComponent} (Condition: ${cs.condition.toUpperCase()})`);
      lines.push(`  - Tech Inspection Notes: ${cs.techNotes}`);
      lines.push(`  - Recommended Action: ${cs.recommendedAction}`);
    }
    if (pe.testimonials && pe.testimonials.length > 0) {
      lines.push("- Real Customer Testimonials & Reviews (Use for Social Proof):");
      for (const t of pe.testimonials) {
        lines.push(`  - ${t}`);
      }
    }
    if (pe.pastSocialOutputs && pe.pastSocialOutputs.length > 0) {
      lines.push("- Recently Posted Social Media Topics (AVOID repeating these exact angles/topics):");
      for (const p of pe.pastSocialOutputs) {
        lines.push(`  - [${p.contentType.toUpperCase()}] Topic: "${p.topic}" (Keyword: ${p.campaignKeyword || "none"})`);
      }
    }
    lines.push("- Instructions for LLM:");
    lines.push("  - You MUST dynamically ground the storyboard concept using this real evidence.");
    lines.push("  - Weave the Real Case Study vehicle, symptom, and inspection findings directly into the \"3 · The Clue\" slide outline.");
    lines.push("  - Incorporate the local Cleveland stats (e.g., brake rust ratio, pothole counts, or Cleveland average mileage) into the \"2 · Plain-English Truth\" slide or final caption copy to establish local shop authority.");
  } else {
    lines.push("STATUS: UNAVAILABLE");
    lines.push("- No local database evidence is currently available. Do not invent any statistics, testimonials, or vehicle cases. Ground your concepts in general, verified industry standard guidelines. If you cannot ground the claim in verified industry standards, output status \"needs_research\" and stop.");
  }
  lines.push("");

  lines.push("## HIDDEN PERSUASION LAYER");
  lines.push(
    "Subtle local proof, authority without bragging, demand without pressure. The reader should feel " +
      "\"that sounds like my car\" and \"this shop explains things clearly\" — never feel sold to.",
  );
  lines.push("Approved implied-proof phrasing (vary, don't copy verbatim every time):");
  for (const p of IMPLIED_PROOF_PHRASES) lines.push(`- ${p}`);
  lines.push("Never: \"everyone uses us\", \"you need this\", \"book now before it's too late\", or any obvious manipulation.");
  lines.push("");

  lines.push("## RESEARCH STANDARD");
  lines.push("Every brief must state: driver confusion · verified mechanic fact · source labels/URLs · Cleveland/seasonal relevance · save/share reason · what was avoided for repetition.");
  lines.push(`Proof sources: ${PROOF_SOURCE_FAMILIES.join(", ")}.`);
  lines.push("Reddit / Google autocomplete are PAIN-POINT discovery only — never cite them as proof.");
  lines.push("");

  lines.push("## CONCEPT IDEATION");
  lines.push(
    "Generate 10 distinct concepts. Each: hook, mechanic truth, driver emotion, campaign keyword, creative territory, " +
      "useful absurdity, local angle, 5-slide outline, save/share reason, boost reason, Nick-fit reason, non-generic reason, rejection risk.",
  );
  if (territory) lines.push(`Territory preference: ${territory.label} — ${territory.essence}`);
  lines.push(`Available territories: ${Object.values(CREATIVE_TERRITORIES).map((t) => t.label).join(" · ")}`);
  lines.push("");

  lines.push("## SCORING SYSTEM");
  lines.push(
    `Score each concept 0–10 on: hook, truth, save/share, local, useful absurdity, Nick-fit (max 60). ` +
      `Winning concept must score ≥ ${STUDIO_DEFAULTS.conceptMinScore}/60. Pick ONE winner and say why.`,
  );
  lines.push("");

  lines.push("## USEFUL ABSURDITY");
  lines.push("Absurdity is a TEACHING DEVICE (memory hook for the mechanic truth) — never random AI weirdness. If the absurd image doesn't teach the fact, cut it.");
  lines.push("");

  lines.push("## FIVE-SLIDE STRUCTURE");
  lines.push("Exactly five slides, in this order:");
  for (const s of SLIDE_ROLES) lines.push(`${s.label} — ${s.job}`);
  lines.push("");

  lines.push("## HIGGSFIELD PROMPT REQUIREMENTS");
  lines.push("- One image prompt per slide (5 total), 4:5 portrait, 1080×1350.");
  lines.push("- Consistent visual world across all 5 slides (same territory, palette, lighting).");
  lines.push("- Headline text is added as OVERLAY by the operator — prompts must request clean negative space, and AVOID baked-in text (AI-warped text is an automatic reject).");
  lines.push("- Each prompt states: scene, subject, mood, camera/composition, lighting, and the negative-space zone for the overlay.");
  lines.push("- Each prompt MUST include premium cinematic descriptors: 'award-winning, 85mm lens, shallow depth of field, ultra-detailed, 8K, studio-grade lighting, cinematic color grade, dramatic high contrast, photorealistic premium product photography, 35mm film grain texture, no AI artifacts, professional automotive photography'.");
  lines.push("");

  lines.push("## CAPTION REQUIREMENTS");
  lines.push("- 10 candidate hook first-lines; pick one.");
  lines.push("- Full caption: hook → 2–4 plain-English teaching lines → soft CTA with the campaign keyword (\"Comment or DM the keyword\") → business close (phone + address or site).");
  lines.push("- 3–12 hashtags, locally weighted (#cleveland #euclid + topic tags). No hashtag walls.");
  lines.push("");

  lines.push("## BOOST QUALITY GATE");
  lines.push(
    `Boost score is /75; minimum ${STUDIO_DEFAULTS.boostMinScore} to be boost-worthy. Components: sourced fact, exact 5-slide structure, one main idea, ` +
      "claim safety, no overdiagnosis, Cleveland angle, save/share reason, valid keyword, winning-concept score.",
  );
  lines.push("");

  lines.push("## LOGGING REQUIREMENTS");
  lines.push("Output a log block: date, topic, campaign keyword, territory, winning concept hook, boost score, sources used, what was avoided for repetition.");
  lines.push("");

  lines.push("## PUBLISHING SAFETY");
  lines.push("- NEVER post, schedule, or call any external service. Output is text for human review only.");
  lines.push("- Publishing is a manual human action after the checklist passes. Facebook cross-post stays OFF.");
  lines.push("");

  lines.push("## FORBIDDEN CLAIMS");
  for (const r of FORBIDDEN_CLAIM_PATTERNS) lines.push(`- ${r.rule}: ${r.fix}`);
  for (const r of OVERDIAGNOSIS_PATTERNS) lines.push(`- ${r.rule}: ${r.fix}`);
  lines.push(`Allowed soft diagnostic language: ${SOFT_DIAGNOSTIC_ALLOWED.join(" · ")}`);
  lines.push("");

  lines.push("## TODAY'S ASSIGNMENT");
  lines.push(`- Topic: ${opts.topicOverride?.trim() || "(choose from research — one main idea)"}`);
  lines.push(`- Campaign keyword: ${opts.keywordOverride?.trim().toUpperCase() || `(choose ONE from: ${CAMPAIGN_KEYWORDS.join(", ")})`}`);
  if (opts.seasonLocalAngle?.trim()) lines.push(`- Season/local angle: ${opts.seasonLocalAngle.trim()}`);
  if (opts.avoidTopics?.length) lines.push(`- AVOID topics (recently used): ${opts.avoidTopics.join("; ")}`);
  if (opts.avoidKeywords?.length) lines.push(`- AVOID keywords (recently used): ${opts.avoidKeywords.join(", ")}`);

  return lines.join("\n");
}

export function buildHiggsfieldPromptPack(brief: CarouselBrief): string {
  const out: string[] = [];
  out.push(`# HIGGSFIELD PROMPT PACK — ${brief.topic} [${brief.campaignKeyword}]`);
  out.push("");
  out.push("Output requirements (every image):");
  out.push("- 4:5 portrait · 1080×1350 px · consistent world across all 5 slides");
  out.push("- NO baked-in text or lettering of any kind (overlay added manually; AI text = reject)");
  out.push("- Leave clean negative space where noted for the headline overlay");
  out.push("- Quality keywords: award-winning, 85mm lens, shallow depth of field, ultra-detailed, 8K, studio-grade lighting, cinematic color grade, dramatic high contrast, photorealistic premium product photography, 35mm film grain texture, no AI artifacts, professional automotive photography");
  out.push("");
  brief.slides.forEach((s, i) => {
    out.push(`## Slide ${s.slideNumber} — ${SLIDE_ROLES[i]?.label ?? s.role}`);
    const basePrompt = s.visualPrompt.trim();
    const premiumSuffix = "award-winning, 85mm lens, shallow depth of field, ultra-detailed, 8K, studio-grade lighting, cinematic color grade, dramatic high contrast, photorealistic premium product photography, 35mm film grain texture, no AI artifacts, professional automotive photography.";
    const fullPrompt = basePrompt.endsWith(".") ? `${basePrompt} ${premiumSuffix}` : `${basePrompt}. ${premiumSuffix}`;
    out.push(fullPrompt);
    out.push(`Overlay plan: ${s.textOverlayPlan}`);
    out.push("");
  });
  out.push(`Typography plan: ${brief.typographyPlan}`);
  return out.join("\n");
}

export function buildCaptionBlock(brief: CarouselBrief): string {
  const tags = brief.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");
  return [
    brief.selectedCaption,
    "",
    `Comment or DM "${brief.campaignKeyword}" and we'll point you in the right direction.`,
    `${STUDIO_BRAND.name} · ${STUDIO_BRAND.address} · ${STUDIO_BRAND.phone}`,
    "",
    tags,
  ].join("\n");
}
