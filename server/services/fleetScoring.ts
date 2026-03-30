/**
 * Fleet Account Scoring — Identifies businesses with multiple vehicles
 * Scores potential fleet accounts based on visit frequency, vehicle count, and spend.
 * Runs monthly to surface high-value B2B opportunities.
 */

import { createLogger } from "../lib/logger";

const log = createLogger("fleet-scoring");

export interface FleetProspect {
  name: string;
  company: string | null;
  phone: string;
  vehicleCount: number;
  totalSpend: number;
  visitCount: number;
  score: number;
  tier: "platinum" | "gold" | "silver" | "prospect";
}

export function scoreFleetProspect(data: {
  vehicleCount: number;
  totalSpend: number;
  visitCount: number;
  hasCompanyName: boolean;
}): { score: number; tier: FleetProspect["tier"] } {
  let score = 0;

  // Vehicle count (0-30 points)
  score += Math.min(30, data.vehicleCount * 10);

  // Lifetime spend (0-30 points)
  score += Math.min(30, Math.floor(data.totalSpend / 100));

  // Visit frequency (0-20 points)
  score += Math.min(20, data.visitCount * 4);

  // Business name bonus (20 points)
  if (data.hasCompanyName) score += 20;

  score = Math.min(100, score);

  const tier: FleetProspect["tier"] =
    score >= 80 ? "platinum" : score >= 60 ? "gold" : score >= 40 ? "silver" : "prospect";

  return { score, tier };
}

export async function identifyFleetProspects(): Promise<{
  recordsProcessed: number;
  details: string;
}> {
  try {
    const { getDb } = await import("../db");
    const db = await getDb();
    if (!db) return { recordsProcessed: 0, details: "No DB" };

    // Find customers with multiple vehicles or high spend
    const { customers } = await import("../../drizzle/schema");
    const { sql } = await import("drizzle-orm");

    const prospects = await db
      .select({
        name: customers.firstName,
        phone: customers.phone,
        company: customers.customerType,
        totalVisits: customers.totalVisits,
      })
      .from(customers)
      .where(
        sql`${customers.totalVisits} >= 3 OR ${customers.customerType} = 'commercial'`
      )
      .limit(100);

    let fleetCount = 0;
    for (const p of prospects) {
      const { score, tier } = scoreFleetProspect({
        vehicleCount: 1,
        totalSpend: 0,
        visitCount: Number(p.totalVisits),
        hasCompanyName: p.company === "commercial",
      });

      if (score >= 40) {
        fleetCount++;
        log.info("Fleet prospect identified", {
          name: p.name,
          score,
          tier,
          visits: p.totalVisits,
        });
      }
    }

    return {
      recordsProcessed: prospects.length,
      details: `Scanned ${prospects.length} customers, ${fleetCount} fleet prospects`,
    };
  } catch (err) {
    log.error("Fleet scoring failed", { err });
    return { recordsProcessed: 0, details: "Error" };
  }
}
