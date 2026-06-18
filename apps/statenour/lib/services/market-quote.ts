import { logger } from "@/lib/logger";

const log = logger.withSurface("services/market-quote");

export interface QuoteResult {
  symbol: string;
  priceCents: number | null;
  source: string | null;
}

/**
 * Fetches the latest close price for a symbol from Stooq — the same free,
 * keyless source `ultron-ticker` already uses (proven reachable from the
 * server). Tries a US-equity suffix first, then a crypto-USD form, then the
 * bare symbol. Returns `priceCents: null` when no candidate resolves so the
 * caller can leave the stored price untouched and flag the symbol.
 */
export async function fetchQuoteCents(rawSymbol: string): Promise<QuoteResult> {
  const symbol = rawSymbol.trim().toLowerCase();
  if (!symbol) return { symbol: rawSymbol, priceCents: null, source: null };

  // Stooq ticker candidates: US equity (aapl.us), crypto-USD (btcusd), bare.
  const candidates = [`${symbol}.us`, `${symbol}usd`, symbol];

  for (const candidate of candidates) {
    const close = await fetchStooqClose(candidate);
    if (close !== null) {
      return { symbol: rawSymbol, priceCents: Math.round(close * 100), source: `stooq:${candidate}` };
    }
  }
  return { symbol: rawSymbol, priceCents: null, source: null };
}

async function fetchStooqClose(stooqSymbol: string): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const url = `https://stooq.com/q/l/?s=${encodeURIComponent(stooqSymbol)}&f=sd2t2ohlcv&h&e=csv`;
    const res = await fetch(url, { signal: controller.signal, next: { revalidate: 300 } });
    if (!res.ok) return null;
    const text = await res.text();
    const lines = text.trim().split("\n");
    if (lines.length < 2) return null;
    // Row: Symbol,Date,Time,Open,High,Low,Close,Volume
    const close = Number(lines[1].split(",")[6]);
    // Stooq returns "N/D" (-> NaN) for unknown symbols.
    if (!Number.isFinite(close) || close <= 0) return null;
    return close;
  } catch (e) {
    log.warn("stooq_quote_failed", { symbol: stooqSymbol, error: String(e) });
    return null;
  } finally {
    clearTimeout(timer);
  }
}
