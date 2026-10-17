/**
 * Pure helpers for reading Langfuse through `GET /api/public/v2/observations`.
 *
 * Langfuse Cloud stops serving the legacy `GET /api/public/traces` and
 * `GET /api/public/observations` on 2026-11-16. The v2 route has no page
 * numbers and no `totalItems`: it pages by `meta.cursor`, and a field comes
 * back only if its `fields` group was requested (default `core,basic`).
 */

/**
 * @param {{ since: string, until: string, fields?: string[], level?: string,
 *           limit?: number, environment?: string, cursor?: string|null }} a
 * @returns {string} path relative to `/api/public`
 */
export function buildObservationsPath(a) {
  const q = new URLSearchParams();
  q.set("fromStartTime", a.since);
  q.set("toStartTime", a.until);
  q.set("limit", String(a.limit ?? 100));
  if (a.fields?.length) q.set("fields", a.fields.join(","));
  if (a.level) q.set("level", a.level);
  if (a.environment) q.set("environment", a.environment);
  if (a.cursor) q.set("cursor", a.cursor);
  return `/v2/observations?${q.toString()}`;
}

/**
 * Follow `meta.cursor` until it is absent or the page cap is hit.
 * `complete` is true ONLY when the cursor ran out with no failure: a capped or
 * failed read is a lower bound, never the whole population.
 * @param {(cursor?: string) => Promise<{ok:true,json:any}|{ok:false,status:number,body:string}>} fetchPage
 * @param {{ maxPages: number }} opts
 * @returns {Promise<{ rows: any[], complete: boolean, failure: {status:number,body:string}|null }>}
 */
export async function collectPages(fetchPage, { maxPages }) {
  const rows = [];
  let cursor;
  for (let i = 0; i < maxPages; i++) {
    const res = await fetchPage(cursor);
    if (!res.ok) return { rows, complete: false, failure: { status: res.status, body: res.body } };
    rows.push(...(res.json?.data ?? []));
    cursor = res.json?.meta?.cursor || undefined;
    if (!cursor) return { rows, complete: true, failure: null };
  }
  return { rows, complete: false, failure: null };
}

/**
 * Observations -> one entry per trace, shaped for `traceIdentity()`
 * ({ name, metadata, tags }). Needs `fields` to include `trace_context`
 * (traceName, tags) and `metadata`; an unrequested group reads as absent.
 * @param {ReadonlyArray<any>} observations
 */
export function groupByTrace(observations) {
  const byId = new Map();
  for (const o of observations) {
    if (!o?.traceId) continue;
    const t = byId.get(o.traceId) ?? { traceId: o.traceId, name: "", metadata: null, tags: [] };
    if (!t.name && typeof o.traceName === "string") t.name = o.traceName;
    if (!t.metadata && o.metadata && typeof o.metadata === "object" && Object.keys(o.metadata).length) {
      t.metadata = o.metadata;
    }
    if (!t.tags.length && Array.isArray(o.tags)) t.tags = o.tags;
    byId.set(o.traceId, t);
  }
  return [...byId.values()];
}
