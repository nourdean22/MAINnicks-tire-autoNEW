import { z } from "zod";

export const CampaignOutputSchema = z.object({
  inputAudit: z.object({
    summary: z.string(),
    missingCriticalItems: z.array(z.string()),
    assumptions: z.array(z.string()),
  }),
  offerPositioning: z.object({
    summary: z.string(),
    positioningAngles: z.array(z.string()).length(3),
    uniqueMechanisms: z.array(z.string()).length(3),
    valueStack: z.string(),
    objectionsAndRebuttals: z.array(
      z.object({ objection: z.string(), rebuttal: z.string() })
    ).min(8),
    whoShouldNotBuy: z.array(z.string()).min(6),
  }),
  customerPsychologyMap: z.object({
    microAvatars: z.array(
      z.object({ name: z.string(), description: z.string() })
    ).length(3),
    messagingMap: z.object({
      cold: z.string(),
      warm: z.string(),
      hot: z.string(),
    }),
    whatToSay: z.array(z.string()),
    whatToAvoid: z.array(z.string()),
  }),
  complianceRiskScan: z.object({
    riskLevel: z.enum(["low", "medium", "high"]),
    riskFlags: z.array(z.string()),
    safePhrasingSwaps: z.array(
      z.object({ unsafe: z.string(), safe: z.string() })
    ).min(15),
    prohibitedClaimChecklist: z.array(z.string()),
    finalComplianceNotes: z.string(),
  }),
  campaignArchitecture: z.object({
    recommendedObjective: z.enum(["Awareness", "Traffic", "Engagement", "Leads", "Sales", "App Promotion"]),
    rationale: z.string(),
    beginnerSafeVersion: z.string(),
    advancedVersion: z.string(),
    testingCampaign: z.string(),
    scalingCampaign: z.string(),
    retargetingCampaign: z.string(),
    placementPlan: z.string(),
    namingConventions: z.object({
      campaign: z.string(),
      adSet: z.string(),
      ad: z.string(),
    }),
  }),
  budgetAndDecisionRules: z.object({
    breakEvenCpaFormula: z.string().optional(),
    targetCpaFormula: z.string().optional(),
    breakEvenRoasFormula: z.string().optional(),
    targetRoasFormula: z.string().optional(),
    scaleHoldKillRules: z.string(),
    assumptions: z.array(z.string()),
    missingDataRequests: z.array(z.string()),
    conservativeDefaultGuardrails: z.string(),
  }),
  audienceTargetingBlueprint: z.object({
    coldAudiences: z.array(z.string()).min(6),
    warmAudiences: z.array(z.string()).min(6),
    hotAudiences: z.array(z.string()),
    exclusions: z.array(z.string()),
    countryTierPlan: z.string(),
    localTargetingLogic: z.string().optional(),
    lookalikeEligibilityCheck: z.string(),
  }),
  creativeTestingLab: z.object({
    creativeThesis: z.string(),
    creativeAngles: z.array(
      z.object({
        angleName: z.string(),
        hooks: z.array(z.string()).length(3),
        proofType: z.string(),
        visualDirection: z.string(),
        ctaFraming: z.string(),
        textSafeAreaGuidance: z.string(),
      })
    ).length(12),
    creativeProductionChecklist: z.array(z.string()),
    shotList: z.array(z.string()),
  }),
  adCopyFactory: z.array(
    z.object({
      bundleName: z.string(),
      shortPrimaryTexts: z.array(z.string()).length(2),
      longPrimaryText: z.string(),
      headlines: z.array(z.string()).length(7),
      descriptions: z.array(z.string()).length(4),
      ctaButtonRecommendations: z.array(z.string()),
    })
  ).length(5),
  creativePrompts: z.object({
    imagePrompts: z.array(
      z.object({
        format: z.enum(["1:1", "4:5", "9:16"]),
        subject: z.string(),
        scene: z.string(),
        lighting: z.string(),
        composition: z.string(),
        negativeInstructions: z.string(),
        textSafeSpaceInstruction: z.string(),
      })
    ).length(12),
    reelPrompts: z.array(
      z.object({
        hookFirst2Seconds: z.string(),
        sceneBeats: z.array(z.string()),
        onScreenTextPlan: z.string(),
        endFrameCta: z.string(),
      })
    ).length(6),
    ugcScriptOutlines: z.array(
      z.object({
        openingLine: z.string(),
        storyArc: z.string(),
        proofMoment: z.string(),
        cta: z.string(),
        filmingNotes: z.string(),
      })
    ).length(4),
  }),
  landingPageSystem: z.object({
    directResponseVariant: z.string(),
    leadMagnetOrQuizVariant: z.string(),
    hybridVariant: z.string(),
    faqs: z.array(
      z.object({ question: z.string(), answer: z.string() })
    ).min(12),
    riskReversalWording: z.string(),
  }),
  launchAndOptimizationPlan: z.object({
    dayByDay7DayPlan: z.array(z.string()).length(7),
    weeks2To4Loop: z.string(),
    creativeRefreshPlan: z.string(),
    fatigueSignals: z.array(z.string()),
    verticalScalingPlan: z.string(),
    horizontalScalingPlan: z.string(),
    troubleshootingMatrix: z.object({
      highCtrLowCvr: z.string(),
      lowCtr: z.string(),
      highCpa: z.string(),
      negativeComments: z.string(),
      learningLimited: z.string(),
      highCpm: z.string(),
      rejectedAds: z.string(),
      trackingMismatch: z.string(),
    }),
  }),
  finalDeliverablesChecklist: z.object({
    setupChecklist: z.array(z.string()),
    trackingChecklist: z.array(z.string()),
    creativeAssetChecklist: z.array(z.string()),
    copyChecklist: z.array(z.string()),
    reportingChecklist: z.array(z.string()),
    dailyReviewChecklist: z.array(z.string()),
    weeklyReviewChecklist: z.array(z.string()),
  }),
  exportMetadata: z.object({
    generatedAt: z.string(),
    version: z.string(),
    presetUsed: z.string().optional(),
  }),
});

export type CampaignOutput = z.infer<typeof CampaignOutputSchema>;
