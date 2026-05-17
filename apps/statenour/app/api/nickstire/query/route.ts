/**
 * GET /api/nickstire/query?q=<action>[&f.<key>=<value>…]
 *
 * Browser-safe proxy to the nickstire bridge (`lib/nickstire/query.ts`).
 * Client panels can't hit nickstire.org directly — the cross-origin
 * STATENOUR_SYNC_KEY header is server-only. This endpoint carries
 * the call through under the current owner session.
 *
 * Graceful degradation:
 *   · Unknown action on nickstire     → returns 200 with body
 *                                        `{ data: null, error: "..." }`
 *     (NOT 4xx — clients pattern-match on error text for
 *      "unknown / not implemented" to render the "connecting"
 *      state instead of a noisy error card.)
 *   · Network failure                  → 502 with error string
 *   · Missing STATENOUR_SYNC_KEY      → 500 (misconfiguration)
 *
 * Query-string filter format: anything after `?q=X` gets parsed as
 * the filters object. Prefix filter keys with `f.` to distinguish
 * from the reserved `q`. Example:
 *   /api/nickstire/query?q=revenue_range&f.from=2026-04-01&f.to=2026-04-07
 */
import { apiHandler } from "@/lib/utils/http";
import { queryNick } from "@/lib/nickstire/query";
import { ServiceError } from "@/lib/utils/service-error";

export const GET = apiHandler(
  async (req) => {
    const url = new URL(req.url);
    const q = url.searchParams.get("q")?.trim();
    if (!q) throw new ServiceError("missing ?q=<action>", 400);

    const filters: Record<string, string> = {};
    for (const [key, value] of url.searchParams.entries()) {
      if (key === "q") continue;
      if (key.startsWith("f.")) filters[key.slice(2)] = value;
    }

    const result = await queryNick(q, filters);

    // queryNick returns { data, query, timestamp } OR { error }.
    // Both shapes pass through as-is — the client differentiates by
    // looking for `.error` vs `.data`.
    return result;
  },
  { auth: "owner" },
);
