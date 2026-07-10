/**
 * Google OAuth Service — refresh-token-based auth for headless
 * Gmail / Drive / Calendar ingest pipelines.
 *
 * Flow:
 *   1. Admin clicks /api/oauth/google-data/start (one-time)
 *   2. Redirected to Google consent screen with gmail.readonly +
 *      drive.readonly + calendar.readonly scopes
 *   3. Google redirects back to /api/oauth/google-data/callback
 *      with an auth code
 *   4. Callback exchanges code → refresh_token + initial access_token
 *   5. Refresh token stored in the Integration table under name
 *      "google_oauth" in config.refreshToken
 *   6. Subsequent ingest crons call getAccessToken() which uses the
 *      refresh token to mint a fresh access token (~1h TTL) and
 *      returns it for API calls
 *
 * Reuses the existing AUTH_GOOGLE_CLIENT_ID + AUTH_GOOGLE_CLIENT_SECRET
 * env vars (same OAuth client as the site admin login). The scopes
 * must be added to the OAuth consent screen in Google Cloud Console
 * before the first /start call — see SETUP.md for the exact steps.
 */

import { prisma } from "@/lib/prisma";

export const GOOGLE_DATA_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/drive.readonly",
];

/**
 * Name of the Integration row where we store the google_oauth token.
 *
 * 2026-05-27 · multi-account upgrade. Operator has TWO Gmail accounts
 * (nourdean22@gmail.com + moeseuclid@gmail.com). The pre-2026-05-27
 * design had ONE slot named "google_oauth" — the existing row holds
 * moeseuclid (currently expired, needs re-grant). To support both,
 * all helpers now accept an optional `accountKey` parameter. The
 * stored integration name becomes `google_oauth_${accountKey}` when
 * accountKey is provided · stays as "google_oauth" (legacy slot) when
 * accountKey is the literal default. The legacy slot stays as
 * moeseuclid's home so re-grant doesn't lose history; nourdean22
 * lands under "google_oauth_personal" on first connect.
 *
 * Default key "primary" maps to the legacy "google_oauth" row · so
 * code that doesn't pass an accountKey continues to read/write the
 * existing single slot (backwards compat).
 */
export const GOOGLE_INTEGRATION_NAME = "google_oauth";

/** Resolve the integration row name for a given account key.
 *  "primary" → legacy "google_oauth" (preserves existing moeseuclid row).
 *  anything else → "google_oauth_<key>". */
export function integrationNameFor(accountKey: string = "primary"): string {
  return accountKey === "primary"
    ? GOOGLE_INTEGRATION_NAME
    : `google_oauth_${accountKey}`;
}

/** Return all configured google_oauth* integration rows. The ingest
 *  cron iterates this so adding a new account just means clicking
 *  /api/oauth/google-data/start?account=<key> once. */
export async function listConfiguredAccounts(): Promise<
  Array<{ accountKey: string; integrationName: string; email: string | null }>
> {
  const rows = await prisma.integration
    .findMany({
      where: {
        OR: [
          { name: GOOGLE_INTEGRATION_NAME },
          { name: { startsWith: "google_oauth_" } },
        ],
      },
    })
    .catch(() => []);
  return rows
    .filter((r) => {
      const cfg = r.config as unknown as StoredToken | null;
      return cfg?.refreshToken;
    })
    .map((r) => {
      const cfg = r.config as unknown as StoredToken;
      const accountKey =
        r.name === GOOGLE_INTEGRATION_NAME
          ? "primary"
          : r.name.replace(/^google_oauth_/, "");
      return {
        accountKey,
        integrationName: r.name,
        email: cfg.email ?? null,
      };
    });
}

interface StoredToken {
  refreshToken: string;
  scopes: string[];
  email?: string;
  grantedAt: string;
  lastRefreshAt?: string;
  accessToken?: string;
  accessTokenExpiresAt?: number;
}

/** Read credentials from env with cleanEnv-style trim */
function getClientCreds(): { clientId: string; clientSecret: string; redirectUri: string } {
  const cleanEnv = (v: string | undefined) =>
    (v || "").replace(/\\n/g, "").replace(/\\r/g, "").trim();

  const clientId = cleanEnv(
    process.env.AUTH_GOOGLE_CLIENT_ID ||
      process.env.GOOGLE_OAUTH_CLIENT_ID ||
      process.env.GOOGLE_CLIENT_ID
  );
  const clientSecret = cleanEnv(
    process.env.AUTH_GOOGLE_CLIENT_SECRET ||
      process.env.GOOGLE_OAUTH_CLIENT_SECRET ||
      process.env.GOOGLE_CLIENT_SECRET
  );

  // Redirect URI defaults to the production origin. Override with
  // NEXTAUTH_URL or GOOGLE_OAUTH_REDIRECT_URI for preview environments.
  const origin =
    cleanEnv(process.env.GOOGLE_OAUTH_REDIRECT_URI) ||
    cleanEnv(process.env.NEXT_PUBLIC_APP_URL) ||
    cleanEnv(process.env.NEXTAUTH_URL) ||
    "https://bdnick.info";
  const redirectUri = origin.replace(/\/$/, "") + "/api/oauth/google-data/callback";

  if (!clientId || !clientSecret) {
    throw new Error(
      "Google OAuth client creds missing — set AUTH_GOOGLE_CLIENT_ID + AUTH_GOOGLE_CLIENT_SECRET in env"
    );
  }

  return { clientId, clientSecret, redirectUri };
}

/**
 * Build the consent-screen URL. Admin clicks this once to grant
 * Gmail/Drive/Calendar read access. Requests offline access so we
 * get a refresh token back.
 *
 * 2026-05-27 · multi-account · also forces `prompt=select_account
 * consent` when accountKey != "primary" so Google shows the
 * account-picker (lets the operator switch from nourdean22 to
 * moeseuclid for the second grant) AND re-mints a fresh refresh
 * token (consent prompt only).
 */
export function buildAuthUrl(state: string = "", accountKey: string = "primary"): string {
  const { clientId, redirectUri } = getClientCreds();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_DATA_SCOPES.join(" "),
    access_type: "offline",
    prompt: accountKey === "primary" ? "consent" : "select_account consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * Exchange an auth code (from the callback) for a refresh_token +
 * access_token. Stores the refresh token in the Integration table
 * so future cron runs can mint access tokens headlessly.
 */
export async function exchangeCodeForToken(
  code: string,
  accountKey: string = "primary",
): Promise<{
  accessToken: string;
  refreshToken: string;
  email?: string;
  expiresIn: number;
  integrationName: string;
}> {
  const { clientId, clientSecret, redirectUri } = getClientCreds();

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    signal: AbortSignal.timeout(10_000), // wave-181.92 · OAuth token endpoint
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google token exchange failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
    id_token?: string;
  };

  if (!data.refresh_token) {
    throw new Error(
      "Google returned no refresh_token. Revoke the existing grant at https://myaccount.google.com/permissions and retry."
    );
  }

  // Decode email from id_token (base64 JSON middle section) if present
  let email: string | undefined;
  if (data.id_token) {
    try {
      const [, payload] = data.id_token.split(".");
      const decoded = JSON.parse(Buffer.from(payload, "base64").toString("utf-8"));
      email = decoded.email;
    } catch {}
  }

  // Upsert into Integration table
  const stored: StoredToken = {
    refreshToken: data.refresh_token,
    scopes: (data.scope || "").split(" ").filter(Boolean),
    email,
    grantedAt: new Date().toISOString(),
    accessToken: data.access_token,
    accessTokenExpiresAt: Date.now() + data.expires_in * 1000,
  };

  const integrationName = integrationNameFor(accountKey);

  await prisma.integration.upsert({
    where: { name: integrationName },
    create: {
      name: integrationName,
      type: "oauth",
      enabled: true,
      status: "healthy",
      config: stored as unknown as object,
      lastSyncAt: new Date(),
    },
    update: {
      config: stored as unknown as object,
      status: "healthy",
      errorCount: 0,
      consecutiveFailures: 0,
      lastSyncAt: new Date(),
    },
  });

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    email,
    expiresIn: data.expires_in,
    integrationName,
  };
}

// Cache access tokens in-process so concurrent API calls share one
// refresh. Access tokens live 1h so cache for 55min to be safe.
// 2026-05-27 · multi-account · keyed by accountKey so caches don't
// collide across accounts.
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

/**
 * Get a fresh Google API access token using the stored refresh token.
 * Transparently refreshes when the cached access token is about to
 * expire. Throws if no refresh token has been stored yet (setup
 * flow hasn't been completed).
 */
export async function getAccessToken(accountKey: string = "primary"): Promise<string> {
  const cached = tokenCache.get(accountKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  const integrationName = integrationNameFor(accountKey);

  // Use a transaction with pg_advisory_xact_lock to prevent concurrent refresh races across processes
  return await prisma.$transaction(async (tx) => {
    // Acquire a transaction-level advisory lock.
    // 2026-07-10 fix · this was `$executeRaw\`...hashtext($1)\`, <arg>` —
    // a tagged template with the "param" tacked on via the JS comma
    // operator, so it was silently DISCARDED and `$1` reached Postgres
    // unbound → error 42P02 on every cache-miss refresh (the advisory
    // lock never actually locked, defeating the cross-process
    // anti-race it exists for). Interpolate into the template so Prisma
    // binds it as a real parameter.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`google_oauth_refresh_${accountKey}`}))`;

    const integration = await tx.integration.findUnique({
      where: { name: integrationName },
    });
    if (!integration?.config) {
      throw new Error(
        `Google OAuth not configured for account "${accountKey}". Click /api/oauth/google-data/start${accountKey === "primary" ? "" : `?account=${accountKey}`} to grant access.`
      );
    }

    const stored = integration.config as unknown as StoredToken;
    if (!stored.refreshToken) {
      throw new Error(`Google OAuth refresh token missing for account "${accountKey}".`);
    }

    // Check if another process just refreshed it and wrote it to the DB
    if (stored.accessToken && stored.accessTokenExpiresAt && stored.accessTokenExpiresAt > Date.now() + 60_000) {
      tokenCache.set(accountKey, {
        token: stored.accessToken,
        expiresAt: stored.accessTokenExpiresAt,
      });
      return stored.accessToken;
    }

    const { clientId, clientSecret } = getClientCreds();
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(10_000), // wave-181.92 · OAuth token endpoint
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: stored.refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let telemetryMsg = `Google refresh failed for "${accountKey}": ${res.status} ${text}`;
      
      if (text.includes("invalid_grant")) {
        const ageMs = Date.now() - new Date(stored.grantedAt).getTime();
        const ageDays = ageMs / 86400000;
        telemetryMsg += ` [Telemetry: token age ${ageDays.toFixed(2)} days]`;
        if (Math.abs(ageDays - 7) < 0.5) {
          telemetryMsg += ` -> WARNING: Token expired exactly around 7 days. Your GCP OAuth Consent Screen is likely in "Testing" mode! Go to GCP console and click "PUBLISH APP".`;
        }
      }

      await tx.integration
        .update({
          where: { name: integrationName },
          data: {
            status: "failed",
            errorCount: { increment: 1 },
            consecutiveFailures: { increment: 1 },
          },
        })
        .catch(() => {});
      throw new Error(telemetryMsg);
    }

    const data = (await res.json()) as { access_token: string; expires_in: number };
    const expiresAt = Date.now() + data.expires_in * 1000;

    tokenCache.set(accountKey, {
      token: data.access_token,
      expiresAt,
    });

    // Mark integration healthy on successful refresh
    await tx.integration
      .update({
        where: { name: integrationName },
        data: {
          status: "healthy",
          consecutiveFailures: 0,
          lastSyncAt: new Date(),
          config: {
            ...(stored as unknown as object),
            lastRefreshAt: new Date().toISOString(),
            accessToken: data.access_token,
            accessTokenExpiresAt: expiresAt,
          },
        },
      })
      .catch(() => {});

    return data.access_token;
  }, { timeout: 15000 });
}

/**
 * Check whether Google OAuth has been set up. Used by the setup UI
 * and the cron routes to decide whether to run or exit gracefully.
 *
 * Note: this only checks for the presence of a refresh token. It does
 * NOT verify the token is still valid — Google can revoke tokens for
 * inactivity, password changes, or user revocation, and we'd still
 * report "configured: true" until the next refresh attempt fails.
 *
 * Use getGoogleOauthStatus() for the richer health-aware view that
 * distinguishes missing/expired/stale/healthy. This function stays
 * for backwards compat with cron routes that just want a yes/no.
 */
export async function isGoogleOauthConfigured(accountKey: string = "primary"): Promise<boolean> {
  try {
    const integration = await prisma.integration.findUnique({
      where: { name: integrationNameFor(accountKey) },
    });
    if (!integration?.config) return false;
    const stored = integration.config as unknown as StoredToken;
    return !!stored.refreshToken;
  } catch {
    return false;
  }
}

/**
 * Rich health-aware status for the Google OAuth integration.
 *
 * State machine:
 *   - "missing"  : no Integration row OR no refresh token stored.
 *                  First-time setup needed — admin must click /start.
 *   - "expired"  : refresh token exists BUT a recent getAccessToken()
 *                  call failed (status="failed" or
 *                  consecutiveFailures > 0). Token was revoked or
 *                  Google rejected it — admin must re-grant.
 *   - "stale"    : refresh token exists, last sync looks healthy, but
 *                  no successful sync in > 7 days. Crons may be off.
 *   - "healthy"  : refresh token exists, last refresh succeeded, last
 *                  sync within 7 days.
 *
 * Returns enough context for the system-health card to render an
 * accurate, actionable headline ("expired — re-grant" vs "missing —
 * set up first" vs "stale — check crons").
 */
export interface GoogleOauthStatus {
  state: "missing" | "expired" | "stale" | "healthy";
  lastSyncAt: string | null;
  consecutiveFailures: number;
  email: string | null;
  /** Human-readable explanation suitable for surfacing in a card. */
  reason: string;
}

const STALE_AFTER_MS = 7 * 86400_000;

export async function getGoogleOauthStatus(): Promise<GoogleOauthStatus> {
  let integration: Awaited<ReturnType<typeof prisma.integration.findUnique>> = null;
  try {
    integration = await prisma.integration.findUnique({
      where: { name: GOOGLE_INTEGRATION_NAME },
    });
  } catch {
    return {
      state: "missing",
      lastSyncAt: null,
      consecutiveFailures: 0,
      email: null,
      reason: "Integration table unreadable — check DB connectivity",
    };
  }

  if (!integration?.config) {
    return {
      state: "missing",
      lastSyncAt: null,
      consecutiveFailures: 0,
      email: null,
      reason: "Google OAuth not configured — grant Drive/Gmail/Calendar access",
    };
  }

  const stored = integration.config as unknown as StoredToken;
  if (!stored.refreshToken) {
    return {
      state: "missing",
      lastSyncAt: integration.lastSyncAt?.toISOString() ?? null,
      consecutiveFailures: integration.consecutiveFailures ?? 0,
      email: stored.email ?? null,
      reason: "Google OAuth refresh token missing — re-grant access",
    };
  }

  const lastSyncAt = integration.lastSyncAt?.toISOString() ?? null;
  const consecutiveFailures = integration.consecutiveFailures ?? 0;
  const email = stored.email ?? null;

  // The getAccessToken() flow stamps status="failed" + bumps
  // consecutiveFailures when Google rejects the refresh token. That's
  // the strongest signal of an expired/revoked token short of trying
  // a refresh ourselves (which we don't want to do every health-check
  // pass — it'd burn quota).
  if (integration.status === "failed" || consecutiveFailures >= 3) {
    return {
      state: "expired",
      lastSyncAt,
      consecutiveFailures,
      email,
      reason:
        consecutiveFailures > 0
          ? `Refresh failed ${consecutiveFailures}× in a row — re-grant access`
          : "Last refresh failed — re-grant access",
    };
  }

  // Healthy refresh path but no recent sync → ingest crons might be
  // disabled or broken. Surface as "stale," not "expired."
  if (lastSyncAt) {
    const ageMs = Date.now() - new Date(lastSyncAt).getTime();
    if (ageMs > STALE_AFTER_MS) {
      const days = Math.floor(ageMs / 86400_000);
      return {
        state: "stale",
        lastSyncAt,
        consecutiveFailures,
        email,
        reason: `OAuth token healthy but no sync in ${days}d — check ingest crons`,
      };
    }
  }

  return {
    state: "healthy",
    lastSyncAt,
    consecutiveFailures,
    email,
    reason: "Google OAuth healthy",
  };
}
