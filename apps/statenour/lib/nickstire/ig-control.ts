/**
 * Client for nickstire's Instagram control route (Q-13).
 *
 * The two IG actions that mutate (a run that can publish live, and the
 * live-posting switch) no longer ride the /api/nour-os/query bridge: they need
 * their own key, NOUR_OS_IG_CONTROL_KEY, set to the same value on both apps.
 * There is deliberately no fallback to STATENOUR_SYNC_KEY — the sync key alone
 * must not be able to post to the shop's Instagram.
 *
 * ONE attempt, never retried. queryNick retries on a timeout or a 5xx, and an
 * autopost run takes minutes: a client timeout does not stop the server-side
 * run, so each retry started another one, and on a live run that is another
 * public post. A timeout here is reported as "outcome unknown", not a failure.
 */

export type IgControlAction = "autopost_run" | "autopost_set_config";

export type IgControlResult =
  | { data: unknown; action: IgControlAction; timestamp: string }
  | { error: string; statusCode?: number; outcomeUnknown?: boolean };

// A generate → render → evaluate run can take several minutes on the shop side.
const DEFAULT_TIMEOUT_MS = 5 * 60_000;

export async function controlNickIg(
  action: IgControlAction,
  filters: Record<string, unknown> = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<IgControlResult> {
  const url = process.env.NICKSTIRE_URL || process.env.NICKS_ADMIN_URL || "https://nickstire.org";
  const key = process.env.NOUR_OS_IG_CONTROL_KEY || "";
  if (!key) {
    return { error: "Instagram control is not configured: NOUR_OS_IG_CONTROL_KEY is unset." };
  }

  let res: Response;
  try {
    res = await fetch(`${url}/api/nour-os/ig-control`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-ig-control-key": key },
      body: JSON.stringify({ action, filters }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    // The request may have reached the shop and still be running there.
    const isTimeout = e instanceof Error && e.name === "TimeoutError";
    return {
      error: isTimeout
        ? `Instagram ${action} timed out after ${Math.round(timeoutMs / 1000)}s; it may still be running. Check the autopost status before retrying.`
        : `Instagram ${action} did not get a reply: ${e instanceof Error ? e.message : String(e)}. Check the autopost status before retrying.`,
      outcomeUnknown: true,
    };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { error: `HTTP ${res.status}: ${body.slice(0, 300)}`, statusCode: res.status };
  }
  return (await res.json()) as IgControlResult;
}
