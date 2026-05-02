import { COOKIE_NAME, THIRTY_DAYS_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";

import { createLogger } from "../lib/logger";

const log = createLogger("_core:oauth");
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

      // Redirect to where they wanted to go, defaulting to /admin
      const dest = typeof req.query.next === "string" && req.query.next.startsWith("/")
        ? req.query.next
        : "/admin";
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

  // Google OAuth callback
  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");

    if (!code) {
      res.status(400).json({ error: "Authorization code is required" });
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
