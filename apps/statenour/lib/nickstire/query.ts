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
 * POST to a mutating nickstire bridge endpoint (e.g. /api/bridge/bulk-sms-send).
 *
 * Deliberately NOT built on queryNick()'s retry-with-backoff loop. That
 * loop is correct for read-only queries (a retried GET-shaped read is
 * idempotent) but wrong here: a timeout on a mutating endpoint is
 * ambiguous — the request may have already landed and sent real SMS —
 * so retrying could double-send. Single attempt, fail loud, let the
 * caller (and nickstire's own Telegram alert) surface the ambiguity to
 * the operator instead of silently retrying into a duplicate campaign.
 *
 * Uses the `X-Statenour-Sync-Key` header (statenourAuth middleware),
 * NOT the lowercase `x-sync-key` header queryNick() uses for
 * /api/nour-os/query — those are two different auth-checking routes.
 */
export async function postNickstireBridge<T = unknown>(
  path: string,
  body: Record<string, unknown>,
  timeoutMs = 15000,
): Promise<{ data: T } | { error: string; statusCode?: number }> {
  const { url, key } = getConfig();
  if (!key) {
    console.error("[Nickstire Bridge] CRITICAL: No sync key. Set STATENOUR_SYNC_KEY.");
    return { error: "No sync key configured." };
  }

  try {
    const res = await fetch(`${url}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Statenour-Sync-Key": key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errMsg = (json as { error?: string })?.error || `HTTP ${res.status}`;
      console.error(`[Nickstire Bridge] POST ${path} failed HTTP ${res.status}: ${errMsg}`);
      return { error: errMsg, statusCode: res.status };
    }
    return { data: json as T };
  } catch (e) {
    const isTimeout = e instanceof Error && e.name === "TimeoutError";
    console.error(
      `[Nickstire Bridge] POST ${path} ${isTimeout ? "timed out" : "crashed"} — NOT retrying (mutating endpoint, ambiguous delivery on retry):`,
      e,
    );
    return { error: e instanceof Error ? e.message : String(e) };
  }
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
