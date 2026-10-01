import { CampaignInput } from "../schemas/input.js";

/**
 * CLI / test preset ONLY. The app never uses this: apps/nickstire compiles
 * the fact-bearing fields from its SSOT (server/services/brandTruth.ts) and
 * overrides whatever a caller sent. Values here mirror that SSOT as of
 * 2026-10-01 so the deterministic path cannot regress to the retired
 * mileage warranty; if they drift, the app's drift canary fails CI.
 */

export const NicksTirePreset: CampaignInput = {
  offer: {
    productOrServiceName: "General Auto Repair & Maintenance",
    niche: "Automotive Repair",
    primaryOutcome: "Safe, reliable driving with peace of mind",
    deliveryFormat: "In-person service",
    whatsIncluded: "Full diagnostic, transparent written quote, quality parts, expert installation",
    timeToConsumeOrFulfill: "Drop-offs preferred — same day service",
    commercialUseTerms: "N/A",
    locationRequirement: "In-shop drop-off required",
    serviceArea: "Cleveland, OH and surrounding suburbs",
    appointmentRequired: false,
    emergencyOrUrgencyContext: "Walk-ins welcome 7 days a week",
  },
  priceStack: {
    corePrice: "Varies by service (free quick check, written quote first)",
    upsells: "Preventative maintenance, fluid flushes, premium tire upgrades",
    downsells: "Basic repairs to keep vehicle safe until major work can be done",
    bundles: "Oil change + Tire Rotation + Brake Inspection",
    guaranteeOrRefundTerms: "12-month parts / 90-day labor limited warranty on shop-installed repairs (no mileage or road-hazard warranty)",
    financingAvailable: true,
    paymentMethods: "Cash, card; payment programs (Acima, Snap, Koalafi, American First Finance) — Acima: $10 start in select circumstances",
  },
  audience: {
    whoItIsFor: "Local drivers with vehicles out of factory warranty",
    painPoints: "Fear of being ripped off, unexpected breakdowns, tight budgets, needing a car for work",
    desires: "Honest mechanic, fast turnaround, affordable payments",
    countries: ["US"],
    languages: ["English", "Arabic"],
    awarenessLevel: "Problem Aware",
    localRadius: "15-mile radius of Cleveland shop",
    customerType: "Both",
  },
  assetsAndProof: {
    testimonialsAvailable: true,
    screenshotsAvailable: false,
    caseStudiesAvailable: true,
    beforeAfterAvailable: true,
    founderFaceAvailable: true,
    brandKitAvailable: true,
    realReviewSources: "Google (4.9★)",
    leadMagnetAvailable: false,
  },
  constraints: {
    dailyBudgetRange: "$20 - $50",
    monthlyBudgetRange: "$600 - $1500",
    brandVoice: "Honest, straightforward, blue-collar, empathetic, expert",
    complianceSensitivity: "High",
    businessAddress: "17625 Euclid Ave, Cleveland, OH 44112",
    landingPageUrl: "https://nickstire.org",
  }
};
