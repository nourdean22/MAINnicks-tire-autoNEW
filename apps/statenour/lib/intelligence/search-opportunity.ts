import { prisma } from "@/lib/prisma";
import { fetchGSCAndGBPMetrics } from "./connectors/gsc";
import { calculateOpportunityScore } from "./scoring";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("intelligence/search-opportunity");

export async function processSearchOpportunities(): Promise<number> {
  try {
    log.info("Running Search Opportunity Engine...");
    
    // Fetch search query analytics (either live or mock)
    const { gsc } = await fetchGSCAndGBPMetrics();
    
    let createdCount = 0;
    
    for (const item of gsc) {
      // Logic for high-impression, low-CTR, high-intent gaps
      // Intent heuristic: includes auto service keywords (tire, brake, repair, mechanic, oil, alignment)
      const queryLower = item.query.toLowerCase();
      const isHighIntent = 
        queryLower.includes("tire") || 
        queryLower.includes("brake") || 
        queryLower.includes("repair") || 
        queryLower.includes("service") || 
        queryLower.includes("mechanic") || 
        queryLower.includes("alignment") ||
        queryLower.includes("install");
        
      const isLowCtr = item.ctr < 0.15; // less than 15% click-through rate
      const hasHighImpressions = item.impressions > 500; // reasonable impression volume
      
      if (isHighIntent && isLowCtr && hasHighImpressions) {
        const title = `SEO Search Gap: "${item.query}"`;
        
        // Deduplicate
        const existing = await prisma.opportunityLog.findFirst({
          where: {
            title,
            status: "pending"
          }
        });
        
        if (!existing) {
          // Define metrics
          const impact = Math.min(95, Math.round(item.impressions / 20 + 40)); // higher impressions -> higher impact
          const urgency = 65; // SEO optimization is strategic but standard urgency
          const confidence = 0.90; // High confidence since GSC is a primary data source
          const reversibility = 90; // Extremely reversible (we can edit page/content easily)
          
          const score = calculateOpportunityScore(impact, urgency, confidence, reversibility);
          
          await prisma.opportunityLog.create({
            data: {
              title,
              description: `Keyword "${item.query}" has high search impressions (${item.impressions}) in the local Cleveland market, but a low Click-Through Rate (${(item.ctr * 100).toFixed(1)}%) at position ${item.position}. Recommended action: Create or optimize a dedicated local service landing page or FAQ targeting "${item.query}" to capture organic clicks.`,
              domain: "seo",
              impact,
              urgency,
              confidence,
              reversibility,
              score,
              status: "pending"
            }
          });
          
          createdCount++;
          log.info(`Logged GSC opportunity: ${title} (Score: ${score})`);
        }
      }
    }
    
    return createdCount;
  } catch (err) {
    log.error("Failed to run Search Opportunity Engine:", {
      error: err instanceof Error ? err.message : String(err)
    });
    return 0;
  }
}
