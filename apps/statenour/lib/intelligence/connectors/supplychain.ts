import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("intelligence/connector/supplychain");

export interface CommodityMetric {
  name: string;
  symbol: string;
  price: number;
  changePercent24h: number;
  unit: string;
}

export interface SupplyChainAlert {
  title: string;
  severity: string;
  impactDescription: string;
  actionRecommendation: string;
}

export interface SupplyChainData {
  metrics: CommodityMetric[];
  alerts: SupplyChainAlert[];
}

/**
 * AG-02 · Fabrication purge. This connector previously returned invented
 * rubber/steel/freight prices (with fabricated 24h swings that in turn
 * generated fake "pre-order now" alerts) whenever COMMODITY_API_KEY was
 * absent — which it always is. Unavailable data is EMPTY, never mocked.
 */
export async function fetchSupplyChainMetrics(): Promise<SupplyChainData> {
  const apiKey = process.env.COMMODITY_API_KEY;
  if (!apiKey) {
    log.info("COMMODITY_API_KEY not configured; emitting no commodity data rather than mock prices.");
    return { metrics: [], alerts: [] };
  }

  try {
    const res = await fetch(`https://api.commodityprices.com/v1/latest?symbols=RUBBER,STEEL,FREIGHT&api_key=${apiKey}`, {
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) {
      throw new Error(`Commodity API error ${res.status}`);
    }

    // Response parsing not yet implemented; return empty until it is.
    return { metrics: [], alerts: [] };
  } catch (err) {
    log.warn("Commodity API fetch failed; emitting no data rather than mock prices.", {
      error: err instanceof Error ? err.message : String(err)
    });
    return { metrics: [], alerts: [] };
  }
}
