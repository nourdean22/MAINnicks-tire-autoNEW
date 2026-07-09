import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("intelligence/connector/dealscouting");

export interface ListedDeal {
  title: string;
  location: string;
  listingPrice: number;
  type: string; // "commercial_property" | "automotive_business"
  link: string;
  description: string;
  notes: string;
}

/**
 * AG-02 · Fabrication purge. This connector previously invented Cleveland /
 * Lakewood property listings (with fake crexi/loopnet URLs) whenever the
 * real-estate API key was absent — which it always is — and those fed the
 * daily brief as live M&A deals. Unavailable data is EMPTY, never mocked.
 */
export async function fetchListedDeals(): Promise<ListedDeal[]> {
  const realEstateApiKey = process.env.REAL_ESTATE_API_KEY;
  if (!realEstateApiKey) {
    log.info("REAL_ESTATE_API_KEY not configured; emitting no deals rather than mock listings.");
    return [];
  }

  // Real listing API integration not yet implemented; return empty until it is.
  return [];
}
