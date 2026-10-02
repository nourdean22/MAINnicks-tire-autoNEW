/**
 * lib/services/telegram-webhook-status.ts · 2026-10-02
 *
 * Where does Telegram send the bot's updates? Measured 2026-10-02: the bot
 * SENDS fine (morning/afternoon/evening pushes and briefs land), but Railway
 * http logs show zero requests to /api/telegram/webhook or
 * /api/telegram/revenue-decision-callback since at least 2026-09-25 (positive
 * control: /api/version on the same filter returned this afternoon's hits).
 * Every rating button (oc:u|n), journal link button and message to the bot
 * therefore lands somewhere other than this app — and 160 proactive pushes +
 * 114 daily briefs carry zero ratings.
 *
 * This asks Telegram (getWebhookInfo, read-only) from the server, so the token
 * never leaves it, and classifies the answer. Unknown is never healthy: no
 * token, a failed call, or an unparseable answer each have their own state.
 */

export const TELEGRAM_WEBHOOK_PATH = "/api/telegram/webhook";

export type TelegramWebhookState =
  | "registered" // points at this app's webhook route
  | "elsewhere" // a URL is registered, but not this app's route
  | "unregistered" // no webhook URL (updates queue for getUpdates polling, which nothing here runs)
  | "unconfigured" // no TELEGRAM_BOT_TOKEN on this service
  | "unreadable"; // the call failed or Telegram answered ok:false

export interface TelegramWebhookStatus {
  state: TelegramWebhookState;
  /** host + path of the registered URL (never a query string). */
  url: string | null;
  expected: string;
  pendingUpdates: number | null;
  lastError: string | null;
  lastErrorAt: string | null;
  reason?: string;
}

function expectedHosts(): Set<string> {
  const hosts = new Set(["bdnick.info", "www.bdnick.info", "statenour-web-production.up.railway.app"]);
  const base = process.env.APP_BASE_URL?.trim();
  if (base) {
    try {
      hosts.add(new URL(base).host);
    } catch {
      /* malformed override — ignore */
    }
  }
  return hosts;
}

/** Pure classifier — exported for tests. */
export function classifyWebhook(rawUrl: string): { state: "registered" | "elsewhere" | "unregistered"; url: string | null } {
  if (!rawUrl) return { state: "unregistered", url: null };
  try {
    const u = new URL(rawUrl);
    const shown = `${u.host}${u.pathname}`;
    const ours = expectedHosts().has(u.host) && u.pathname.replace(/\/+$/, "") === TELEGRAM_WEBHOOK_PATH;
    return { state: ours ? "registered" : "elsewhere", url: shown };
  } catch {
    return { state: "elsewhere", url: rawUrl.slice(0, 120) };
  }
}

export async function getTelegramWebhookStatus(
  fetchImpl: typeof fetch = fetch,
): Promise<TelegramWebhookStatus> {
  const expected = `bdnick.info${TELEGRAM_WEBHOOK_PATH}`;
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const base = { url: null, expected, pendingUpdates: null, lastError: null, lastErrorAt: null };
  if (!token) return { ...base, state: "unconfigured", reason: "TELEGRAM_BOT_TOKEN is not set on this service" };

  let body: {
    ok?: boolean;
    description?: string;
    result?: { url?: string; pending_update_count?: number; last_error_message?: string; last_error_date?: number };
  };
  try {
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/getWebhookInfo`, {
      signal: AbortSignal.timeout(5_000),
    });
    body = (await res.json()) as typeof body;
  } catch (err) {
    // Never echo the error object: a fetch error message can carry the URL, and the URL carries the token.
    return { ...base, state: "unreadable", reason: err instanceof Error && err.name === "TimeoutError" ? "Telegram did not answer in 5 s" : "request to Telegram failed" };
  }
  if (!body?.ok || !body.result) {
    return { ...base, state: "unreadable", reason: (body?.description ?? "Telegram answered without a result").slice(0, 200) };
  }
  const r = body.result;
  const { state, url } = classifyWebhook(r.url ?? "");
  return {
    state,
    url,
    expected,
    pendingUpdates: typeof r.pending_update_count === "number" ? r.pending_update_count : null,
    lastError: r.last_error_message ? r.last_error_message.slice(0, 200) : null,
    lastErrorAt: typeof r.last_error_date === "number" ? new Date(r.last_error_date * 1000).toISOString() : null,
  };
}
