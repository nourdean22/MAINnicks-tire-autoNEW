import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("intelligence/connectors/sec");

export interface CompetitorPrice {
  competitor: string;
  tireBrand: string;
  size: string;
  price: number;
  promo: string | null;
}

export interface SECFilment {
  ticker: string;
  form: string;
  filedAt: string;
}

/**
 * AG-02 · Fabrication purge. This connector previously emitted hardcoded
 * competitor tire prices ("Discount Tire $245 Michelin…") and invented
 * revenue/netIncome figures on real SEC filings — all of which flowed
 * through claims → OpportunityLog → the pushed Daily Executive Brief as
 * if real. Now: the EDGAR filing list is fetched for real (form + date
 * only, no fabricated financials), and competitor prices return empty
 * until a real scraper exists (planned: Firecrawl competitor-watch,
 * ANTIGRAVITY_MASTER_PLAN AG-44). Unavailable data is EMPTY, never mocked.
 */
export async function fetchCompetitorAndSECData(): Promise<{ prices: CompetitorPrice[]; filings: SECFilment[] }> {
  // Free SEC EDGAR API queries require a User-Agent header following their policy: "DeclaredCompany nourishing@bdnick.info"
  const userAgent = "ClevelandTireNourishing nourdean22@gmail.com";

  try {
    // Fetch from SEC EDGAR (e.g., Ford Motor Company CIK: 0000037996)
    const secUrl = "https://data.sec.gov/submissions/CIK0000037996.json";
    const res = await fetch(secUrl, {
      headers: {
        "User-Agent": userAgent
      },
      signal: AbortSignal.timeout(8000)
    });

    const filings: SECFilment[] = [];
    if (res.ok) {
      const payload = await res.json() as { ticker?: string; filings?: { recent?: { form: string[]; filingDate: string[] } } };
      const ticker = payload.ticker || "F";
      const forms = payload.filings?.recent?.form || [];
      const dates = payload.filings?.recent?.filingDate || [];

      for (let i = 0; i < Math.min(forms.length, 3); i++) {
        filings.push({
          ticker,
          form: forms[i],
          filedAt: dates[i] || new Date().toISOString().split("T")[0],
        });
      }
    } else {
      log.warn(`SEC EDGAR returned ${res.status}; emitting no filings rather than mock data.`);
    }

    return { filings, prices: [] };
  } catch (err) {
    log.error("Failed to query SEC EDGAR; emitting no data rather than mock metrics.", {
      error: err instanceof Error ? err.message : String(err)
    });
    return { filings: [], prices: [] };
  }
}
