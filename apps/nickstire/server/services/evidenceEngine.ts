import { db as dbHelper } from "../lib/db-helper";
import {
  vehicleInspections,
  inspectionItems,
  bookings,
  customerVehicles,
  socialDrafts,
  reviewReplies,
  customerTestimonials
} from "../../drizzle/schema";
import { desc, eq, like, and, sql } from "drizzle-orm";
import { createLogger } from "../lib/logger";

const log = createLogger("evidence-engine");

export interface AnonymizedCaseStudy {
  vehicle: string; // e.g. "2018 Honda Civic"
  symptom: string; // e.g. "rattle when turning"
  failedComponent: string; // e.g. "sway bar link"
  condition: "yellow" | "red";
  techNotes: string; // e.g. "boot torn, road salt entered joint, grease washed out"
  recommendedAction: string;
}

export interface ProprietaryEvidence {
  recentCaseStudy: AnonymizedCaseStudy | null;
  localStats: {
    brakeRustRatioPercent: number; // % of inspected brakes showing rust/seizure
    potholeDamageCount: number; // count of recent pothole/rim damage bookings
    commonVehicles: string[]; // top 3 makes/models serviced
    averageMileage: number; // average vehicle mileage in Cleveland
  } | null;
  clevelandAngle: string | null;
  testimonials: string[] | null;
  pastSocialOutputs: { topic: string; contentType: string; campaignKeyword?: string }[] | null;
  availability: "available" | "unavailable";
}

/**
 * Extracts proprietary shop trends and anonymized case studies from the local database
 * to populate prompts with exclusive, real-world Cleveland auto repair evidence.
 */
export async function getProprietaryEvidence(topicKeyword?: string): Promise<ProprietaryEvidence> {
  const unavailableResult: ProprietaryEvidence = {
    recentCaseStudy: null,
    localStats: null,
    clevelandAngle: "No local shop data available. Focus on standard verified industry guidelines.",
    testimonials: [],
    pastSocialOutputs: [],
    availability: "unavailable"
  };

  try {
    const db = await dbHelper();
    if (!db) {
      log.warn("Database not available, returning unavailable status");
      return unavailableResult;
    }

    // 1. Fetch an anonymized case study
    let caseStudy: AnonymizedCaseStudy | null = null;
    
    // Find recent inspections with red/yellow findings
    const recentInsps = await db
      .select({
        id: vehicleInspections.id,
        year: vehicleInspections.vehicleYear,
        make: vehicleInspections.vehicleMake,
        model: vehicleInspections.vehicleModel,
        summary: vehicleInspections.summaryNotes,
      })
      .from(vehicleInspections)
      .where(eq(vehicleInspections.isPublished, 1))
      .orderBy(desc(vehicleInspections.createdAt))
      .limit(10);

    if (recentInsps.length > 0) {
      // Look for a failed component item in these inspections
      for (const insp of recentInsps) {
        // Explicit columns, not a bare select(): 0143 adds columns to
        // inspection_items that a pre-migration database does not have, and a
        // bare select() would name them (.claude/skills/nickstire-tidb-ddl).
        const items = await db
          .select({
            component: inspectionItems.component,
            condition: inspectionItems.condition,
            notes: inspectionItems.notes,
            recommendedAction: inspectionItems.recommendedAction,
          })
          .from(inspectionItems)
          .where(
            and(
              eq(inspectionItems.inspectionId, insp.id),
              sql`${inspectionItems.condition} IN ('red', 'yellow')`
            )
          )
          .limit(1);

        if (items.length > 0 && insp.make && insp.model) {
          const item = items[0];
          caseStudy = {
            vehicle: `${insp.year || ""} ${insp.make} ${insp.model}`.trim(),
            symptom: insp.summary || "Unspecified noise/feel",
            failedComponent: item.component,
            condition: item.condition as "red" | "yellow",
            techNotes: item.notes || "Component shows advanced wear.",
            recommendedAction: item.recommendedAction || "Recommend inspection/replacement."
          };
          break; // found one
        }
      }
    }

    // 2. Calculate local brake rust ratio (prop proportion of inspected brakes showing rust issues)
    let brakeRustRatioPercent = 0;
    const brakeItems = await db
      .select({
        id: inspectionItems.id,
        notes: inspectionItems.notes
      })
      .from(inspectionItems)
      .where(eq(inspectionItems.category, "brakes"))
      .limit(100);

    if (brakeItems.length > 0) {
      const rustKeywords = ["rust", "salt", "seiz", "lock", "corros", "pit"];
      const rustCount = brakeItems.filter((item: any) => 
        item.notes && rustKeywords.some(kw => item.notes!.toLowerCase().includes(kw))
      ).length;
      brakeRustRatioPercent = Math.round((rustCount / brakeItems.length) * 100);
    }

    // 3. Count pothole damage indicators in recent bookings
    let potholeDamageCount = 0;
    const recentBookings = await db
      .select({
        message: bookings.message,
        service: bookings.service
      })
      .from(bookings)
      .orderBy(desc(bookings.createdAt))
      .limit(150);

    if (recentBookings.length > 0) {
      const potholeKeywords = ["pothole", "bubble", "rim", "sidewall", "hit", "blowout"];
      potholeDamageCount = recentBookings.filter((b: any) =>
        (b.message && potholeKeywords.some(kw => b.message!.toLowerCase().includes(kw))) ||
        (b.service && potholeKeywords.some(kw => b.service.toLowerCase().includes(kw)))
      ).length;
    }

    // 4. Find top 3 most common vehicles serviced
    let commonVehicles: string[] = [];
    const vehicleCounts = await db
      .select({
        make: customerVehicles.make,
        model: customerVehicles.model,
        count: sql<number>`count(*)`
      })
      .from(customerVehicles)
      .groupBy(customerVehicles.make, customerVehicles.model)
      .orderBy(desc(sql`count(*)`))
      .limit(3);

    if (vehicleCounts.length > 0) {
      commonVehicles = vehicleCounts.map((v: any) => `${v.make} ${v.model}`);
    }

    // 5. Calculate average mileage
    let averageMileage = 0;
    const avgMilRow = await db
      .select({
        avg: sql<number>`avg(${customerVehicles.mileage})`
      })
      .from(customerVehicles)
      .where(sql`${customerVehicles.mileage} > 0`);

    if (avgMilRow.length > 0 && avgMilRow[0].avg) {
      averageMileage = Math.round(Number(avgMilRow[0].avg));
    }

    // 6. Fetch testimonials (Google reviews with rating >= 4, and curated testimonials)
    const testimonials: string[] = [];
    try {
      const googleReviews = await db
        .select({
          author: reviewReplies.reviewerName,
          text: reviewReplies.reviewText,
          rating: reviewReplies.reviewRating,
        })
        .from(reviewReplies)
        .where(sql`${reviewReplies.reviewRating} >= 4`)
        .orderBy(desc(reviewReplies.createdAt))
        .limit(3);

      for (const rev of googleReviews) {
        if (rev.text) {
          testimonials.push(`${rev.author || "Anonymous"}: "${rev.text}" (${rev.rating} stars)`);
        }
      }

      const manualTestimonials = await db
        .select({
          author: customerTestimonials.author,
          text: customerTestimonials.text,
          rating: customerTestimonials.rating,
        })
        .from(customerTestimonials)
        .where(sql`${customerTestimonials.rating} >= 4`)
        .orderBy(desc(customerTestimonials.createdAt))
        .limit(3);

      for (const t of manualTestimonials) {
        if (t.text) {
          testimonials.push(`${t.author || "Verified Customer"}: "${t.text}" (${t.rating} stars)`);
        }
      }
    } catch (testErr) {
      log.warn("Failed to fetch testimonials from database", testErr);
    }
    const combinedTestimonials = testimonials.slice(0, 5);

    // 7. Fetch past social outputs
    const pastSocialOutputs: { topic: string; contentType: string; campaignKeyword?: string }[] = [];
    try {
      const dbRows = await db
        .select()
        .from(socialDrafts)
        .orderBy(desc(socialDrafts.createdAt))
        .limit(30);

      for (const r of dbRows) {
        try {
          const brief = JSON.parse(r.briefJson);
          if (brief.status === "posted") {
            pastSocialOutputs.push({
              topic: r.topic,
              contentType: r.contentType,
              campaignKeyword: brief.campaignKeyword || undefined,
            });
            if (pastSocialOutputs.length >= 5) break;
          }
        } catch (e) {
          log.error("Failed to parse social draft JSON in evidence engine", e);
        }
      }
    } catch (socialErr) {
      log.warn("Failed to fetch past social outputs from DB", socialErr);
    }

    return {
      recentCaseStudy: caseStudy,
      localStats: {
        brakeRustRatioPercent: Math.max(0, Math.min(100, brakeRustRatioPercent)),
        potholeDamageCount,
        commonVehicles,
        averageMileage
      },
      clevelandAngle: brakeRustRatioPercent > 0
        ? `Out of the brakes inspected at our shop, ${brakeRustRatioPercent}% show signs of salt-related rust or seizure.`
        : `Cleveland road salt and freeze-thaw cycles accelerate undercarriage rust much faster than national averages.`,
      testimonials: combinedTestimonials,
      pastSocialOutputs,
      availability: "available"
    };
  } catch (err) {
    log.error("Failed to fetch proprietary evidence from database:", err);
    return unavailableResult;
  }
}
