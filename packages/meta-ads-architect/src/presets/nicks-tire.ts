import { CampaignInput } from "../schemas/input.js";

export const NicksTirePreset: CampaignInput = {
  offer: {
    productOrServiceName: "General Auto Repair & Maintenance",
    niche: "Automotive Repair",
    primaryOutcome: "Safe, reliable driving with peace of mind",
    deliveryFormat: "In-person service",
    whatsIncluded: "Full diagnostic, transparent written quote, quality parts, expert installation",
    timeToConsumeOrFulfill: "Usually same day or next day",
    commercialUseTerms: "N/A",
    locationRequirement: "In-shop drop-off required",
    serviceArea: "Cleveland, OH and surrounding suburbs",
    appointmentRequired: false,
    emergencyOrUrgencyContext: "Available for urgent breakdowns and tows",
  },
  priceStack: {
    corePrice: "Varies by service (Free initial inspection)",
    upsells: "Preventative maintenance, fluid flushes, premium tire upgrades",
    downsells: "Basic repairs to keep vehicle safe until major work can be done",
    bundles: "Oil change + Tire Rotation + Brake Inspection",
    guaranteeOrRefundTerms: "12-month / 12,000-mile warranty on most repairs",
    financingAvailable: true,
    paymentMethods: "Cash, Credit Card, Snap Finance",
  },
  audience: {
    whoItIsFor: "Local drivers with vehicles out of factory warranty",
    painPoints: "Fear of being ripped off, unexpected breakdowns, tight budgets, needing a car for work",
    desires: "Honest mechanic, fast turnaround, affordable payments",
    countries: ["US"],
    languages: ["English", "Spanish"],
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
    realReviewSources: "Google Reviews, Yelp",
    leadMagnetAvailable: false,
  },
  constraints: {
    dailyBudgetRange: "$20 - $50",
    monthlyBudgetRange: "$600 - $1500",
    brandVoice: "Honest, straightforward, blue-collar, empathetic, expert",
    complianceSensitivity: "High",
    businessAddress: "Cleveland, OH",
    landingPageUrl: "https://nickstire.org",
  }
};
