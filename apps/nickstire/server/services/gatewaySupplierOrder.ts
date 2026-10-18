/**
 * D&K (Gateway Tire) supplier ordering: the HTTP calls and the mapping, nothing else.
 * The order flow, the DB claim and the flag live in routers/gatewayOrder.ts.
 *
 * Every call goes through gatewayFetch (bearer + the browser-shaped headers D&K requires).
 * Shapes come from the b2b.dktire.com portal bundle (2026-10-18), not from documentation:
 *   - POST cart/add-to-saved-cart  body: [{ ...item.pricing_data[0], num, total, ship_to }]
 *   - GET  cart/list-cart          [{ ship_to, site_level_prepay, customer_level_prepay,
 *                                     items: [{ ship_from, customer_po_number, customer_po_prefix,
 *                                               items: [{ _id, dk_part_number, display_name, num,
 *                                                         quantity, selling_price, ... }] }] }]
 *   - POST cart/update-cart-after-listing  body: that cart (the portal saves PO edits this way)
 *   - POST order/on-submit-order   body: { ax_order: cart } (+ payment_obj only with a stored card)
 *   - DELETE cart/delete-items-in-cart?cart_id=<line _id>
 * The PO lives on the ship_from group, so a group is ours only when its PO is ours.
 * Never cart/save-cart-data([]): in the portal that is the "Empty Cart" button.
 */
import { createHash } from "node:crypto";
import { createLogger } from "../lib/logger";
import { gatewayFetch, getGatewayToken, invalidateGatewaySession } from "./gatewayClient";

const log = createLogger("services:gatewaySupplierOrder");

const TIMEOUT_MS = 10_000;

type Json = Record<string, unknown>;
export interface CartLine { id: string; partNumber: string; description: string; quantity: number; available: number | null; unitCostCents: number; poNumber: string; siteId: string | null }
interface CartShipTo extends Json { items: CartGroup[] }
interface CartGroup extends Json { customer_po_number?: unknown; items: Json[] }

type DkRead<T> = { ok: true; value: T } | { ok: false; detail: string };
type SubmitOutcome =
  | { kind: "placed"; body: unknown }
  | { kind: "rejected"; detail: string } // D&K said no: nothing was ordered
  | { kind: "uncertain"; detail: string }; // D&K may have ordered: never retry

export const poNumberFor = (orderNumber: string): string => `online order ${orderNumber}`;

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const cents = (dollars: unknown): number => Math.round((num(dollars) ?? 0) * 100);

/** D&K's "detail" / "statusMessage" text, safe to show the admin (never the token: it is a header). */
async function detailOf(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as Json;
    return str(body.detail) || str(body.statusMessage) || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

async function call(method: string, path: string, body?: unknown): Promise<Response | null> {
  return gatewayFetch(path, {
    method,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** A GET, with one re-login and retry on 401. Writes never come through here. */
async function read(path: string): Promise<DkRead<unknown>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await call("GET", path);
    if (!res) return { ok: false, detail: "D&K did not answer" };
    if (res.status === 401 && attempt === 0) {
      invalidateGatewaySession();
      continue;
    }
    if (!res.ok) {
      log.warn(`${path.split("?")[0]} -> ${res.status}`);
      return { ok: false, detail: await detailOf(res) };
    }
    try {
      return { ok: true, value: await res.json() };
    } catch {
      return { ok: false, detail: "D&K answered with something that is not JSON" };
    }
  }
  return { ok: false, detail: "D&K refused the login twice" };
}

/** A POST/DELETE that must answer { status: "Success" }. Never retried. */
async function write(method: "POST" | "DELETE", path: string, body?: unknown): Promise<DkRead<Json>> {
  const res = await call(method, path, body);
  if (!res) return { ok: false, detail: "D&K did not answer" };
  if (!res.ok) {
    if (res.status === 401) invalidateGatewaySession();
    log.warn(`${path.split("?")[0]} -> ${res.status}`);
    return { ok: false, detail: await detailOf(res) };
  }
  try {
    const parsed = (await res.json()) as Json;
    if (str(parsed?.status) !== "Success") return { ok: false, detail: str(parsed?.statusMessage) || str(parsed?.detail) || "D&K did not confirm" };
    return { ok: true, value: parsed };
  } catch {
    return { ok: false, detail: "D&K answered with something that is not JSON" };
  }
}

// ── Mapping ─────────────────────────────────────────────────────────

/** The portal's quick-add body: the item's first pricing row, with quantity, line total and ship-to. */
export function buildAddToCartBody(item: Json, quantity: number, shipTo: string): Json[] {
  const pricing = Array.isArray(item.pricing_data) ? (item.pricing_data[0] as Json | undefined) : undefined;
  const unit = num(pricing?.selling_price) ?? 0;
  return [{ ...(pricing ?? {}), num: quantity, total: Math.round(quantity * unit * 100) / 100, ship_to: shipTo }];
}

/** Normalise list-cart: an array body, or { data: [...] }. Anything else is not a cart. */
function asCart(body: unknown): CartShipTo[] | null {
  const arr = Array.isArray(body) ? body : Array.isArray((body as Json | null)?.data) ? ((body as Json).data as unknown[]) : null;
  if (!arr) return null;
  return arr
    .filter((t): t is Json => typeof t === "object" && t !== null)
    .map((t) => ({
      ...t,
      items: (Array.isArray(t.items) ? t.items : [])
        .filter((g): g is Json => typeof g === "object" && g !== null)
        .map((g) => ({ ...g, items: (Array.isArray(g.items) ? g.items : []).filter((l): l is Json => typeof l === "object" && l !== null) })),
    }));
}

/** Split the cart into this order's lines (group PO equals ours) and everyone else's. */
export function splitCart(cart: CartShipTo[], po: string): { ours: CartLine[]; foreign: CartLine[] } {
  const ours: CartLine[] = [];
  const foreign: CartLine[] = [];
  for (const top of cart) {
    for (const group of top.items) {
      const groupPo = str(group.customer_po_number);
      for (const l of group.items) {
        const line: CartLine = {
          id: str(l._id),
          partNumber: str(l.dk_part_number),
          description: str(l.display_name),
          quantity: num(l.num) ?? 0,
          available: num(l.quantity),
          unitCostCents: cents(l.selling_price),
          poNumber: groupPo,
          siteId: str(l.site_id) || null,
        };
        (groupPo === po ? ours : foreign).push(line);
      }
    }
  }
  return { ours, foreign };
}

/** Set our PO on every group in the cart (the caller has proven the cart holds only our lines). */
export function withPo(cart: CartShipTo[], po: string): CartShipTo[] {
  return cart.map((top) => ({ ...top, items: top.items.map((g) => ({ ...g, customer_po_number: po })) }));
}

/** sha256 of what will be ordered: part, quantity, PO and unit cost per line, in a stable order. */
export function cartTokenFor(lines: CartLine[]): string {
  const canon = lines
    .map((l) => ({ part: l.partNumber, qty: l.quantity, po: l.poNumber, unitCostCents: l.unitCostCents }))
    .sort((a, b) => a.part.localeCompare(b.part) || a.qty - b.qty);
  return createHash("sha256").update(JSON.stringify(canon)).digest("hex");
}

const REF_KEY = /^(order_?(no|num|number|id)|sales_?order(_?(no|number|id))?|ax_?order_?(no|number|id)|invoice_?(no|num|number|id)|po_?(no|num|number)|reference|ref)$/i;

/** The D&K order reference: the first named order/invoice/PO field, else the JSON cut to 100 chars. */
export function extractOrderRef(body: unknown): string {
  const seen = new Set<unknown>();
  const walk = (v: unknown): string | null => {
    if (typeof v !== "object" || v === null || seen.has(v)) return null;
    seen.add(v);
    for (const [k, val] of Object.entries(v as Json)) {
      const s = str(val);
      if (REF_KEY.test(k) && s && s.length <= 100) return s;
    }
    for (const val of Object.values(v as Json)) {
      const found = walk(val);
      if (found) return found;
    }
    return null;
  };
  return walk(body) ?? JSON.stringify(body ?? null).slice(0, 100);
}

// ── Calls ───────────────────────────────────────────────────────────

export async function readCart(shipTo: string): Promise<DkRead<CartShipTo[]>> {
  const q = new URLSearchParams({ ship_to: shipTo, global_ship_to: shipTo }).toString();
  const r = await read(`/cart/list-cart?${q}`);
  if (!r.ok) return r;
  const cart = asCart(r.value);
  return cart ? { ok: true, value: cart } : { ok: false, detail: "D&K cart came back in an unknown shape" };
}

export async function addToCart(body: Json[]): Promise<DkRead<Json>> {
  // Keys, not values: enough for the first live run to compare with a real portal request.
  log.debug("add-to-saved-cart request keys", { keys: Object.keys(body[0] ?? {}).sort() });
  return write("POST", "/cart/add-to-saved-cart", body);
}

export async function saveCart(cart: CartShipTo[]): Promise<DkRead<Json>> {
  return write("POST", "/cart/update-cart-after-listing", cart);
}

export async function deleteCartLine(lineId: string): Promise<DkRead<Json>> {
  return write("DELETE", `/cart/delete-items-in-cart?${new URLSearchParams({ cart_id: lineId }).toString()}`);
}

/** The site's next cut-off, or null when D&K does not say (advisory only). */
export async function readCutoff(shipTo: string, siteId: string | null): Promise<string | null> {
  const r = await read(`/master/get-cut-off-time?${new URLSearchParams({ global_ship_to: shipTo }).toString()}`);
  if (!r.ok) return null;
  const list = (r.value as Json | null)?.cutofftime;
  if (!Array.isArray(list)) return null;
  const entry = (list as Json[]).find((e) => siteId !== null && str(e?.site_id) === siteId) ?? (list[0] as Json | undefined);
  return str(entry?.cut_off_time) || str(entry?.cutoff_time) || null;
}

/**
 * POST order/on-submit-order. Called once; the caller holds the claim. Only a definite "no"
 * (4xx, or 2xx without status Success) is "rejected": a timeout, a network error, a 5xx or an
 * unreadable 2xx may have placed the order and is "uncertain".
 */
export async function submitOrder(cart: CartShipTo[]): Promise<SubmitOutcome> {
  // gatewayFetch also answers null when there is no token, and then NOTHING reached D&K: that is a
  // plain "no", never "uncertain" (which parks the order and raises an incident).
  if (!(await getGatewayToken())) return { kind: "rejected", detail: "D&K login is unavailable right now; nothing was sent" };
  const res = await call("POST", "/order/on-submit-order", { ax_order: cart });
  if (!res) return { kind: "uncertain", detail: "D&K did not answer (timeout or network error)" };
  if (res.status >= 500) {
    log.warn(`on-submit-order -> ${res.status}`);
    return { kind: "uncertain", detail: `D&K answered HTTP ${res.status}` };
  }
  if (!res.ok) {
    if (res.status === 401) invalidateGatewaySession();
    log.warn(`on-submit-order -> ${res.status}`);
    return { kind: "rejected", detail: await detailOf(res) };
  }
  let body: Json;
  try {
    body = (await res.json()) as Json;
  } catch {
    return { kind: "uncertain", detail: "D&K answered 2xx with something that is not JSON" };
  }
  log.info("on-submit-order response keys", { keys: Object.keys(body ?? {}).sort(), data: Object.keys((body?.data as Json) ?? {}).sort() });
  if (str(body.status) !== "Success") return { kind: "rejected", detail: str(body.statusMessage) || str(body.detail) || "D&K did not confirm the order" };
  return { kind: "placed", body };
}
