/**
 * Ring W1a (2026-10-30): read-only status for Nour's 5 home Ring cameras.
 *
 * Calls Ring's REST API with plain fetch. Mechanisms copied from dgreif/ring
 * ring-client-api (MIT, rest-client.ts / ring-camera.ts) and the manager's
 * research (scratchpad ring-perplexity-2026-10-30.md); the library itself is not
 * imported (it pulls WebRTC and ffmpeg tooling for a status poll).
 *
 *  - The token is ONE base64 config { rt, hid, pnc? }; the whole value is
 *    persisted, with compare-and-swap, BEFORE the new access token is used.
 *  - hid (hardware id) is stable: a new one registers a new "authorized device".
 *  - A failed refresh keeps the stored token and backs off; it never re-auths.
 *  - alerts.connection is the only connection signal: online / offline / UNKNOWN.
 *  - A failed Ring read writes NO camera status; it lands in poller health, and
 *    the statenour sentinel flips silent rows OFFLINE after 20 min.
 *  - Unknown Ring devices are reported, never created (PATCH only, 404 = unknown).
 * Read-only: no command, video or event path exists here.
 */
import { randomUUID } from "node:crypto";

export interface AuthConfig {
  rt: string;
  hid?: string;
  pnc?: unknown;
}

export interface TokenVault {
  read(): Promise<string | null>;
  swap(expected: string | null, next: string): Promise<boolean>;
  lock(owner: string, ttlMs: number): Promise<boolean>;
  unlock(owner: string): Promise<void>;
}

export interface RingPollerEnv {
  seed: string;
  userAgent: string;
  webUrl: string;
  deviceKey: string;
}

export type RingConnection = "ONLINE" | "OFFLINE" | "UNKNOWN";

export interface PollOutcome {
  ok: boolean;
  skipped?: "backoff" | "locked";
  patched: number;
  unknown: string[];
  error?: string;
}

export interface PollerHealth {
  lastOkAt: number | null;
  lastError: string | null;
  consecutiveFailures: number;
  backoffUntil: number;
}

const OAUTH_URL = "https://oauth.ring.com/oauth/token";
const CLIENT_API = "https://api.ring.com/clients_api/";
export const DEFAULT_RING_USER_AGENT = "android:com.ringapp";
const LOCK_TTL_MS = 5 * 60_000;
const SESSION_RENEW_MS = 12 * 60 * 60_000;
const ACCESS_SLACK_MS = 60_000;
const BACKOFF_BASE_MS = 15 * 60_000;
const BACKOFF_MAX_MS = 2 * 60 * 60_000;

export function parseAuthConfig(raw: string): AuthConfig {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64").toString("utf8")) as AuthConfig;
    if (parsed && typeof parsed.rt === "string") return parsed;
  } catch {
    /* a bare refresh token, not a wrapped config */
  }
  return { rt: raw };
}

export function encodeAuthConfig(config: AuthConfig): string {
  return Buffer.from(JSON.stringify(config)).toString("base64");
}

export function connectionStatus(device: { alerts?: { connection?: unknown } }): RingConnection {
  const c = device.alerts?.connection;
  return c === "online" ? "ONLINE" : c === "offline" ? "OFFLINE" : "UNKNOWN";
}

const REQUIRED_ENV = ["REDIS_URL", "RING_TOKEN_KEY", "DEVICE_AGENT_KEY", "STATENOUR_WEB_URL"] as const;

/** Off unless RING_POLL_ENABLED is exactly "1" and every variable the poller needs is set. */
export function ringPollEnabled(env: Record<string, string | undefined>): boolean {
  return env.RING_POLL_ENABLED === "1" && REQUIRED_ENV.every((k) => (env[k] ?? "").trim() !== "");
}

type RingDevice = { id: number | string; description?: string; alerts?: { connection?: unknown }; battery_life?: unknown; firmware_version?: unknown };

export function createRingPoller(opts: {
  vault: TokenVault;
  env: RingPollerEnv;
  fetchImpl?: typeof fetch;
  now?: () => number;
  newId?: () => string;
}) {
  const doFetch = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  const newId = opts.newId ?? randomUUID;
  const { env } = opts;
  const health: PollerHealth = { lastOkAt: null, lastError: null, consecutiveFailures: 0, backoffUntil: 0 };
  let access: { token: string; expiresAt: number; hid: string } | null = null;
  let sessionAt = 0;

  function fail(error: string, retryAfterMs = 0): PollOutcome {
    health.consecutiveFailures++;
    health.lastError = error;
    const backoff = Math.min(BACKOFF_BASE_MS * 2 ** (health.consecutiveFailures - 1), BACKOFF_MAX_MS);
    health.backoffUntil = now() + Math.max(backoff, retryAfterMs);
    console.warn(`[ring] poll failed (${health.consecutiveFailures} in a row): ${error}`);
    return { ok: false, patched: 0, unknown: [], error };
  }

  function retryAfterMs(res: Response): number {
    const s = Number(res.headers.get("retry-after"));
    return Number.isFinite(s) && s > 0 ? s * 1000 : 0;
  }

  /** A valid access token, refreshing (and persisting the rotation first) when needed. */
  async function ensureAccess(): Promise<{ ok: true } | { ok: false; outcome: PollOutcome }> {
    if (access && now() < access.expiresAt - ACCESS_SLACK_MS) return { ok: true };
    const stored = await opts.vault.read();
    const raw = stored ?? (env.seed.trim() || null);
    if (!raw) return { ok: false, outcome: fail("no Ring token stored and no RING_REFRESH_TOKEN_SEED") };
    const config = parseAuthConfig(raw);
    const hid = config.hid ?? newId();
    const res = await doFetch(OAUTH_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "2fa-support": "true",
        "2fa-code": "",
        hardware_id: hid,
        "user-agent": env.userAgent,
      },
      body: JSON.stringify({ client_id: "ring_official_android", scope: "client", grant_type: "refresh_token", refresh_token: config.rt }),
    });
    if (!res.ok) return { ok: false, outcome: fail(`token refresh HTTP ${res.status}`, retryAfterMs(res)) };
    const body = (await res.json()) as { access_token?: string; expires_in?: number; refresh_token?: string };
    if (!body.access_token) return { ok: false, outcome: fail("token refresh returned no access_token") };
    const next = encodeAuthConfig({ ...config, hid, rt: body.refresh_token ?? config.rt });
    if (!(await opts.vault.swap(stored, next))) {
      return { ok: false, outcome: fail("token changed under this poller; rotation not used") };
    }
    // The session is renewed on its own 12 h clock, not on every hourly token refresh.
    access = { token: body.access_token, expiresAt: now() + (body.expires_in ?? 3600) * 1000, hid };
    return { ok: true };
  }

  async function ringApi(path: string, init: RequestInit = {}): Promise<Response> {
    return doFetch(CLIENT_API + path, {
      ...init,
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${access!.token}`,
        hardware_id: access!.hid,
        "user-agent": env.userAgent,
      },
    });
  }

  async function tick(): Promise<PollOutcome> {
    const auth = await ensureAccess();
    if (!auth.ok) return auth.outcome;
    if (now() - sessionAt > SESSION_RENEW_MS) {
      const s = await ringApi("session", {
        method: "POST",
        body: JSON.stringify({ device: { hardware_id: access!.hid, metadata: { api_version: 11, device_model: "nour-os" }, os: "android" } }),
      });
      if (!s.ok) return fail(`session HTTP ${s.status}`, retryAfterMs(s));
      sessionAt = now();
    }
    const res = await ringApi("ring_devices");
    if (res.status === 401) access = null; // next tick refreshes from the stored token
    if (!res.ok) return fail(`ring_devices HTTP ${res.status}`, retryAfterMs(res));
    const data = (await res.json()) as Record<string, RingDevice[] | undefined>;
    const cameras = [...(data.doorbots ?? []), ...(data.authorized_doorbots ?? []), ...(data.stickup_cams ?? [])];

    const seenAt = new Date(now()).toISOString();
    let patched = 0;
    let errors = 0;
    const unknown: string[] = [];
    for (const cam of cameras) {
      const platformId = `ring-${cam.id}`;
      const r = await doFetch(`${env.webUrl}/api/devices/${encodeURIComponent(platformId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-sync-key": env.deviceKey },
        body: JSON.stringify({
          status: connectionStatus(cam),
          lastSeenAt: seenAt,
          // Merged server-side: other writers own other fields (snapshotUrl).
          currentStateMerge: {
            connection: typeof cam.alerts?.connection === "string" ? cam.alerts.connection : null,
            battery: cam.battery_life ?? null,
            firmware: cam.firmware_version ?? null,
          },
        }),
      });
      if (r.status === 404) unknown.push(platformId);
      else if (r.ok) patched++;
      else errors++;
    }
    if (unknown.length) console.warn(`[ring] ${unknown.length} Ring device(s) have no row; not created: ${unknown.join(", ")}`);
    if (errors) return fail(`${errors} of ${cameras.length} status writes to bdnick failed`);
    health.consecutiveFailures = 0;
    health.lastError = null;
    health.backoffUntil = 0;
    health.lastOkAt = now();
    return { ok: true, patched, unknown };
  }

  return {
    async pollOnce(): Promise<PollOutcome> {
      if (now() < health.backoffUntil) return { ok: false, skipped: "backoff", patched: 0, unknown: [] };
      const owner = randomUUID(); // lease owner; opts.newId is reserved for the hardware id
      let locked = false;
      try {
        // Inside the try: Redis down must resolve as a failure, never reject into the worker.
        locked = await opts.vault.lock(owner, LOCK_TTL_MS);
        if (!locked) return { ok: false, skipped: "locked", patched: 0, unknown: [] };
        return await tick();
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      } finally {
        if (locked) await opts.vault.unlock(owner).catch(() => undefined);
      }
    },
    health(): PollerHealth {
      return { ...health };
    },
  };
}
