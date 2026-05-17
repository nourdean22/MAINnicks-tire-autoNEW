/**
 * Browserbase integration — G1 scaffold (inert until env keys land).
 *
 * Browserbase hosts headless Chrome in the cloud. We hit their REST
 * API directly (no SDK dependency). When `BROWSERBASE_API_KEY` +
 * `BROWSERBASE_PROJECT_ID` are set, Nick can:
 *   · Spin up sessions with a live view URL for real-time watching
 *   · Drive the browser via Stagehand-style prompts (`act`, `extract`)
 *   · Tear down sessions when done
 *
 * Without those envs every helper returns a structured "not configured"
 * error. Callers detect and degrade gracefully — no throwing.
 *
 * API reference: https://docs.browserbase.com/reference/api/overview
 */

export interface BrowserbaseConfig {
  apiKey: string;
  projectId: string;
  baseUrl: string;
}

export interface BrowserSession {
  id: string;
  status: string;
  liveViewUrl?: string;
  connectUrl?: string;
  createdAt: string;
  expiresAt?: string;
}

export interface BrowserResult<T> {
  ok: true;
  data: T;
}
export interface BrowserError {
  ok: false;
  error: string;
  code: "not_configured" | "http_error" | "network" | "invalid_response";
}

export function getConfig(): BrowserbaseConfig | null {
  const apiKey = process.env.BROWSERBASE_API_KEY ?? "";
  const projectId = process.env.BROWSERBASE_PROJECT_ID ?? "";
  if (!apiKey || !projectId) return null;
  return {
    apiKey,
    projectId,
    baseUrl: process.env.BROWSERBASE_BASE_URL ?? "https://api.browserbase.com",
  };
}

export function isConfigured(): boolean {
  return getConfig() !== null;
}

async function bbFetch<T>(path: string, init?: RequestInit): Promise<BrowserResult<T> | BrowserError> {
  const cfg = getConfig();
  if (!cfg) {
    return {
      ok: false,
      error: "BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID env vars required",
      code: "not_configured",
    };
  }
  try {
    const res = await fetch(`${cfg.baseUrl}${path}`, {
      ...init,
      headers: {
        "x-bb-api-key": cfg.apiKey,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        ok: false,
        error: `HTTP ${res.status}: ${body.slice(0, 200)}`,
        code: "http_error",
      };
    }
    const data = (await res.json()) as T;
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      code: "network",
    };
  }
}

/**
 * Create a new browser session. Returns connect URL for Playwright
 * drivers + live view URL for iframe embedding.
 */
export async function createSession(opts?: {
  keepAlive?: boolean;
  region?: "us-east-1" | "us-west-2" | "eu-central-1";
}): Promise<BrowserResult<BrowserSession> | BrowserError> {
  const cfg = getConfig();
  if (!cfg) {
    return { ok: false, error: "Browserbase not configured", code: "not_configured" };
  }
  type RawSession = {
    id: string;
    status: string;
    createdAt: string;
    expiresAt?: string;
    connectUrl?: string;
  };
  const res = await bbFetch<RawSession>("/v1/sessions", {
    method: "POST",
    body: JSON.stringify({
      projectId: cfg.projectId,
      keepAlive: opts?.keepAlive ?? false,
      region: opts?.region,
    }),
  });
  if (!res.ok) return res;
  // Build live view URL — the public debug view hosts the session preview.
  const liveViewUrl = `${cfg.baseUrl.replace("api.", "www.")}/sessions/${res.data.id}`;
  return {
    ok: true,
    data: {
      id: res.data.id,
      status: res.data.status,
      connectUrl: res.data.connectUrl,
      liveViewUrl,
      createdAt: res.data.createdAt,
      expiresAt: res.data.expiresAt,
    },
  };
}

export async function getSession(sessionId: string): Promise<BrowserResult<BrowserSession> | BrowserError> {
  return bbFetch<BrowserSession>(`/v1/sessions/${encodeURIComponent(sessionId)}`);
}

export async function closeSession(sessionId: string): Promise<BrowserResult<{ id: string; status: string }> | BrowserError> {
  return bbFetch<{ id: string; status: string }>(`/v1/sessions/${encodeURIComponent(sessionId)}`, {
    method: "POST",
    body: JSON.stringify({ projectId: getConfig()!.projectId, status: "REQUEST_RELEASE" }),
  });
}

export async function listSessions(): Promise<BrowserResult<BrowserSession[]> | BrowserError> {
  const cfg = getConfig();
  if (!cfg) return { ok: false, error: "Browserbase not configured", code: "not_configured" };
  return bbFetch<BrowserSession[]>(`/v1/sessions?projectId=${cfg.projectId}`);
}
