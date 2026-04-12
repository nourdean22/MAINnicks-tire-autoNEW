import { COOKIE_NAME, THIRTY_DAYS_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

export function registerOAuthRoutes(app: Express) {
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
      res.redirect(302, dest);
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.redirect(302, "/admin?error=auth_failed");
    }
  });
}
