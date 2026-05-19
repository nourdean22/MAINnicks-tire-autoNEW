import { COOKIE_NAME, THIRTY_DAYS_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import { randomBytes, timingSafeEqual } from "crypto";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";

import { createLogger } from "../lib/logger";

const log = createLogger("_core:oauth");

// wave-181.71 (chip #1) · OAuth state CSRF protection.
//
// Pre-fix · the Google OAuth callback at /api/oauth/callback validated
// the authorization code but NOT the `state` parameter. Classic OAuth
// CSRF attack: attacker initiates OAuth with their Google account,
// captures the callback URL with their code, tricks victim into
// clicking it. Victim's browser hits /api/oauth/callback?code=... ·
// server exchanges code for ATTACKER's user info · sets session
// cookie binding victim to attacker's account. Victim does work
// believing they're themselves but operating as the attacker.
//
// Fix · /api/oauth/initiate mints a 32-byte random state, sets it in
// a short-lived HTTP-only cookie, redirects to Google with the state
// param. /api/oauth/callback extracts state from query + from the
// cookie, validates via timingSafeEqual, clears the cookie after.
//
// Cookie TTL: 10 minutes (Google's OAuth flow typically completes in
// under a minute · 10min covers slow networks + 2FA prompts).
const OAUTH_STATE_COOKIE = "oauth_state";
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function generateOAuthState(): string {
  return randomBytes(32).toString("hex");
}
function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Dev-only sign-in route. Mints a real session cookie (signed by JWT_SECRET,
 * same as Google OAuth flow) for the OWNER_OPEN_ID user. Works on localhost
 * so developers can preview /admin without real Google OAuth.
 *
 * HARD-GATED by NODE_ENV !== "production". Returns 404 in prod so the route
 * doesn't even exist there.
 */
function registerDevSigninRoute(app: Express) {
  if (process.env.NODE_ENV === "production") return;

  app.get("/api/dev/signin", async (req: Request, res: Response) => {
    try {
      const ownerOpenId = process.env.OWNER_OPEN_ID;
      if (!ownerOpenId) {
        res.status(500).send("OWNER_OPEN_ID not set — cannot dev sign in");
        return;
      }

      // Ensure the user exists (upsert matches production OAuth flow)
      await db.upsertUser({
        openId: ownerOpenId,
        name: "Local Dev (Owner)",
        email: process.env.ADMIN_EMAIL || null,
        loginMethod: "dev-signin",
        lastSignedIn: new Date(),
      });

      const existing = await db.getUserByOpenId(ownerOpenId);
      if (!existing) {
        res.status(500).send("Failed to upsert dev user");
        return;
      }

      // Mint a real session token — same path as OAuth callback
      const sessionToken = await sdk.createSessionToken(ownerOpenId, {
        name: existing.name || "Dev Owner",
        expiresInMs: THIRTY_DAYS_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: THIRTY_DAYS_MS });

      // Redirect to where they wanted to go, defaulting to /admin.
      // wave-181.66 (bug-hunter pass 3) · `startsWith("/")` alone allowed
      // protocol-relative URLs like `//evil.com` which browsers treat as
      // origin-changing redirects. This route is DEV-ONLY (gated by
      // NODE_ENV !== "production" above) so the prod risk is zero, but
      // defense-in-depth is cheap: reject anything starting with `//`
      // or containing `\\` (Windows-style traversal that some Node
      // versions normalize). Also bound length to prevent log-flooding.
      const next = typeof req.query.next === "string" ? req.query.next : "";
      const isSafeRelativePath =
        next.length > 0 &&
        next.length < 500 &&
        next.startsWith("/") &&
        !next.startsWith("//") &&
        !next.includes("\\");
      const dest = isSafeRelativePath ? next : "/admin";
      res.redirect(302, dest);
    } catch (err) {
      log.error("[DevSignin] Failed:", err);
      res.status(500).send(`Dev signin failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  });

  log.warn(
    "\n⚠ [dev-signin] /api/dev/signin is active — dev only. Never enabled in production.\n"
  );
}

export function registerOAuthRoutes(app: Express) {
  registerDevSigninRoute(app);

  // wave-181.71 · OAuth INITIATION endpoint. Mints a fresh state token,
  // sets it in an HTTP-only short-TTL cookie, redirects to Google with
  // state attached. The callback at /api/oauth/callback validates both
  // the query-string state and the cookie state match. This is the
  // standard OAuth 2.0 CSRF protection per RFC 6749 §10.12.
  app.get("/api/oauth/initiate", (req: Request, res: Response) => {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    if (!clientId) {
      res.status(500).json({ error: "GOOGLE_OAUTH_CLIENT_ID not configured" });
      return;
    }

    const state = generateOAuthState();
    const cookieOptions = getSessionCookieOptions(req);
    res.cookie(OAUTH_STATE_COOKIE, state, {
      ...cookieOptions,
      maxAge: OAUTH_STATE_TTL_MS,
    });

    const proto = (req.headers["x-forwarded-proto"] as string)?.split(",")[0]?.trim() || req.protocol;
    const redirectUri = `${proto}://${req.get("host")}/api/oauth/callback`;

    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("state", state);

    res.redirect(302, url.toString());
  });

  // Google OAuth callback
  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");

    if (!code) {
      res.status(400).json({ error: "Authorization code is required" });
      return;
    }

    // wave-181.71 · validate CSRF state · query state must match the
    // cookie we set during /api/oauth/initiate. Both must be present;
    // both must be equal under timingSafeEqual. Mismatch indicates a
    // forged callback URL (CSRF attack) and we reject before exchanging
    // the auth code.
    const queryState = getQueryParam(req, "state");
    const cookieState = typeof req.headers.cookie === "string"
      ? req.headers.cookie.split(/;\s*/).find((c) => c.startsWith(`${OAUTH_STATE_COOKIE}=`))?.slice(OAUTH_STATE_COOKIE.length + 1)
      : undefined;
    // Clear the cookie immediately — it's single-use, regardless of validation outcome
    res.clearCookie(OAUTH_STATE_COOKIE, getSessionCookieOptions(req));

    if (!queryState || !cookieState) {
      log.warn("[OAuth] state parameter missing — rejecting callback", {
        hasQueryState: !!queryState,
        hasCookieState: !!cookieState,
      });
      res.status(400).json({ error: "state parameter required" });
      return;
    }
    if (queryState.length !== cookieState.length ||
        !timingSafeEqual(Buffer.from(queryState), Buffer.from(cookieState))) {
      log.warn("[OAuth] state mismatch — possible CSRF · rejecting callback");
      res.status(400).json({ error: "state mismatch" });
      return;
    }

    try {
      // Build the redirect URI — respect x-forwarded-proto behind Railway proxy
      const proto = (req.headers["x-forwarded-proto"] as string)?.split(",")[0]?.trim() || req.protocol;
      const redirectUri = `${proto}://${req.get("host")}/api/oauth/callback`;

      const tokenResponse = await sdk.exchangeCodeForToken(code, redirectUri);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);

      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }

      // Upsert user — admin role auto-granted in db.ts if openId matches OWNER_OPEN_ID
      await db.upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? null,
        lastSignedIn: new Date(),
      });

      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: THIRTY_DAYS_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: THIRTY_DAYS_MS });

      // Redirect to admin if user has admin role, otherwise homepage
      const freshUser = await db.getUserByOpenId(userInfo.openId);
      const dest = freshUser?.role === "admin" ? "/admin" : "/";

      // Compliance: record admin login for audit trail (IP, UA, email).
      if (freshUser?.role === "admin" && userInfo.email) {
        import("../services/complianceLog").then(({ logAdminLogin }) =>
          logAdminLogin({
            email: userInfo.email ?? "unknown",
            openId: userInfo.openId,
            ipAddress: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || null,
            userAgent: req.headers["user-agent"] ?? null,
          }),
        ).catch((err) => log.warn("[OAuth] admin login log failed:", err));

        // 2026-05-05 — Trigger an ALG probe on admin login. This is the
        // ONLY automatic probe trigger besides the 3 AM overnight job.
        // Fire-and-forget — don't block the login redirect on it. The
        // probe budget will dedup if a recent probe already happened.
        //
        // Wave-100 (2026-05-08) — chain customer_metrics refresh after
        // the probe lands. ALG probes can pull new invoices/estimates;
        // we want the materialized declined/backlog aggregates to
        // reflect them before the operator opens the customers admin.
        // Operator's directive: "make it on login because [the cron]
        // logs them out when the system logs into alg" — moved off the
        // cron tier into login-triggered to avoid extra ALG sessions.
        import("../services/algProbeBudget").then(async ({ requestAlgProbe }) => {
          await requestAlgProbe("admin_login", { detail: userInfo.email ?? undefined });
          // Probe done (or deduped) — refresh metrics from local DB.
          // No ALG hit, just SUM/COUNT joins; <500ms typical.
          try {
            const { refreshCustomerMetrics } = await import("../services/customerMetricsRefresh");
            const result = await refreshCustomerMetrics();
            log.info(`[OAuth] post-login metrics refresh: ${result.customersUpdated} rows · ${result.durationMs}ms`);
          } catch (err) {
            log.warn("[OAuth] post-login metrics refresh failed:", err);
          }
        }).catch((err) => log.warn("[OAuth] alg login-probe failed:", err));
      }

      res.redirect(302, dest);
    } catch (error) {
      log.error("[OAuth] Callback failed", error);
      import("../services/complianceLog").then(({ logAdminLoginFail }) =>
        logAdminLoginFail({
          reason: error instanceof Error ? error.message : String(error),
          ipAddress: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || null,
          userAgent: req.headers["user-agent"] ?? null,
        }),
      ).catch((logErr) => {
        // v1.7 audit fix · pre-fix this swallowed the compliance log
        // failure entirely. If the DB is down or the schema drifted,
        // a failed admin login was never recorded — security audit
        // gap. Now logs the failure (without breaking the auth flow).
        log.warn("[OAuth] logAdminLoginFail failed:", logErr);
      });
      res.redirect(302, "/admin?error=auth_failed");
    }
  });
}
