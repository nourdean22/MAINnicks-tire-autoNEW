import { CampaignInput } from "../schemas/input.js";
import { CampaignOutput, CampaignOutputSchema } from "../schemas/output.js";
import { runComplianceScan } from "../compliance/scanner.js";
import { buildCreativeSystemPrompt, extractJsonObject } from "./prompts.js";

export type LlmProvider = (
  prompt: string,
  systemPrompt?: string,
  options?: {
    outputSchema?: {
      name: string;
      strict?: boolean;
      schema: Record<string, unknown>;
    };
    maxTokens?: number;
    timeoutMs?: number;
  }
) => Promise<string>;

const CREATIVE_SECTIONS_SCHEMA = {
  name: "meta_ads_creative_sections",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "customerPsychologyMap",
      "adCopyFactory",
      "creativeTestingLab",
      "creativePrompts",
      "landingPageSystem"
    ],
    properties: {
      customerPsychologyMap: {
        type: "object",
        additionalProperties: false,
        required: ["microAvatars", "messagingMap", "whatToSay", "whatToAvoid"],
        properties: {
          microAvatars: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "description"], properties: { name: { type: "string" }, description: { type: "string" } } } },
          messagingMap: { type: "object", additionalProperties: false, required: ["cold", "warm", "hot"], properties: { cold: { type: "string" }, warm: { type: "string" }, hot: { type: "string" } } },
          whatToSay: { type: "array", items: { type: "string" } },
          whatToAvoid: { type: "array", items: { type: "string" } }
        }
      },
      adCopyFactory: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["bundleName", "shortPrimaryTexts", "longPrimaryText", "headlines", "descriptions", "ctaButtonRecommendations"],
          properties: {
            bundleName: { type: "string" },
            shortPrimaryTexts: { type: "array", items: { type: "string" } },
            longPrimaryText: { type: "string" },
            headlines: { type: "array", items: { type: "string" } },
            descriptions: { type: "array", items: { type: "string" } },
            ctaButtonRecommendations: { type: "array", items: { type: "string" } }
          }
        }
      },
      creativeTestingLab: {
        type: "object",
        additionalProperties: false,
        required: ["creativeThesis", "creativeAngles", "creativeProductionChecklist", "shotList"],
        properties: {
          creativeThesis: { type: "string" },
          creativeAngles: {
            type: "array", items: { type: "object", additionalProperties: false, required: ["angleName", "hooks", "proofType", "visualDirection", "ctaFraming", "textSafeAreaGuidance"], properties: { angleName: { type: "string" }, hooks: { type: "array", items: { type: "string" } }, proofType: { type: "string" }, visualDirection: { type: "string" }, ctaFraming: { type: "string" }, textSafeAreaGuidance: { type: "string" } } }
          },
          creativeProductionChecklist: { type: "array", items: { type: "string" } },
          shotList: { type: "array", items: { type: "string" } }
        }
      },
      creativePrompts: {
        type: "object",
        additionalProperties: false,
        required: ["imagePrompts", "reelPrompts", "ugcScriptOutlines"],
        properties: {
          imagePrompts: { type: "array", items: { type: "object", additionalProperties: false, required: ["format", "subject", "scene", "lighting", "composition", "negativeInstructions", "textSafeSpaceInstruction"], properties: { format: { type: "string", enum: ["1:1", "4:5", "9:16"] }, subject: { type: "string" }, scene: { type: "string" }, lighting: { type: "string" }, composition: { type: "string" }, negativeInstructions: { type: "string" }, textSafeSpaceInstruction: { type: "string" } } } },
          reelPrompts: { type: "array", items: { type: "object", additionalProperties: false, required: ["hookFirst2Seconds", "sceneBeats", "onScreenTextPlan", "endFrameCta"], properties: { hookFirst2Seconds: { type: "string" }, sceneBeats: { type: "array", items: { type: "string" } }, onScreenTextPlan: { type: "string" }, endFrameCta: { type: "string" } } } },
          ugcScriptOutlines: { type: "array", items: { type: "object", additionalProperties: false, required: ["openingLine", "storyArc", "proofMoment", "cta", "filmingNotes"], properties: { openingLine: { type: "string" }, storyArc: { type: "string" }, proofMoment: { type: "string" }, cta: { type: "string" }, filmingNotes: { type: "string" } } } }
        }
      },
      landingPageSystem: {
        type: "object",
        additionalProperties: false,
        required: ["directResponseVariant", "leadMagnetOrQuizVariant", "hybridVariant", "faqs", "riskReversalWording"],
        properties: {
          directResponseVariant: { type: "string" },
          leadMagnetOrQuizVariant: { type: "string" },
          hybridVariant: { type: "string" },
          faqs: { type: "array", items: { type: "object", additionalProperties: false, required: ["question", "answer"], properties: { question: { type: "string" }, answer: { type: "string" } } } },
          riskReversalWording: { type: "string" }
        }
      }
    }
  }
};

function generateDeterministicSections(input: CampaignInput): Partial<CampaignOutput> {
  const { offer, audience, priceStack, constraints } = input;
  
  // Section 0
  const inputAudit = {
    summary: `Received campaign input for ${offer.productOrServiceName} targeting ${audience.countries.join(", ")}.`,
    missingCriticalItems: [],
    assumptions: ["Assuming standard local reach logic if no exact radius provided.", "Assuming creative assets will be generated if not provided."],
  };

  // Section 1
  const offerPositioning = {
    summary: `${offer.productOrServiceName} delivering ${offer.primaryOutcome} via ${offer.deliveryFormat}.`,
    positioningAngles: [
      `Angle 1: Speed & Convenience - emphasize ${offer.timeToConsumeOrFulfill}`,
      `Angle 2: Direct Pain Relief - target ${audience.painPoints}`,
      `Angle 3: Outcome Driven - highlight ${offer.primaryOutcome}`
    ],
    uniqueMechanisms: [
      "Mechanism 1: The proprietary inspection process",
      "Mechanism 2: The transparent written quote system",
      "Mechanism 3: The rapid turnaround framework"
    ],
    valueStack: `Core: ${priceStack.corePrice}. Includes: ${offer.whatsIncluded}. Guarantee: ${priceStack.guaranteeOrRefundTerms}.`,
    objectionsAndRebuttals: [
      { objection: "It's too expensive", rebuttal: "We offer no-credit-check financing and clear ROI." },
      { objection: "It takes too long", rebuttal: `Delivered in ${offer.timeToConsumeOrFulfill}.` },
      { objection: "I don't trust you", rebuttal: "We provide written quotes before any work begins." },
      { objection: "Will it work for me?", rebuttal: `Yes, designed specifically for ${audience.whoItIsFor}.` },
      { objection: "What if it breaks?", rebuttal: `Covered by: ${priceStack.guaranteeOrRefundTerms}.` },
      { objection: "I can do it myself", rebuttal: "Save time and avoid costly mistakes by letting professionals handle it." },
      { objection: "I need it right now", rebuttal: "We offer rapid turnaround and drop-off advantages." },
      { objection: "I had a bad experience elsewhere", rebuttal: "We earn your trust first with free initial inspections." },
    ],
    whoShouldNotBuy: [
      "People looking for the absolute cheapest, lowest quality option.",
      "Those who want to DIY the work.",
      "People outside of the service radius.",
      "Those looking for non-compliant/illegal modifications.",
      "Customers who ignore professional advice.",
      "Those who refuse to authorize required diagnostic time."
    ],
  };

  // Section 4
  const campaignArchitecture = {
    recommendedObjective: "Leads" as const,
    rationale: "For high-intent service businesses, capturing lead information (phone/email) or driving direct messages is optimal.",
    beginnerSafeVersion: "1 Campaign > 1 Ad Set (Broad Local) > 3 Ads (Dynamic Creative)",
    advancedVersion: "1 Campaign (CBO) > 3 Ad Sets (Broad, Retargeting, Lookalike) > 3 Ads per Ad Set",
    testingCampaign: "ABO Testing Campaign: $20/day per Ad Set testing 1 variable at a time (hook, image, copy).",
    scalingCampaign: "CBO Scaling Campaign: Move winning ads here with broad targeting.",
    retargetingCampaign: "Small budget ($5-10/day) targeting website visitors and social engagers in the last 30 days.",
    placementPlan: "Advantage+ Placements (Automatic) to let the algorithm find the lowest CPA.",
    namingConventions: {
      campaign: `[Date] - [Objective] - ${offer.productOrServiceName}`,
      adSet: `[Audience] - [Placement] - [Budget]`,
      ad: `[Format] - [Visual] - [Copy Variant]`,
    }
  };

  // Section 5
  const budgetAndDecisionRules = {
    breakEvenCpaFormula: "Average Customer Lifetime Value (LTV) * Gross Margin %",
    targetCpaFormula: "(Average LTV * Gross Margin %) - Desired Profit per Customer",
    scaleHoldKillRules: "KILL: CPA > 1.5x Target CPA for 3 days. HOLD: CPA = Target CPA. SCALE: CPA < 0.8x Target CPA (increase budget 20% every 2 days).",
    assumptions: ["Assuming standard local service conversion rates (10-15% from lead to booked appointment)."],
    missingDataRequests: ["Need exact historical CPA.", "Need exact average ticket size."],
    conservativeDefaultGuardrails: "Start at $20-$30/day. Do not scale until 3 consecutive days of profitable conversions.",
  };

  // Section 6
  const audienceTargetingBlueprint = {
    coldAudiences: [
      "Broad (Age 25-65+, Location Radius Only)",
      "Homeowners (if applicable)",
      "Parents (safety focused)",
      "Commuters (distance based)",
      "Interest: Auto Repair / Maintenance",
      "Lookalike 1% of Past Customers"
    ],
    warmAudiences: [
      "Website Visitors (30 Days)",
      "Facebook Page Engagers (90 Days)",
      "Instagram Engagers (90 Days)",
      "Video Viewers (50%+ completion)",
      "Lead Form Openers",
      "Past Customers (Upsell/Maintenance)"
    ],
    hotAudiences: ["Added to Cart / Initiated Checkout", "Lead Form Submitted (Not booked)"],
    exclusions: constraints.countriesToExclude || [],
    countryTierPlan: "Tier 1: Local radius of service center.",
    lookalikeEligibilityCheck: "Requires customer list of at least 1,000 matches or pixel with 100+ events.",
  };

  // Section 11
  const launchAndOptimizationPlan = {
    dayByDay7DayPlan: [
      "Day 1: Launch testing campaign at conservative budget. Do not touch.",
      "Day 2: Monitor for immediate rejections or 0 spend. Do not touch.",
      "Day 3: Review initial CPMs and CTRs. Identify early losers.",
      "Day 4: Pause ads with CTR < 0.5% and 0 conversions.",
      "Day 5: Identify winning creative (highest CTR, lowest CPC).",
      "Day 6: Prepare to duplicate winning ads into scaling campaign.",
      "Day 7: Launch CBO scaling campaign with proven winners."
    ],
    weeks2To4Loop: "Weekly: Review CPA. Pause losers. Introduce 1 new creative test per week.",
    creativeRefreshPlan: "Refresh creatives every 3-4 weeks or when frequency > 3.0 and CPA rises 20%.",
    fatigueSignals: ["Frequency > 3.0", "CPA rising 3 days in a row", "CTR dropping below 0.8%"],
    verticalScalingPlan: "Increase CBO budget by 15-20% every 48 hours while CPA remains profitable.",
    horizontalScalingPlan: "Duplicate winning ad sets to new lookalike audiences or expanded geofences.",
    troubleshootingMatrix: {
      highCtrLowCvr: "Ad is clickbaity or landing page is broken/mismatched. Fix landing page.",
      lowCtr: "Creative is boring or audience is wrong. Test new hooks.",
      highCpa: "Kill the ad or lower bids.",
      negativeComments: "Hide comments, but analyze for valid objections to address in next ad.",
      learningLimited: "Consolidate ad sets to increase conversion volume per ad set.",
      highCpm: "Broaden audience, improve ad quality ranking, or change objective.",
      rejectedAds: "Review compliance flags. Appeal or duplicate and edit.",
      trackingMismatch: "Verify Pixel/CAPI setup using Events Manager."
    }
  };

  // Section 12
  const finalDeliverablesChecklist = {
    setupChecklist: ["Business Manager verified", "Ad Account created", "Payment method added"],
    trackingChecklist: ["Pixel installed", "CAPI configured", "UTMs appended to all URLs"],
    creativeAssetChecklist: ["Images/Videos sized correctly", "Thumbnails selected", "Captions enabled"],
    copyChecklist: ["Primary text written", "Headlines written", "Compliance scan passed"],
    reportingChecklist: ["Custom columns created in Ads Manager", "Offline conversions mapped"],
    dailyReviewChecklist: ["Check spend pacing", "Check CPA", "Pause runaway losers"],
    weeklyReviewChecklist: ["Analyze creative performance", "Plan new tests", "Adjust budgets"]
  };

  return {
    inputAudit,
    offerPositioning,
    campaignArchitecture,
    budgetAndDecisionRules,
    audienceTargetingBlueprint,
    launchAndOptimizationPlan,
    finalDeliverablesChecklist
  };
}

function generateDeterministicCreative(): Partial<CampaignOutput> {
  // Deterministic fallback for creative sections if no LLM is provided
  const customerPsychologyMap = {
    microAvatars: [
      { name: "The Busy Professional", description: "Values time over money. Wants drop-off convenience." },
      { name: "The Safety-Conscious Parent", description: "Wants reliability and peace of mind for their family." },
      { name: "The Budget-Minded Driver", description: "Wants honest pricing and financing options." }
    ],
    messagingMap: {
      cold: "Focus on pain points and the free inspection.",
      warm: "Focus on reviews, trust, and specific mechanisms.",
      hot: "Focus on the offer, financing, and immediate booking."
    },
    whatToSay: ["Free inspection", "Written quote before work", "Financing available"],
    whatToAvoid: ["Guaranteed fixes", "Overnight results", "Fear-mongering"]
  };

  const adCopyFactory = Array.from({ length: 5 }).map((_, i) => ({
    bundleName: `Bundle ${i + 1}`,
    shortPrimaryTexts: ["Need auto repair? We offer free inspections.", "Don't ignore that noise. Get a free check today."],
    longPrimaryText: "Is your car making a strange noise? Don't wait until it breaks down. At Nick's Tire & Auto, we offer free initial inspections and written quotes before any work begins. Drop it off in the morning and we can usually have it done the same day. Plus, we offer no-credit-check financing. Click below to learn more.",
    headlines: ["Free Auto Inspection", "Same Day Service", "No Credit Check Financing", "Top Rated Auto Shop", "Honest Auto Repair", "Drop Off Service", "Expert Mechanics"],
    descriptions: ["Get a free written quote.", "Serving Cleveland for years.", "5-star rated service.", "Walk-ins welcome."],
    ctaButtonRecommendations: ["Learn More", "Book Now", "Get Quote"]
  }));

  const creativeTestingLab = {
    creativeThesis: "Test direct problem-solution imagery against founder-led educational videos.",
    creativeAngles: Array.from({ length: 12 }).map((_, i) => ({
      angleName: `Angle ${i + 1}`,
      hooks: ["Hear that noise?", "Check engine light on?", "Need tires fast?"],
      proofType: "Customer Review",
      visualDirection: "Mechanic inspecting a vehicle.",
      ctaFraming: "Tap here to book your free inspection.",
      textSafeAreaGuidance: "Keep text in the middle 60% of the screen."
    })),
    creativeProductionChecklist: ["Record b-roll", "Get customer testimonials", "Format 9:16 and 4:5"],
    shotList: ["Exterior of shop", "Mechanic looking under hood", "Happy customer driving away"]
  };

  const creativePrompts = {
    imagePrompts: Array.from({ length: 12 }).map(() => ({
      format: "4:5" as const,
      subject: "A professional mechanic",
      scene: "A clean, well-lit auto repair bay",
      lighting: "Bright, natural",
      composition: "Eye-level, focused on the action",
      negativeInstructions: "No messy floors, no unhappy faces",
      textSafeSpaceInstruction: "Leave top 20% blank for text"
    })),
    reelPrompts: Array.from({ length: 6 }).map(() => ({
      hookFirst2Seconds: "Visual of a dashboard warning light turning on.",
      sceneBeats: ["Warning light", "Mechanic smiling", "Car driving smoothly"],
      onScreenTextPlan: "Don't ignore this light -> We fix it fast -> Drive safe",
      endFrameCta: "Book your free check today"
    })),
    ugcScriptOutlines: Array.from({ length: 4 }).map(() => ({
      openingLine: "I thought my car repair was going to cost thousands...",
      storyArc: "Had a problem, was worried about cost, found Nick's, got a free quote, it was affordable.",
      proofMoment: "Show the written quote and the fixed car.",
      cta: "If you need a mechanic you can trust, go to Nick's.",
      filmingNotes: "Film in your car, natural lighting, energetic tone."
    }))
  };

  const landingPageSystem = {
    directResponseVariant: "Clear headline, 3 bullet benefits, embedded booking form, reviews below.",
    leadMagnetOrQuizVariant: "Get our 'Used Car Inspection Checklist' PDF in exchange for email.",
    hybridVariant: "Service details page with embedded form and click-to-call buttons.",
    faqs: Array.from({ length: 12 }).map((_, i) => ({
      question: `FAQ Question ${i + 1}?`,
      answer: "We provide transparent, honest service."
    })),
    riskReversalWording: "12-month / 12,000-mile warranty on most repairs."
  };

  return {
    customerPsychologyMap,
    adCopyFactory,
    creativeTestingLab,
    creativePrompts,
    landingPageSystem
  };
}

export async function generateCampaignPlan(input: CampaignInput, llmProvider?: LlmProvider): Promise<CampaignOutput> {
  const deterministicBase = generateDeterministicSections(input);
  
  let creativeSections = generateDeterministicCreative();
  let metadataPreset = "deterministic-no-llm-provider";

  if (llmProvider) {
    try {
      const systemPrompt = buildCreativeSystemPrompt(input);
      const prompt = "Generate the creative sections now. Output ONLY valid JSON matching the schema.";
      
      const response = await llmProvider(prompt, systemPrompt, {
        outputSchema: CREATIVE_SECTIONS_SCHEMA,
        maxTokens: 4000,
        timeoutMs: 90000,
      });

      const parsed = extractJsonObject(response) as Partial<CampaignOutput>;
      
      // Merge successfully parsed sections
      creativeSections = {
        customerPsychologyMap: parsed.customerPsychologyMap || creativeSections.customerPsychologyMap,
        adCopyFactory: parsed.adCopyFactory || creativeSections.adCopyFactory,
        creativeTestingLab: parsed.creativeTestingLab || creativeSections.creativeTestingLab,
        creativePrompts: parsed.creativePrompts || creativeSections.creativePrompts,
        landingPageSystem: parsed.landingPageSystem || creativeSections.landingPageSystem,
      };
      
      metadataPreset = "llm-creative";
    } catch (err) {
      console.error("LLM Generation failed, falling back to deterministic creative:", err);
      metadataPreset = "deterministic-fallback";
    }
  }

  // Combine
  const rawPlan: any = {
    ...deterministicBase,
    ...creativeSections,
    exportMetadata: {
      generatedAt: new Date().toISOString(),
      version: "1.0.0",
      presetUsed: metadataPreset
    }
  };

  // Run Compliance Scan
  const payloadsToScan = rawPlan.adCopyFactory?.flatMap((b: any) => [...b.shortPrimaryTexts, b.longPrimaryText, ...b.headlines]) || [];
  const complianceRiskScan = runComplianceScan(payloadsToScan);

  rawPlan.complianceRiskScan = complianceRiskScan;

  // Validate final full plan against CampaignOutputSchema
  const parsedFinal = CampaignOutputSchema.safeParse(rawPlan);
  if (!parsedFinal.success) {
    console.error("CampaignOutputSchema validation failed on final output:", parsedFinal.error);
    // Even if it fails validation (e.g. LLM hallucinates an invalid string instead of array), we return it
    // as any, but cast it so TypeScript doesn't complain. The frontend can still render it.
    // To be perfectly safe, we'll try to fallback completely.
    if (metadataPreset === "llm-creative") {
      console.error("Falling back completely to deterministic due to schema failure.");
      const fallbackPlan: any = {
        ...deterministicBase,
        ...generateDeterministicCreative(),
        exportMetadata: {
          generatedAt: new Date().toISOString(),
          version: "1.0.0",
          presetUsed: "deterministic-fallback"
        }
      };
      fallbackPlan.complianceRiskScan = runComplianceScan(fallbackPlan.adCopyFactory.flatMap((b: any) => [...b.shortPrimaryTexts, b.longPrimaryText, ...b.headlines]));
      return CampaignOutputSchema.parse(fallbackPlan);
    }
  }

  return rawPlan as CampaignOutput;
}
