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
${indicators.length > 0 ? indicators
  .map(
    (ind) =>
      `- **${ind.name}** (${ind.seriesId}): value of **${ind.value}${ind.unit}** (Observed: ${ind.date})`
  )
  .join("\n") : "- No verified macro data available."}
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
${recalls.length > 0 ? recalls
  .map(
    (r) =>
      `### Recall Campaign ${r.NHTSACampaignNumber} - ${r.VehicleMake} ${r.VehicleModel} (${r.ModelYear})
- **Component:** ${r.Component}
- **Summary:** ${r.Summary}
- **Consequence:** ${r.Conequence}
- **Remedy:** ${r.Remedy}`
  )
  .join("\n\n") : "- No verified recall data available."}
`;
    } else if (source.domain === "seo") {
      const { gsc, gbp } = await fetchGSCAndGBPMetrics();
      rawContent = `# Google Search Console & Business Profile Report
Generated: ${new Date().toISOString()}
Source: ${source.url}

Google Search Console Keywords:
${gsc.length > 0 ? gsc
  .map(
    (g) =>
      `- **Query:** "${g.query}" | Clicks: ${g.clicks} | Impressions: ${g.impressions} | CTR: ${(g.ctr * 100).toFixed(1)}% | Avg Position: ${g.position}`
  )
  .join("\n") : "- No search data available."}

Google Business Profile Status:
${gbp ? `- Rating: ${gbp.rating} / 5.0 (${gbp.totalReviews} total reviews)
- Latest Review: "${gbp.recentReviewText}"` : "- GBP data unavailable."}
`;
    } else if (source.domain === "competitor") {
      const { filings, prices } = await fetchCompetitorAndSECData();
      // AG-44 · live promo-page snapshots (Firecrawl · empty when
      // unkeyed) so this section carries what competitors are running
      // TODAY, not just SEC filings. Best-effort — never fails ingest.
      const { fetchCompetitorPages } = await import("./connectors/competitor-watch");
      const webWatch = await fetchCompetitorPages().catch(() => []);
      rawContent = `# SEC EDGAR Filings & Competitor Pricing Report
Generated: ${new Date().toISOString()}
Source: ${source.url}

Competitor Pricing:
${prices.length > 0 ? prices
  .map(
    (p) =>
      `- **${p.competitor}**: brand **${p.tireBrand}** (size ${p.size}) priced at **$${p.price}** (Promo: ${p.promo || "None"})`
  )
  .join("\n") : "- No verified competitor pricing available."}

Competitor Promo Pages (live scrape):
${webWatch.length > 0 ? webWatch
  .map(
    (w) =>
      `### ${w.competitor} — ${w.title ?? w.url} (fetched ${w.fetchedAt})\n${w.excerpt}`
  )
  .join("\n\n") : "- No competitor page snapshots available (Firecrawl unkeyed or scrapes failed)."}

SEC Edgar Filings:
${filings.length > 0 ? filings
  .map(
    (f) =>
      `- **Ticker:** ${f.ticker} | Form: ${f.form} | Filed: ${f.filedAt}`
  )
  .join("\n") : "- No filings available."}
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
${data.metrics.length > 0 ? data.metrics.map(m => `- **${m.name}** (${m.symbol}): **${m.price} ${m.unit}** (24h Change: ${m.changePercent24h > 0 ? "+" : ""}${m.changePercent24h}%)`).join("\n") : "- No verified commodity data available."}

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
${deals.length > 0 ? deals.map(d => `### ${d.title}
- **Location:** ${d.location}
- **Price:** $${d.listingPrice.toLocaleString()}
- **Type:** ${d.type}
- **Link:** ${d.link}
- **Description:** ${d.description}
- **Strategic Notes:** ${d.notes}`).join("\n\n") : "- No verified deal listings available."}
`;
    } else if (source.domain === "performance") {
      const data = await fetchBioPerformanceMetrics();
      rawContent = `# Personal Bio-Performance & Health Research Report
Generated: ${new Date().toISOString()}
Source: ${source.url}

Personal Biomarkers:
${data.biometrics.length > 0 ? data.biometrics.map(b => `- **${b.metric}**: **${b.value}${b.unit}** | Status: **${b.status}**\n  Notes: ${b.notes}`).join("\n") : "- No verified biometric data available."}

Scientific Insights & Protocols:
${data.insights.length > 0 ? data.insights.map(i => `### ${i.title} (${i.topic})
- **Source:** ${i.source}
- **Summary:** ${i.summary}
- **Actionable Protocol:** ${i.actionableProtocol}`).join("\n\n") : "- No verified insights available."}
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
        // AG-02 · No mock fallback. Fabricated content used to flow from here
        // into SourceDocument → IntelligenceClaim → the pushed daily brief.
        // A failed scrape now skips the source instead of inventing a report.
        log.warn(`Firecrawl scraping failed for ${source.url}; skipping source (no mock fallback).`, {
          error: err instanceof Error ? err.message : String(err),
        });
        return {
          success: false,
          documentId: null,
          claimsCount: 0,
          message: `Scrape failed for ${source.name}; source skipped — no content fabricated.`,
        };
      }
    } else {
      // AG-02 · Unconfigured domains previously received getMockContentForDomain
      // fiction (fake AI reports, fake GSC wins, fake weather) that entered the
      // claims pipeline as real intelligence. Skip them loudly instead.
      log.info(`Source ${source.name} (${source.domain}) has no connector or scrape path; skipping — no content fabricated.`);
      return {
        success: false,
        documentId: null,
        claimsCount: 0,
        message: `Source unconfigured (${source.domain}); skipped — no content fabricated.`,
      };
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
