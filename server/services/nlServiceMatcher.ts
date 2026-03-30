/**
 * Natural Language Service Matcher
 * Customer describes problem → maps to correct service(s)
 * Keyword-based (instant), falls back to general diagnosis for unknowns.
 */

import { createLogger } from "../lib/logger";
const log = createLogger("service-matcher");

interface ServiceMatch {
  service: string;
  slug: string;
  urgency: "low" | "medium" | "high";
  matchedKeyword: string;
  confidence: "exact" | "partial" | "ai";
}

const KEYWORD_MAP: Record<string, { service: string; slug: string; urgency: "low" | "medium" | "high" }> = {
  "squealing": { service: "Brake Inspection", slug: "brakes", urgency: "medium" },
  "grinding": { service: "Brake Repair", slug: "brakes", urgency: "high" },
  "brake": { service: "Brake Service", slug: "brakes", urgency: "medium" },
  "stopping": { service: "Brake Inspection", slug: "brakes", urgency: "high" },
  "pedal soft": { service: "Brake Fluid / Brake Repair", slug: "brakes", urgency: "high" },
  "check engine": { service: "Engine Diagnostics", slug: "diagnostics", urgency: "medium" },
  "engine light": { service: "Engine Diagnostics", slug: "diagnostics", urgency: "medium" },
  "won't start": { service: "Electrical / Starter Diagnosis", slug: "electrical-repair", urgency: "high" },
  "overheating": { service: "Cooling System Repair", slug: "engine-repair", urgency: "high" },
  "rough idle": { service: "Engine Diagnostics", slug: "diagnostics", urgency: "medium" },
  "misfire": { service: "Engine Diagnostics", slug: "diagnostics", urgency: "medium" },
  "stalling": { service: "Engine Diagnostics", slug: "diagnostics", urgency: "high" },
  "tire": { service: "Tire Service", slug: "tires", urgency: "medium" },
  "flat": { service: "Tire Repair", slug: "tires", urgency: "high" },
  "bald": { service: "New Tires", slug: "tires", urgency: "high" },
  "uneven wear": { service: "Alignment + Tires", slug: "alignment", urgency: "medium" },
  "vibration": { service: "Tire Balance / Alignment", slug: "alignment", urgency: "medium" },
  "ac": { service: "AC Repair", slug: "ac-repair", urgency: "medium" },
  "air conditioning": { service: "AC Repair", slug: "ac-repair", urgency: "medium" },
  "hot air": { service: "AC Repair", slug: "ac-repair", urgency: "medium" },
  "no cold air": { service: "AC Repair", slug: "ac-repair", urgency: "medium" },
  "transmission": { service: "Transmission Service", slug: "transmission-repair", urgency: "high" },
  "slipping": { service: "Transmission Diagnosis", slug: "transmission-repair", urgency: "high" },
  "hard shift": { service: "Transmission Diagnosis", slug: "transmission-repair", urgency: "medium" },
  "oil change": { service: "Oil Change", slug: "oil-change", urgency: "low" },
  "alignment": { service: "Wheel Alignment", slug: "alignment", urgency: "low" },
  "suspension": { service: "Suspension Repair", slug: "suspension-repair", urgency: "medium" },
  "exhaust": { service: "Exhaust Repair", slug: "exhaust-repair", urgency: "medium" },
  "emissions": { service: "E-Check / Emissions", slug: "emissions", urgency: "low" },
  "echeck": { service: "E-Check / Emissions", slug: "emissions", urgency: "low" },
  "battery": { service: "Battery Service", slug: "electrical-repair", urgency: "medium" },
  "alternator": { service: "Electrical Repair", slug: "electrical-repair", urgency: "high" },
  "starter": { service: "Starter Replacement", slug: "electrical-repair", urgency: "high" },
  "leak": { service: "Fluid Leak Diagnosis", slug: "general-repair", urgency: "medium" },
  "noise": { service: "Noise Diagnosis", slug: "diagnostics", urgency: "medium" },
  "smell": { service: "Vehicle Inspection", slug: "diagnostics", urgency: "medium" },
  "smoke": { service: "Engine / Exhaust Diagnosis", slug: "diagnostics", urgency: "high" },
  "shaking": { service: "Suspension / Alignment", slug: "alignment", urgency: "medium" },
  "pulling": { service: "Alignment Check", slug: "alignment", urgency: "medium" },
  "clicking": { service: "CV Joint / Axle Inspection", slug: "general-repair", urgency: "medium" },
};

export function matchService(description: string): ServiceMatch[] {
  const lower = description.toLowerCase();
  const matches: ServiceMatch[] = [];

  for (const [keyword, data] of Object.entries(KEYWORD_MAP)) {
    if (lower.includes(keyword)) {
      matches.push({ ...data, matchedKeyword: keyword, confidence: "exact" });
    }
  }

  // Deduplicate by service
  const unique = [...new Map(matches.map(m => [m.service, m])).values()];

  if (unique.length === 0) {
    return [{ service: "General Diagnosis", slug: "diagnostics", urgency: "medium", matchedKeyword: "none", confidence: "ai" }];
  }

  const urgencyOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  return unique.sort((a, b) => (urgencyOrder[a.urgency] ?? 1) - (urgencyOrder[b.urgency] ?? 1));
}
