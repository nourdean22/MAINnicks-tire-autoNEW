/**
 * Forward one cron tick to statenour-web over HTTP and read what the job reported.
 * Split from scheduler.ts (2026-10-10) so it carries no render-loop imports: a
 * statenour test loads it without building @nour/reel-engine.
 */
export const STATENOUR_WEB_URL = (process.env.STATENOUR_WEB_URL ?? "").trim();
export const CRON_SECRET = (process.env.CRON_SECRET ?? "").trim();
// Hard ceiling per cron fire · prevents a stuck handler from hanging
// the worker process · the handler itself has its own timeout, this
// is just a belt-and-suspenders.
const FORWARD_TIMEOUT_MS = 60_000;

/**
 * The `data` of statenour's API envelope (`{ ok, data, meta }`, apiHandler in
 * apps/statenour/lib/utils/http.ts). A body without an envelope is read as the data
 * itself; a failed envelope (`ok: false`) has none. Never throws.
 */
export function readApiData(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const b = body as Record<string, unknown>;
  if ("meta" in b && b.ok === false) return undefined;
  return "data" in b ? b.data : b;
}

/**
 * What a 200 forward actually reported. statenour wraps a cron's return value as
 * `{ ok: true, data: <result> }` (apiHandler in apps/statenour/lib/utils/http.ts),
 * so HTTP 200 proves only that the route answered: a kill-switched job
 * (`skipped: true`), a feature-off skip (`skipped: "<reason>"`) and the job's own
 * `ok: false` all arrive as 200. A body without `data` is read as the result itself.
 */
export function readForwardBody(text: string): {
  outcome: "ok" | "skipped" | "failed" | "unreadable";
  detail: string;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { outcome: "unreadable", detail: "body is not JSON" };
  }
  const isObj = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === "object" && !Array.isArray(v);
  const data = isObj(parsed) && "data" in parsed ? parsed.data : parsed;
  if (!isObj(data)) return { outcome: "ok", detail: "" };
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.slice(0, 200) : null);
  if (data.ok === false) {
    return { outcome: "failed", detail: str(data.reason) ?? str(data.error) ?? "handler returned ok:false" };
  }
  if (str(data.skipped) || data.skipped === true) {
    return { outcome: "skipped", detail: str(data.skipped) ?? str(data.reason) ?? "skipped" };
  }
  const n = data.resultCount;
  return { outcome: "ok", detail: typeof n === "number" && Number.isInteger(n) ? `resultCount=${n}` : "" };
}

/**
 * Fire a single cron handler via HTTP. Returns true when the job ran ok or
 * chose to skip; false on a transport failure, a non-2xx, the job's own
 * `ok:false`, or a body that cannot be read.
 * Never throws · logs structured errors so /system/errors can pick
 * them up via the statenour-web side · worker continues regardless.
 */
export async function forwardCronToWeb(name: string): Promise<boolean> {
  if (!STATENOUR_WEB_URL) {
    console.error(
      `[scheduler] STATENOUR_WEB_URL not set · cannot forward ${name} · ` +
        `skipping. Set it to https://statenour-web.railway.internal in Railway env.`,
    );
    return false;
  }
  const url = `${STATENOUR_WEB_URL}/api/cron/${name}`;
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FORWARD_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${CRON_SECRET}`,
        "User-Agent": "statenour-worker/1.0 (railway)",
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error(
        `[scheduler] forward FAIL · ${name} · status=${res.status} · ${Date.now() - startedAt}ms`,
      );
      return false;
    }
    const { outcome, detail } = readForwardBody(await res.text());
    const durationMs = Date.now() - startedAt;
    if (outcome === "failed") {
      console.error(`[scheduler] forward REPORTED FAILURE · ${name} · ok:false · ${detail} · ${durationMs}ms`);
      return false;
    }
    if (outcome === "skipped") {
      console.warn(`[scheduler] forward SKIPPED · ${name} · ${detail} · ${durationMs}ms`);
      return true;
    }
    if (outcome === "unreadable") {
      console.warn(`[scheduler] forward 200 UNREADABLE · ${name} · ${detail} · ${durationMs}ms`);
      return false;
    }
    console.log(`[scheduler] forward OK · ${name} · ${durationMs}ms${detail ? ` · ${detail}` : ""}`);
    return true;
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const msg =
      err instanceof Error && err.name === "AbortError"
        ? `timeout after ${FORWARD_TIMEOUT_MS}ms`
        : err instanceof Error
        ? err.message.slice(0, 200)
        : String(err).slice(0, 200);
    console.error(`[scheduler] forward EXCEPTION · ${name} · ${durationMs}ms · ${msg}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}
