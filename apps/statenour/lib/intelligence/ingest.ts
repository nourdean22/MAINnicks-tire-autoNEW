/**
 * Core Ingestion Pipeline Service
 * Orchestrates: Fetching -> Document Storage -> Claims Extraction -> Semantic Grounding -> Claims Storage
 */
import { prisma } from "@/lib/prisma";
import { fetchFREDIndicators } from "./connectors/fred";
import { fetchNHTSARecalls } from "./connectors/nhtsa";
import { fetchGSCAndGBPMetrics } from "./connectors/gsc";
import { fetchCompetitorAndSECData } from "./connectors/sec";
import { fetchWeatherMetrics } from "./connectors/weather";
import { fetchSupplyChainMetrics } from "./connectors/supplychain";
import { fetchListedDeals } from "./connectors/dealscouting";
import { fetchBioPerformanceMetrics } from "./connectors/performance";
import { extractClaimsFromText } from "./extraction";
import { groundClaim } from "./grounding";
import { scrapeUrl, isFirecrawlConfigured } from "@/lib/integrations/firecrawl";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("intelligence/ingest");

export interface IngestionResult {
  success: boolean;
  documentId: string | null;
  claimsCount: number;
  message: string;
}

export async function runIngestion(sourceId: string): Promise<IngestionResult> {
  try {
    // 1. Resolve registered source
    const source = await prisma.registeredSource.findUnique({
      where: { id: sourceId },
    });

    if (!source) {
      return { success: false, documentId: null, claimsCount: 0, message: "Source not found." };
    }

    log.info(`Starting ingestion for source: ${source.name} (${source.domain})`);

    let rawContent = "";
    let docUrl = source.url;

    // 2. Fetch raw content based on domain & config
    if (source.domain === "macro") {
      const indicators = await fetchFREDIndicators();
      rawContent = `# FRED Macro Economic Report
Generated: ${new Date().toISOString()}
Source: ${source.url}

Key observations:
${indicators
  .map(
    (ind) =>
      `- **${ind.name}** (${ind.seriesId}): value of **${ind.value}${ind.unit}** (Observed: ${ind.date})`
  )
  .join("\n")}
`;
    } else if (source.domain === "automotive") {
      const vehicles = [
        { make: "Ford", model: "F-150", year: 2020 },
        { make: "Honda", model: "Accord", year: 2018 },
      ];
      const recalls = await fetchNHTSARecalls(vehicles);
      rawContent = `# NHTSA Safety Recalls Report
Generated: ${new Date().toISOString()}
Source: ${source.url}

Recalls found:
${recalls
  .map(
    (r) =>
      `### Recall Campaign ${r.NHTSACampaignNumber} - ${r.VehicleMake} ${r.VehicleModel} (${r.ModelYear})
- **Component:** ${r.Component}
- **Summary:** ${r.Summary}
- **Consequence:** ${r.Conequence}
- **Remedy:** ${r.Remedy}`
  )
  .join("\n\n")}
`;
    } else if (source.domain === "seo") {
      const { gsc, gbp } = await fetchGSCAndGBPMetrics();
      rawContent = `# Google Search Console & Business Profile Report
Generated: ${new Date().toISOString()}
Source: ${source.url}

Google Search Console Keywords:
${gsc
  .map(
    (g) =>
      `- **Query:** "${g.query}" | Clicks: ${g.clicks} | Impressions: ${g.impressions} | CTR: ${(g.ctr * 100).toFixed(1)}% | Avg Position: ${g.position}`
  )
  .join("\n")}

Google Business Profile Status:
- Rating: ${gbp.rating} / 5.0 (${gbp.totalReviews} total reviews)
- Latest Review: "${gbp.recentReviewText}"
`;
    } else if (source.domain === "competitor") {
      const { filings, prices } = await fetchCompetitorAndSECData();
      rawContent = `# SEC EDGAR Filings & Competitor Pricing Report
Generated: ${new Date().toISOString()}
Source: ${source.url}

Competitor Pricing:
${prices
  .map(
    (p) =>
      `- **${p.competitor}**: brand **${p.tireBrand}** (size ${p.size}) priced at **$${p.price}** (Promo: ${p.promo || "None"})`
  )
  .join("\n")}

SEC Edgar Filings:
${filings
  .map(
    (f) =>
      `- **Ticker:** ${f.ticker} | Form: ${f.form} | Filed: ${f.filedAt} | Revenue: $${f.revenueBillions}B | Net Income: $${f.netIncomeBillions}B`
  )
  .join("\n")}
`;
    } else if (source.domain === "weather") {
      const data = await fetchWeatherMetrics();
      rawContent = `# NOAA Weather & Forecast Report
Generated: ${new Date().toISOString()}
Location: ${data.location}
Temperature: ${data.temperature}°F
Condition: ${data.condition}
Forecast: ${data.forecast}

Alerts & Opportunities:
${data.alerts.length === 0 ? "- None" : data.alerts.map(a => `### ${a.event} (${a.severity} Priority)
- **Description:** ${a.description}
- **Opportunity:** ${a.opportunity}`).join("\n\n")}
`;
    } else if (source.domain === "supplychain") {
      const data = await fetchSupplyChainMetrics();
      rawContent = `# Supply Chain & Tire Commodities Report
Generated: ${new Date().toISOString()}
Source: ${source.url}

Commodity & Logistics Metrics:
${data.metrics.map(m => `- **${m.name}** (${m.symbol}): **${m.price} ${m.unit}** (24h Change: ${m.changePercent24h > 0 ? "+" : ""}${m.changePercent24h}%)`).join("\n")}

Alerts & Recommendations:
${data.alerts.length === 0 ? "- None" : data.alerts.map(a => `### ${a.title} (${a.severity} Priority)
- **Impact:** ${a.impactDescription}
- **Recommendation:** ${a.actionRecommendation}`).join("\n\n")}
`;
    } else if (source.domain === "dealscouting") {
      const deals = await fetchListedDeals();
      rawContent = `# Lakewood/Cleveland Automotive Deal Scouting Report
Generated: ${new Date().toISOString()}
Source: ${source.url}

Active M&A & Commercial Real Estate Deals:
${deals.map(d => `### ${d.title}
- **Location:** ${d.location}
- **Price:** $${d.listingPrice.toLocaleString()}
- **Type:** ${d.type}
- **Link:** ${d.link}
- **Description:** ${d.description}
- **Strategic Notes:** ${d.notes}`).join("\n\n")}
`;
    } else if (source.domain === "performance") {
      const data = await fetchBioPerformanceMetrics();
      rawContent = `# Personal Bio-Performance & Health Research Report
Generated: ${new Date().toISOString()}
Source: ${source.url}

Personal Biomarkers:
${data.biometrics.map(b => `- **${b.metric}**: **${b.value}${b.unit}** | Status: **${b.status}**\n  Notes: ${b.notes}`).join("\n")}

Scientific Insights & Protocols:
${data.insights.map(i => `### ${i.title} (${i.topic})
- **Source:** ${i.source}
- **Summary:** ${i.summary}
- **Actionable Protocol:** ${i.actionableProtocol}`).join("\n\n")}
`;
    } else if (source.url.startsWith("http") && isFirecrawlConfigured()) {
      try {
        const scraped = await scrapeUrl(source.url);
        rawContent = `# Scraped Source: ${scraped.title || source.name}
URL: ${scraped.sourceUrl}
Description: ${scraped.description || ""}

${scraped.markdown}
`;
        docUrl = scraped.sourceUrl;
      } catch (err) {
        log.warn(`Firecrawl scraping failed for ${source.url}, falling back to mock content.`, {
          error: err instanceof Error ? err.message : String(err),
        });
        rawContent = getMockContentForDomain(source.domain, source.name, source.url);
      }
    } else {
      // Fallback/Mock content for unregistered domains / web scraping without key
      rawContent = getMockContentForDomain(source.domain, source.name, source.url);
    }

    // 3. Save Source Document
    const document = await prisma.sourceDocument.create({
      data: {
        sourceId: source.id,
        rawContent,
        url: docUrl,
      },
    });

    // 4. Extract Claims
    const extractedClaims = await extractClaimsFromText(rawContent);

    // 5. Ground and verify claims
    let savedClaimsCount = 0;
    for (const claim of extractedClaims) {
      const grounded = await groundClaim(claim.text, claim.category, claim.confidence);

      // Save claim
      await prisma.intelligenceClaim.create({
        data: {
          documentId: document.id,
          text: grounded.text,
          category: grounded.category,
          confidence: grounded.confidence,
          verificationScore: grounded.verificationScore,
          status: grounded.status,
          bestMatchChunk: grounded.bestMatchChunk,
          narrativeStatus: claim.narrativeStatus,
        },
      });
      savedClaimsCount++;
    }

    // 6. Update Registered Source lastFetched timestamp
    await prisma.registeredSource.update({
      where: { id: source.id },
      data: { lastFetched: new Date() },
    });

    log.info(`Ingestion finished successfully. Created document ${document.id} with ${savedClaimsCount} claims.`);

    return {
      success: true,
      documentId: document.id,
      claimsCount: savedClaimsCount,
      message: `Successfully ingested source and processed ${savedClaimsCount} claims.`,
    };
  } catch (error) {
    log.error(`Ingestion pipeline crashed for source ${sourceId}:`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      documentId: null,
      claimsCount: 0,
      message: error instanceof Error ? error.message : "Ingestion crashed",
    };
  }
}

function getMockContentForDomain(domain: string, name: string, url: string): string {
  const nowStr = new Date().toISOString();
  if (domain === "ai") {
    return `# AI Industry Frontier Report
Generated: ${nowStr}
Source: ${url}

- **Claude 3.5 Sonnet** (Anthropic) is currently the leading model for software engineering agent pipelines due to its structured tool call compliance and large system prompt context memory.
- OpenAI has announced new API optimizations for structured outputs JSON Schema enforcement, reducing latency by 20%.
- Custom reasoning models like DeepSeek-R1 and o1 are proving extremely capable for offline code auditing and math verification.
`;
  }
  if (domain === "seo") {
    return `# Google Search Console Organic Report
Generated: ${nowStr}
Source: ${url}

- Average search position for "Nick's Tire and Auto" improved from 4.2 to 3.1 over the last 14 days.
- Impressions for "mobile tire repair near me" spiked by 45% following the mobile landing page optimization.
- Mobile usability indexing issue detected on the checkout funnel page due to small touch targets (< 48px).
`;
  }
  if (domain === "weather") {
    return `# NOAA Weather & Forecast Report
Generated: ${nowStr}
Location: Cleveland, OH
Temperature: 28°F
Condition: Light Snow
Forecast: Light snow showers expected in the Cleveland metro area. Total snow accumulation of 1 to 3 inches possible. Low near 28.

Alerts & Opportunities:
### Winter Hazard Alert (HIGH Priority)
- **Description:** Freezing temperatures or snow predicted in Cleveland. Current forecast: Light snow showers expected in the Cleveland metro area.
- **Opportunity:** Promote immediate winter tire swap packages and battery diagnostics to VIP customers via SMS.
`;
  }
  if (domain === "supplychain") {
    return `# Supply Chain & Tire Commodities Report
Generated: ${nowStr}
Source: ${url}

Commodity & Logistics Metrics:
- **Natural Rubber (TSR20 Futures)** (SGX:JR): **1840.5 USD/Metric Ton** (24h Change: +3.42%)
- **Global Container Freight Index** (FBX:GLO): **4250 USD/40ft Box** (24h Change: +12.8%)

Alerts & Recommendations:
### Rubber Price Spike (MEDIUM Priority)
- **Impact:** Natural rubber is up 3.42% in the last 24h. Tire manufacturers are highly likely to raise wholesale dealer costs by 5-8% next quarter.
- **Recommendation:** Pre-order high-volume standard SUV and light-truck tire sizes now to lock in lower wholesale margin basis before price adjustments hit.
`;
  }
  if (domain === "dealscouting") {
    return `# Lakewood/Cleveland Automotive Deal Scouting Report
Generated: ${nowStr}
Source: ${url}

Active M&A & Commercial Real Estate Deals:
### Lakewood 6-Bay Auto Repair Facility
- **Location:** Lakewood, OH (Detroit Ave)
- **Price:** $420,000
- **Type:** automotive_business
- **Link:** https://commercial.crexi.com/lakewood-auto-bay
- **Description:** Fully equipped 6-bay repair shop with active client list, tire mounting machines, and alignment rack.
- **Strategic Notes:** Highly strategic secondary location for Nick's Tire. Lakewood has dense commuter demographics but fewer large-scale independent tire centers.
`;
  }
  if (domain === "performance") {
    return `# Personal Bio-Performance & Health Research Report
Generated: ${nowStr}
Source: ${url}

Personal Biomarkers:
- **Sleep Efficiency**: **74.5%** | Status: **suboptimal**
  Notes: Time in bed was 8.2 hours, but deep and REM sleep fell below target due to elevated resting heart rate.

Scientific Insights & Protocols:
### Impact of Late-Night Cortisol on Deep Sleep Cycles (Sleep Science)
- **Source:** Stanford Neurobiology / Huberman Lab
- **Summary:** Intense cognitive problem-solving or screen exposure in the 90 minutes before sleep triggers cortisol release, delaying the first deep-sleep cycle by up to 45 minutes.
- **Actionable Protocol:** Establish a hard screen shutdown at 9:00 PM. Replace coding or active planning with passive reading or breathwork to trigger parasympathetic tone.
`;
  }
  return `# General Intelligence Report: ${name}
Generated: ${nowStr}
Source: ${url}

- Key signal: Operational throughput has stabilized.
- Opportunity identified: Integrating VAPI/SMS outreach automations can recover dormant customer leads within 24 hours.
`;
}
