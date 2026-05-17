/**
 * Nickstire Query Client (Karpathy Mode)
 *
 * Provides a rigorous, fault-tolerant bridge for all data interactions between
 * Nour OS and nickstire.org. Replaces naive fetching with exponential backoff,
 * explicit failure telemetry, and strict configuration bounds to ensure power
 * stability across domains.
 */

const getConfig = () => {
  const url = process.env.NICKSTIRE_URL || process.env.NICKS_ADMIN_URL || "https://nickstire.org";
  const key = process.env.STATENOUR_SYNC_KEY || process.env.BRIDGE_API_KEY || "";
  return { url, key };
};

// Rigorous network stability parameters
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 300;

// v10.0.331 · contract-drift de-duplication. The bridge replies with
// "Unknown query" for actions the nickstire side hasn't shipped yet
// (per NICKSTIRE-QUERY-CONTRACT.md "Newly required" section). We log
// the FIRST occurrence per process at warn level so server-boot logs
// surface the gap, but suppress repeats (the chat HUD polls every 30s
// and was flooding the dev console).
const warnedUnknownQueries = new Set<string>();
function warnUnknownQueryOnce(query: string) {
  if (warnedUnknownQueries.has(query)) return;
  warnedUnknownQueries.add(query);
  console.warn(
    `[Nickstire Bridge] Unknown query "${query}" · suppressing further logs · ` +
    `nickstire-side action is pending per NICKSTIRE-QUERY-CONTRACT.md`,
  );
}

/**
 * Halts execution for a specified duration (promisified setTimeout).
 */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function queryNick<T = unknown>(
  query: string,
  filters: Record<string, unknown> = {},
  timeoutMs = 12000,
): Promise<{ data: T; query: string; timestamp: string } | { error: string; statusCode?: number }> {
  const { url, key } = getConfig();
  if (!key) {
    console.error("[Nickstire Bridge] CRITICAL: No sync key. Set STATENOUR_SYNC_KEY.");
    return { error: "No sync key configured." };
  }

  let attempt = 0;
  
  while (attempt <= MAX_RETRIES) {
    try {
      const startTime = Date.now();
      const res = await fetch(`${url}/api/nour-os/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-sync-key": key },
        body: JSON.stringify({ query, filters }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      const duration = Date.now() - startTime;
      
      if (!res.ok) {
        const errorText = await res.text().catch(() => "Unknown body");
        const isTransient = [408, 429, 500, 502, 503, 504].includes(res.status);

        if (isTransient && attempt < MAX_RETRIES) {
          attempt++;
          const backoff = BASE_BACKOFF_MS * Math.pow(2, attempt) + Math.random() * 100;
          console.warn(`[Nickstire Bridge] Transient error HTTP ${res.status}. Retrying in ${Math.round(backoff)}ms (Attempt ${attempt}/${MAX_RETRIES})`);
          await sleep(backoff);
          continue;
        }

        // v10.0.331 · "Unknown query" 400s are EXPECTED while the
        // nickstire side incrementally rolls out actions per the
        // contract (e.g. leads_open · leads_overdue_count · quotes_*).
        // Downgrade those to debug-level so they don't flood the
        // operator's chat-page logs every 30s. Real errors (genuine
        // 4xx/5xx with non-Unknown-query body) still land in console.error.
        const isUnknownQuery = res.status === 400 && /Unknown query/i.test(errorText);
        if (isUnknownQuery) {
          // One-time-per-process log so contract drift is still visible
          // to a human reading server boot logs, but not to every poll.
          warnUnknownQueryOnce(query);
        } else {
          console.error(`[Nickstire Bridge] Failed HTTP ${res.status} after ${attempt} retries: ${errorText}`);
        }
        return { error: `HTTP ${res.status}: ${errorText}`, statusCode: res.status };
      }

      if (duration > 1500) {
        console.warn(`[Nickstire Bridge] ⚠️ Slow cross-domain query: '${query}' took ${duration}ms`);
      }

      const json = await res.json();
      return json;
      
    } catch (e) {
      const isTimeout = e instanceof Error && e.name === "TimeoutError";
      if ((isTimeout || (e instanceof TypeError)) && attempt < MAX_RETRIES) {
        attempt++;
        const backoff = BASE_BACKOFF_MS * Math.pow(2, attempt) + Math.random() * 100;
        console.warn(`[Nickstire Bridge] Network/Timeout error. Retrying in ${Math.round(backoff)}ms (Attempt ${attempt}/${MAX_RETRIES})`);
        await sleep(backoff);
        continue;
      }
      
      console.error(`[Nickstire Bridge] Fatal bridge crash:`, e);
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }
  
  return { error: "Exhausted retry limits due to persistent transient failures." };
}

/** 
 * Batch multiple queries in parallel with strict structural guarantees.
 * Instead of failing silently, surfaces structured payload maps.
 */
export async function queryNickBatch(
  queries: Array<{ query: string; filters?: Record<string, unknown> }>,
): Promise<Record<string, unknown>> {
  if (!queries.length) return {};
  
  const results = await Promise.allSettled(
    queries.map(q => queryNick(q.query, q.filters))
  );
  
  const out: Record<string, unknown> = {};
  for (let i = 0; i < queries.length; i++) {
    const r = results[i];
    const qName = queries[i].query;
    
    if (r.status === "fulfilled") {
      out[qName] = r.value;
    } else {
      console.error(`[Nickstire Bridge] Batch failure for '${qName}':`, r.reason);
      out[qName] = { error: String(r.reason) };
    }
  }
  return out;
}
