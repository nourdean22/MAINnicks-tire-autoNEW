/**
 * Shop action handlers — cross-system calls to nickstire.org via tRPC.
 *
 * Extracted VERBATIM from lib/ai/nick-agent.ts executeAction (2026-06-02
 * structural split). The callNickstire HTTP client (+ NICKSTIRE_API /
 * BRIDGE_KEY constants) moved here too — these shop handlers were its
 * only callers. Byte-identical move; no behavior change.
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
import type { ActionParams, ActionResult } from "./types";

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

/**
 * Build the ActionResult for a bridge call, carrying the REASON on failure.
 *
 * `success: false` alone is not enough. Four surfaces exist to tell the operator
 * WHY an action failed and all of them read `ActionResult.error`:
 * lib/tools/guardian.ts:134 (which writes it into approvalRequest.resultPayload),
 * lib/ai/receipts/action-receipt.ts:188, lib/ai/chat/action-result-verifier.ts:118,
 * and lib/ai/nick-agent.ts:192. While `success` was hardcoded-true by `!!res`
 * those branches were dead; correcting the flag makes them live, so they have to
 * be handed something better than "unknown error". Every sibling action module
 * (task-actions, camera-actions, google-actions) already populates `error`.
 *
 * The `??` fallback is load-bearing: isBridgeError(null) is true, but
 * `null?.error` is undefined, which would reintroduce "unknown error" for
 * exactly the null case.
 */
function bridgeResult(action: string, res: unknown): ActionResult {
  const failed = isBridgeError(res);
  return {
    action,
    success: !failed,
    result: res,
    error: failed
      ? String((res as { error?: unknown } | null)?.error ?? "nickstire bridge unavailable")
      : undefined,
  };
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

export async function handleShopGetLabor(params: ActionParams, type: string): Promise<ActionResult> {
  const res = await callNickstire("autoLabor.estimate", { service: String(params.service || ""), vehicleYear: params.year ? Number(params.year) : undefined, vehicleMake: params.make ? String(params.make) : undefined, vehicleModel: params.model ? String(params.model) : undefined });
  return bridgeResult(type, res);
}

export async function handleShopGetLeads(params: ActionParams, type: string): Promise<ActionResult> {
  const res = await callNickstire("lead.list", { limit: Number(params.limit ?? 10) });
  return bridgeResult(type, res);
}

export async function handleShopUpdateLead(params: ActionParams, type: string): Promise<ActionResult> {
  const res = await callNickstire("lead.update", { id: Number(params.id), status: params.status ? String(params.status) : undefined, notes: params.notes ? String(params.notes) : undefined });
  return bridgeResult(type, res);
}

export async function handleShopGetEstimates(params: ActionParams, type: string): Promise<ActionResult> {
  const res = await callNickstire("estimates.list", { limit: Number(params.limit ?? 10) });
  return bridgeResult(type, res);
}

export async function handleShopGetCustomers(params: ActionParams, type: string): Promise<ActionResult> {
  const res = await callNickstire("customers.list", { limit: Number(params.limit ?? 10), search: params.search ? String(params.search) : undefined });
  return bridgeResult(type, res);
}

export async function handleShopSendSms(params: ActionParams, type: string): Promise<ActionResult> {
  const res = await callNickstire("smsBot.send", { phone: String(params.phone || ""), message: String(params.message || "") });
  return bridgeResult(type, res);
}

export async function handleShopGetBookings(params: ActionParams, type: string): Promise<ActionResult> {
  const res = await callNickstire("booking.list", { limit: Number(params.limit ?? 10) });
  return bridgeResult(type, res);
}

export async function handleShopShopStatus(params: ActionParams, type: string): Promise<ActionResult> {
  const res = await callNickstire("shopStatus.current", {});
  return bridgeResult(type, res);
}

export async function handleShopGetRevenue(params: ActionParams, type: string): Promise<ActionResult> {
  const res = await callNickstire("controlCenter.revenue", { period: String(params.period || "today") });
  return bridgeResult(type, res);
}
