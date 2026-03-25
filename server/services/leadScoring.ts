/**
 * Lead Scoring Engine — Scores incoming leads 0-100
 * Factors: service value, urgency, geography, vehicle, source, message detail
 */

import { createLogger } from "../lib/logger";

const log = createLogger("lead-scoring");

interface LeadData {
  serviceNeeded?: string;
  vehicleInfo?: string;
  message?: string;
  source?: string;
  zipCode?: string;
  formType?: string;
}

// Primary service area (Euclid, East Cleveland, South Euclid)
const PRIMARY_ZIPS = ["44112", "44110", "44117", "44118", "44119", "44106", "44108", "44103", "44123", "44092", "44143"];
// Secondary (wider Cleveland metro)
const SECONDARY_ZIPS = ["44107", "44102", "44111", "44109", "44113", "44114", "44115", "44120", "44121", "44122", "44124", "44125", "44126", "44128", "44129", "44130", "44131", "44132", "44134", "44136", "44137", "44139", "44141", "44142", "44144", "44146"];

const HIGH_VALUE = ["transmission", "engine", "suspension", "ac repair", "air conditioning", "timing belt", "head gasket"];
const MEDIUM_VALUE = ["brakes", "brake", "tires", "tire", "alignment", "diagnostic", "check engine"];
const URGENT_KEYWORDS = ["asap", "urgent", "emergency", "today", "now", "broke down", "won't start", "overheating", "leaking", "smoking", "tow", "flat"];

export function scoreLead(data: LeadData): { score: number; priority: "low" | "medium" | "high" | "urgent"; factors: string[] } {
  let score = 50;
  const factors: string[] = [];

  const text = `${data.serviceNeeded || ""} ${data.message || ""}`.toLowerCase();

  // Service value
  if (HIGH_VALUE.some(s => text.includes(s))) { score += 20; factors.push("high-value-service"); }
  else if (MEDIUM_VALUE.some(s => text.includes(s))) { score += 10; factors.push("medium-value-service"); }

  // Urgency
  if (URGENT_KEYWORDS.some(k => text.includes(k))) { score += 25; factors.push("urgent-language"); }

  // Geography
  if (data.zipCode) {
    if (PRIMARY_ZIPS.includes(data.zipCode)) { score += 15; factors.push("primary-area"); }
    else if (SECONDARY_ZIPS.includes(data.zipCode)) { score += 5; factors.push("secondary-area"); }
  }

  // Vehicle age/value proxy
  if (data.vehicleInfo) {
    const yearMatch = data.vehicleInfo.match(/20[12]\d/);
    if (yearMatch) {
      const age = new Date().getFullYear() - parseInt(yearMatch[0]);
      if (age <= 3) { score += 10; factors.push("newer-vehicle"); }
      else if (age <= 7) { score += 5; factors.push("mid-age-vehicle"); }
    }
    if (/bmw|mercedes|audi|lexus|acura|infiniti|cadillac|lincoln/i.test(data.vehicleInfo)) {
      score += 10; factors.push("premium-brand");
    }
  }

  // Source quality
  if (data.source === "google" || data.source === "google-ads") { score += 10; factors.push("high-intent-source"); }
  if (data.source === "referral") { score += 15; factors.push("referral-source"); }
  if (data.formType === "booking") { score += 10; factors.push("booking-intent"); }

  // Message detail (shows real intent)
  if (data.message && data.message.length > 50) { score += 5; factors.push("detailed-message"); }

  score = Math.min(100, Math.max(0, score));

  let priority: "low" | "medium" | "high" | "urgent";
  if (score >= 85 || factors.includes("urgent-language")) priority = "urgent";
  else if (score >= 70) priority = "high";
  else if (score >= 40) priority = "medium";
  else priority = "low";

  log.info("Lead scored", { score, priority, factors });
  return { score, priority, factors };
}
