import { logger } from "@/lib/logger";

const log = logger.withSurface("services/market-quote");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export interface QuoteResult {
  symbol: string;
  priceCents: number | null;
  source: string | null;
}

/** True when a keyed quote provider is configured. */
export function hasKeyedQuoteProvider(): boolean {
  return Boolean(process.env.FINNHUB_API_KEY);
}

/**
 * Fetches the latest market price for a symbol.
 *
 * Primary source is Finnhub (keyed, free tier) — the only one that reliably
 * serves datacenter/cloud IPs like Railway. Yahoo Finance and Stooq are kept as
 * keyless fallbacks (they work off-cloud but rate-limit/IP-block cloud egress).
 * Returns `priceCents: null` when nothing resolves so the caller can leave the
 * stored price untouched and flag the symbol — prices are never silently zeroed.
 */
export async function fetchQuoteCents(rawSymbol: string): Promise<QuoteResult> {
  const symbol = rawSymbol.trim().toUpperCase();
  if (!symbol) return { symbol: rawSymbol, priceCents: null, source: null };

  const result = (priceCents: number, source: string): QuoteResult => ({ symbol: rawSymbol, priceCents, source });

  // 1. Finnhub (keyed) — reachable from cloud servers.
  const finnhubKey = process.env.FINNHUB_API_KEY;
  if (finnhubKey) {
    const price = await fetchFinnhub(symbol, finnhubKey);
    if (price !== null) return result(Math.round(price * 100), "finnhub");
  }

  // 2. Yahoo (keyless): equities as-is; crypto with a -USD suffix (BTC-USD).
  for (const candidate of [symbol, `${symbol}-USD`]) {
    const price = await fetchYahooPrice(candidate);
    if (price !== null) return result(Math.round(price * 100), `yahoo:${candidate}`);
  }

  // 3. Stooq (keyless): US equity / crypto-usd / bare.
  const lower = symbol.toLowerCase();
  for (const candidate of [`${lower}.us`, `${lower}usd`, lower]) {
    const price = await fetchStooqClose(candidate);
    if (price !== null) return result(Math.round(price * 100), `stooq:${candidate}`);
  }

  return { symbol: rawSymbol, priceCents: null, source: null };
}

async function fetchFinnhub(symbol: string, key: string): Promise<number | null> {
  return withTimeout(async (signal) => {
    const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(key)}`;
    const res = await fetch(url, { signal, next: { revalidate: 60 } });
    if (!res.ok) return null;
    // { c: current, d, dp, h, l, o, pc, t }. c === 0 means "no data for symbol".
    const json = (await res.json()) as { c?: number };
    const price = json?.c;
    return typeof price === "number" && Number.isFinite(price) && price > 0 ? price : null;
  }, symbol, "finnhub");
}

async function fetchYahooPrice(symbol: string): Promise<number | null> {
  return withTimeout(async (signal) => {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
    const res = await fetch(url, { signal, headers: { "User-Agent": UA }, next: { revalidate: 300 } });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      chart?: { result?: Array<{ meta?: { regularMarketPrice?: number } }> | null };
    };
    const price = json?.chart?.result?.[0]?.meta?.regularMarketPrice;
    return typeof price === "number" && Number.isFinite(price) && price > 0 ? price : null;
  }, symbol, "yahoo");
}

async function fetchStooqClose(stooqSymbol: string): Promise<number | null> {
  return withTimeout(async (signal) => {
    const url = `https://stooq.com/q/l/?s=${encodeURIComponent(stooqSymbol)}&f=sd2t2ohlcv&h&e=csv`;
    const res = await fetch(url, { signal, headers: { "User-Agent": UA }, next: { revalidate: 300 } });
    if (!res.ok) return null;
    const text = await res.text();
    const lines = text.trim().split("\n");
    if (lines.length < 2) return null;
    // Row: Symbol,Date,Time,Open,High,Low,Close,Volume — "N/D"/HTML -> NaN -> null.
    const close = Number(lines[1].split(",")[6]);
    return Number.isFinite(close) && close > 0 ? close : null;
  }, stooqSymbol, "stooq");
}

async function withTimeout(
  fn: (signal: AbortSignal) => Promise<number | null>,
  symbol: string,
  source: string,
): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    return await fn(controller.signal);
  } catch (e) {
    log.warn("quote_fetch_failed", { source, symbol, error: String(e) });
    return null;
  } finally {
    clearTimeout(timer);
  }
}
