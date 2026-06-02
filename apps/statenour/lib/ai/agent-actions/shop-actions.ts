/**
 * Shop action handlers — cross-system calls to nickstire.org via tRPC.
 *
 * Extracted VERBATIM from lib/ai/nick-agent.ts executeAction (2026-06-02
 * structural split). The callNickstire HTTP client (+ NICKSTIRE_API /
 * BRIDGE_KEY constants) moved here too — these shop handlers were its
 * only callers. Byte-identical move; no behavior change.
 */
import type { ActionParams, ActionResult } from "./types";

// ─── Cross-System HTTP Client ────────────────────────────

const NICKSTIRE_API = process.env.NICKS_ADMIN_URL || "https://nickstire.org";
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
    const url = `${NICKSTIRE_API}/trpc/${procedure}`;
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
  return { action: type, success: !!res, result: res };
}

export async function handleShopGetLeads(params: ActionParams, type: string): Promise<ActionResult> {
  const res = await callNickstire("lead.list", { limit: Number(params.limit ?? 10) });
  return { action: type, success: !!res, result: res };
}

export async function handleShopUpdateLead(params: ActionParams, type: string): Promise<ActionResult> {
  const res = await callNickstire("lead.update", { id: Number(params.id), status: params.status ? String(params.status) : undefined, notes: params.notes ? String(params.notes) : undefined });
  return { action: type, success: !!res, result: res };
}

export async function handleShopGetEstimates(params: ActionParams, type: string): Promise<ActionResult> {
  const res = await callNickstire("estimates.list", { limit: Number(params.limit ?? 10) });
  return { action: type, success: !!res, result: res };
}

export async function handleShopGetCustomers(params: ActionParams, type: string): Promise<ActionResult> {
  const res = await callNickstire("customers.list", { limit: Number(params.limit ?? 10), search: params.search ? String(params.search) : undefined });
  return { action: type, success: !!res, result: res };
}

export async function handleShopSendSms(params: ActionParams, type: string): Promise<ActionResult> {
  const res = await callNickstire("smsBot.send", { phone: String(params.phone || ""), message: String(params.message || "") });
  return { action: type, success: !!res, result: res };
}

export async function handleShopGetBookings(params: ActionParams, type: string): Promise<ActionResult> {
  const res = await callNickstire("booking.list", { limit: Number(params.limit ?? 10) });
  return { action: type, success: !!res, result: res };
}

export async function handleShopShopStatus(params: ActionParams, type: string): Promise<ActionResult> {
  const res = await callNickstire("shopStatus.current", {});
  return { action: type, success: !!res, result: res };
}

export async function handleShopGetRevenue(params: ActionParams, type: string): Promise<ActionResult> {
  const res = await callNickstire("controlCenter.revenue", { period: String(params.period || "today") });
  return { action: type, success: !!res, result: res };
}
