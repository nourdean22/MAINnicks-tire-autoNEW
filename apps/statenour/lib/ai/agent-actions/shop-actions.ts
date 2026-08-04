/**
 * The nickstire cross-system HTTP client.
 *
 * Was "shop action handlers"; the nine handleShop* handlers were DELETED
 * 2026-08-03 (see below). What remains is the client itself plus its success
 * predicate, which three other modules import directly:
 *   app/api/telegram/webhook/route.ts (two branches) · lib/inngest/functions/audit-todays-leads.ts
 *
 * 2026-08-03 · WHY THE NINE HANDLERS ARE GONE. They could not work, and had
 * never worked. Five of the nine named procedures DO NOT EXIST in nickstire —
 * autoLabor.estimate, estimates.list, shopStatus.current, controlCenter.revenue,
 * and smsBot.send (there is no smsBot router at all, verified against
 * server/routers.ts). The other four — lead.list, lead.update, customers.list,
 * booking.list — exist but are adminProcedure, and nickstire's tRPC derives
 * ctx.user ONLY from the app_session_id cookie (server/_core/sdk.ts:206), so a
 * Bearer token can never satisfy them. Every one of the nine therefore failed
 * 100% of the time; #1330 only made that failure honest instead of silent.
 * Several also sent inputs the target would have discarded (lead.list and
 * booking.list declare no .input() at all).
 *
 * Every capability they nominally provided is ALREADY reachable over a surface
 * that actually authenticates — leads, revenue, estimates, customers, bookings
 * and shop pulse all have live handlers on POST /api/nour-os/query (x-sync-key),
 * several of which the agent already calls today.
 *
 * NOT deleted, deliberately: the name "shop.sendSms" survives in the tool
 * registry and the write-classification lists, because lib/ai/tools/social.ts
 * still stamps PENDING ActionReceipt rows with it and audit-todays-leads still
 * writes it as an approval toolId. The NAME labels real pending work even
 * though execution is gone; removing the classification would leave a
 * high-risk label unclassified.
 *
 * 2026-08-03 · TRANSPORT TRUTH. Two independent defects made every call
 * through this client fail while REPORTING SUCCESS:
 *
 *   1. Path. The client built `${origin}/trpc/<proc>`, but nickstire mounts
 *      tRPC at `/api/trpc` (server/_core/index.ts:499). NICKS_ADMIN_URL also
 *      carries a trailing `/admin` in statenour's own accessor (lib/env.ts:208),
 *      so the URL was wrong twice. An unrouted path hits nickstire's SPA
 *      catch-all (server/_core/vite.ts:214), which answers 200 with HTML — so
 *      `res.ok` was TRUE, `res.json()` then threw on `<`, and the catch below
 *      turned it into `{ error }`.
 *   2. Auth. nickstire's tRPC derives `ctx.user` ONLY from the `app_session_id`
 *      session cookie (server/_core/sdk.ts:206); it never reads Authorization.
 *      Every procedure targeted here is `adminProcedure` (e.g. lead.list —
 *      routers/lead.ts:305), so a Bearer token cannot authenticate. BRIDGE_API_KEY
 *      gates `x-bridge-key` on REST `/api/bridge/*` only (bridge-routes.ts:119).
 *
 * The path is fixed below, which turns a cryptic HTML parse error into an
 * honest 403. THE AUTH IS DELIBERATELY NOT FIXED: minting a synthetic admin
 * from one shared static secret would hand every router's adminProcedure —
 * publishPost, approveDraft, campaigns.send — to a single env var. Restoring
 * these capabilities is a design decision, not a patch.
 *
 * Callers MUST therefore treat every result as possibly-failed. callNickstire
 * RESOLVES (never rejects) to a truthy `{ error }` object on all failure paths,
 * so `!!res` is always true and is never a success test. Use `isBridgeError`.
 *
 * Working surfaces, for anything being ported off this client:
 *   - REST  `/api/bridge/*`      · header `x-bridge-key` · lib/services/bridge.ts
 *   - Query `/api/nour-os/query` · header `x-sync-key`   · lib/nickstire/query.ts
 */
// ActionParams/ActionResult are gone with the handlers — this module is now
// purely the cross-system HTTP client.

// ─── Cross-System HTTP Client ────────────────────────────

// Prefer NICKSTIRE_URL (the origin) exactly as lib/nickstire/query.ts:11 does.
// NICKS_ADMIN_URL is the ADMIN url and may carry a trailing `/admin`, which
// would target `/admin/api/trpc` — strip it to recover the server origin.
const NICKSTIRE_API = (
  process.env.NICKSTIRE_URL ||
  process.env.NICKS_ADMIN_URL ||
  "https://nickstire.org"
)
  .replace(/\/+$/, "")
  .replace(/\/admin$/, "");

/**
 * The ONLY correct success test for a callNickstire result.
 *
 * Nine handlers in this file used `!!res`, which is true for the `{ error }`
 * object the client returns on every failure — so a dead bridge reported
 * `success: true` with an error payload as its result. The same mistake in
 * the Telegram approve branch wrote SUCCESS action receipts for SMS that was
 * never sent (app/api/telegram/webhook/route.ts).
 */
export function isBridgeError(res: unknown): boolean {
  return !res || (typeof res === "object" && "error" in (res as object));
}

// v9.1.14 · type as `string | undefined` instead of `?? ""`. The
// previous `|| ""` pattern was caught by the env-secret bypass gate.
// Outbound calls now no-op cleanly if neither key is configured —
// safer than sending a Bearer "" header that nickstire rejects with
// a generic 401.
const BRIDGE_KEY = process.env.BRIDGE_API_KEY ?? process.env.STATENOUR_SYNC_KEY;

export async function callNickstire(procedure: string, input: Record<string, unknown>): Promise<unknown> {
  if (!BRIDGE_KEY) {
    return {
      error: "BRIDGE_API_KEY (or STATENOUR_SYNC_KEY) not configured — outbound nickstire call skipped",
    };
  }
  try {
    const url = `${NICKSTIRE_API}/api/trpc/${procedure}`;
    const isQuery = !procedure.includes("send") && !procedure.includes("update") && !procedure.includes("create");

    if (isQuery) {
      const queryInput = encodeURIComponent(JSON.stringify({ json: input }));
      const res = await fetch(`${url}?input=${queryInput}`, {
        headers: { Authorization: `Bearer ${BRIDGE_KEY}` },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return { error: `${res.status} ${res.statusText}` };
      return await res.json();
    } else {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${BRIDGE_KEY}` },
        body: JSON.stringify({ json: input }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return { error: `${res.status} ${res.statusText}` };
      return await res.json();
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "nickstire API call failed" };
  }
}