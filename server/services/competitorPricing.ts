/**
 * Competitor Pricing Intelligence
 * Tracks competitor prices for comparison and positioning.
 * Data sources: manual entry, customer-reported quotes.
 */

import { createLogger } from "../lib/logger";
const log = createLogger("competitor-pricing");

export interface CompetitorPricePoint {
  competitorName: string;
  service: string;
  priceMin: number;
  priceMax: number;
  source: "manual" | "customer-reported" | "website";
  lastChecked: Date;
  notes?: string;
}

// Known competitor pricing (manually maintained)
export const COMPETITOR_DATA: CompetitorPricePoint[] = [
  // Firestone (chain)
  { competitorName: "Firestone", service: "oil-change", priceMin: 49, priceMax: 99, source: "website", lastChecked: new Date(), notes: "Synthetic blend $49 promo, full synthetic $79-99" },
  { competitorName: "Firestone", service: "brakes", priceMin: 149, priceMax: 399, source: "website", lastChecked: new Date() },
  { competitorName: "Firestone", service: "alignment", priceMin: 89, priceMax: 119, source: "website", lastChecked: new Date() },

  // Midas (chain)
  { competitorName: "Midas", service: "oil-change", priceMin: 39, priceMax: 89, source: "website", lastChecked: new Date() },
  { competitorName: "Midas", service: "brakes", priceMin: 159, priceMax: 449, source: "website", lastChecked: new Date() },

  // Pep Boys (chain)
  { competitorName: "Pep Boys", service: "oil-change", priceMin: 34, priceMax: 79, source: "website", lastChecked: new Date() },
  { competitorName: "Pep Boys", service: "tires", priceMin: 79, priceMax: 200, source: "website", lastChecked: new Date(), notes: "Per tire installed" },

  // Dealer average (Cleveland area)
  { competitorName: "Dealer Average", service: "oil-change", priceMin: 69, priceMax: 129, source: "manual", lastChecked: new Date() },
  { competitorName: "Dealer Average", service: "brakes", priceMin: 299, priceMax: 699, source: "manual", lastChecked: new Date() },
  { competitorName: "Dealer Average", service: "diagnostics", priceMin: 99, priceMax: 150, source: "manual", lastChecked: new Date() },
];

// Nick's pricing for comparison
const OUR_PRICING: Record<string, { min: number; max: number }> = {
  "oil-change": { min: 39, max: 79 },
  "brakes": { min: 89, max: 299 },
  "tires": { min: 60, max: 200 },
  "diagnostics": { min: 49, max: 99 },
  "alignment": { min: 79, max: 99 },
  "emissions": { min: 29, max: 49 },
  "flat-repair": { min: 15, max: 25 },
};

/** Compare our pricing vs competitors for a service */
export function getPriceComparison(serviceSlug: string): Array<{
  competitor: string;
  theirRange: string;
  ourRange: string;
  savings: string;
}> {
  const ours = OUR_PRICING[serviceSlug];
  if (!ours) return [];

  const competitors = COMPETITOR_DATA.filter(c => c.service === serviceSlug);
  return competitors.map(c => {
    const avgTheirs = (c.priceMin + c.priceMax) / 2;
    const avgOurs = (ours.min + ours.max) / 2;
    const diff = avgTheirs - avgOurs;
    return {
      competitor: c.competitorName,
      theirRange: `$${c.priceMin}-$${c.priceMax}`,
      ourRange: `$${ours.min}-$${ours.max}`,
      savings: diff > 0 ? `Save ~$${Math.round(diff)}` : diff < 0 ? `$${Math.round(-diff)} more` : "Same price",
    };
  });
}

/** Get services where we're significantly cheaper */
export function getCompetitiveAdvantages(): Array<{ service: string; avgSavings: number }> {
  const advantages: Array<{ service: string; avgSavings: number }> = [];

  for (const [service, ours] of Object.entries(OUR_PRICING)) {
    const competitors = COMPETITOR_DATA.filter(c => c.service === service);
    if (competitors.length === 0) continue;

    const avgCompetitorPrice = competitors.reduce((sum, c) => sum + (c.priceMin + c.priceMax) / 2, 0) / competitors.length;
    const ourAvg = (ours.min + ours.max) / 2;
    const savings = avgCompetitorPrice - ourAvg;

    if (savings > 10) {
      advantages.push({ service, avgSavings: Math.round(savings) });
    }
  }

  return advantages.sort((a, b) => b.avgSavings - a.avgSavings);
}

log.info(`Competitor pricing loaded: ${COMPETITOR_DATA.length} price points`);
