/**
 * Customer Segmentation — Auto-classify customers for targeted marketing
 * Segments: vip, loyal, growing, one-timer, at-risk, churned, fleet, new, referrer
 */

import { createLogger } from "../lib/logger";
const log = createLogger("segmentation");

export type CustomerSegment = "vip" | "loyal" | "growing" | "one-timer" | "at-risk" | "churned" | "fleet" | "new" | "referrer" | "price-sensitive";

interface SegmentResult {
  segment: CustomerSegment;
  score: number; // 0-100
  recommendedAction: string;
}

export function segmentCustomer(params: {
  totalSpend: number;
  visitCount: number;
  daysSinceLastVisit: number;
  daysSinceFirstVisit: number;
  referralCount: number;
  reviewCount: number;
  vehicleCount: number;
  declineRate: number; // 0-1
}): SegmentResult {
  const { totalSpend, visitCount, daysSinceLastVisit, daysSinceFirstVisit, referralCount, reviewCount, vehicleCount, declineRate } = params;

  // Fleet detection
  if (vehicleCount >= 3 || (visitCount >= 6 && totalSpend >= 3000)) {
    return { segment: "fleet", score: 95, recommendedAction: "Offer fleet pricing. Priority scheduling. Account manager." };
  }

  // New customer (first visit within 30 days)
  if (daysSinceFirstVisit <= 30 && visitCount <= 1) {
    return { segment: "new", score: 40, recommendedAction: "Welcome drip campaign. Referral offer. Follow up in 7 days." };
  }

  // Referrer (has referred 2+ customers)
  if (referralCount >= 2) {
    return { segment: "referrer", score: 90, recommendedAction: "Referral bonus. Feature in testimonials. VIP treatment." };
  }

  // VIP (high spend + frequent + reviewed)
  if (totalSpend >= 2000 && visitCount >= 4 && reviewCount >= 1) {
    return { segment: "vip", score: 95, recommendedAction: "VIP treatment. Priority scheduling. Exclusive offers." };
  }

  // Loyal (3+ visits/year, active)
  if (visitCount >= 3 && daysSinceLastVisit <= 180) {
    return { segment: "loyal", score: 75, recommendedAction: "Maintenance reminders. Ask for review if none yet." };
  }

  // Growing (2 visits, still engaged)
  if (visitCount === 2 && daysSinceLastVisit <= 180) {
    return { segment: "growing", score: 55, recommendedAction: "Loyalty incentive for 3rd visit. Educational content." };
  }

  // Price-sensitive (high decline rate)
  if (declineRate > 0.5 && visitCount >= 2) {
    return { segment: "price-sensitive", score: 35, recommendedAction: "Value packages. Financing options. Coupons." };
  }

  // At-risk (was active, fading)
  if (visitCount >= 2 && daysSinceLastVisit > 180 && daysSinceLastVisit <= 365) {
    return { segment: "at-risk", score: 40, recommendedAction: "Win-back campaign. Personal call. Special offer." };
  }

  // Churned (12+ months inactive)
  if (visitCount >= 1 && daysSinceLastVisit > 365) {
    return { segment: "churned", score: 15, recommendedAction: "Win-back campaign. 3 attempts then archive." };
  }

  // One-timer (single visit, gone 90+ days)
  if (visitCount === 1 && daysSinceLastVisit > 90) {
    return { segment: "one-timer", score: 20, recommendedAction: "Re-engagement offer. Survey why they haven't returned." };
  }

  return { segment: "growing", score: 50, recommendedAction: "Standard engagement. Continue nurture." };
}

/** Get segment display info */
export function getSegmentInfo(segment: CustomerSegment): { label: string; color: string; icon: string } {
  const INFO: Record<CustomerSegment, { label: string; color: string; icon: string }> = {
    vip: { label: "VIP", color: "#FDB913", icon: "crown" },
    loyal: { label: "Loyal", color: "#27AE60", icon: "heart" },
    growing: { label: "Growing", color: "#1E4D8C", icon: "trending-up" },
    "one-timer": { label: "One-Timer", color: "#8B949E", icon: "user" },
    "at-risk": { label: "At Risk", color: "#FF9800", icon: "alert-triangle" },
    churned: { label: "Churned", color: "#FF3B30", icon: "user-x" },
    fleet: { label: "Fleet", color: "#1E4D8C", icon: "truck" },
    new: { label: "New", color: "#27AE60", icon: "star" },
    referrer: { label: "Referrer", color: "#FDB913", icon: "users" },
    "price-sensitive": { label: "Price-Sensitive", color: "#FF9800", icon: "dollar-sign" },
  };
  return INFO[segment];
}
