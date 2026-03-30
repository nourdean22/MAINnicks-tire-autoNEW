import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { ForbiddenError } from "@shared/_core/errors";
import { parse as parseCookieHeader } from "cookie";
import type { Request } from "express";
import { SignJWT, jwtVerify } from "jose";
import type { User } from "../../drizzle/schema";
import * as db from "../db";

// Utility function
const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

export type SessionPayload = {
  openId: string;
  appId: string;
  name: string;
};

/**
 * Google OAuth service — exchanges authorization code for tokens,
 * then fetches user profile from Google's userinfo endpoint.
 */
class GoogleOAuthService {
  private clientId: string;
  private clientSecret: string;

  constructor() {
    this.clientId = process.env.GOOGLE_OAUTH_CLIENT_ID ?? "";
    this.clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "";

    if (!this.clientId || !this.clientSecret) {
      console.error(
        "[OAuth] ERROR: GOOGLE_OAUTH_CLIENT_ID or GOOGLE_OAUTH_CLIENT_SECRET is not configured!"
      );
    }
  }

  /**
   * Exchange authorization code for Google access token
   */
  async exchangeCodeForToken(
    code: string,
    redirectUri: string
  ): Promise<{ accessToken: string }> {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Google token exchange failed: ${response.status} ${errorText}`);
    }

    const data = (await response.json()) as { access_token: string };
    return { accessToken: data.access_token };
  }

  /**
   * Fetch Google user profile using access token
   */
  async getUserInfo(accessToken: string): Promise<{
    openId: string;
    name: string;
    email: string;
    loginMethod: string;
  }> {
    const response = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      throw new Error(`Google userinfo failed: ${response.status}`);
    }

    const data = (await response.json()) as {
      id: string;
      name: string;
      email: string;
    };

    return {
      openId: `google:${data.id}`,
      name: data.name,
      email: data.email,
      loginMethod: "google",
    };
  }
}

class SDKServer {
  private readonly oauthService: GoogleOAuthService;

  constructor() {
    this.oauthService = new GoogleOAuthService();
  }

  /**
   * Exchange Google OAuth authorization code for access token
   */
  async exchangeCodeForToken(
    code: string,
    redirectUri: string
  ): Promise<{ accessToken: string }> {
    return this.oauthService.exchangeCodeForToken(code, redirectUri);
  }

  /**
   * Get user information using Google access token
   */
  async getUserInfo(accessToken: string) {
    return this.oauthService.getUserInfo(accessToken);
  }

  private parseCookies(cookieHeader: string | undefined) {
    if (!cookieHeader) {
      return new Map<string, string>();
    }
    const parsed = parseCookieHeader(cookieHeader);
    return new Map(Object.entries(parsed));
  }

  private getSessionSecret() {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error("JWT_SECRET environment variable is required — refusing to sign with empty secret");
    }
    return new TextEncoder().encode(secret);
  }

  /**
   * Create a session token for a user
   */
  async createSessionToken(
    openId: string,
    options: { expiresInMs?: number; name?: string } = {}
  ): Promise<string> {
    return this.signSession(
      {
        openId,
        appId: "nickstire",
        name: options.name || "",
      },
      options
    );
  }

  async signSession(
    payload: SessionPayload,
    options: { expiresInMs?: number } = {}
  ): Promise<string> {
    const issuedAt = Date.now();
    const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1000);
    const secretKey = this.getSessionSecret();

    return new SignJWT({
      openId: payload.openId,
      appId: payload.appId,
      name: payload.name,
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setExpirationTime(expirationSeconds)
      .sign(secretKey);
  }

  async verifySession(
    cookieValue: string | undefined | null
  ): Promise<{ openId: string; appId: string; name: string } | null> {
    if (!cookieValue) {
      return null;
    }

    try {
      const secretKey = this.getSessionSecret();
      const { payload } = await jwtVerify(cookieValue, secretKey, {
        algorithms: ["HS256"],
      });
      const { openId, appId, name } = payload as Record<string, unknown>;

      if (
        !isNonEmptyString(openId) ||
        !isNonEmptyString(appId) ||
        !isNonEmptyString(name)
      ) {
        return null;
      }

      return { openId, appId, name };
    } catch {
      return null;
    }
  }

  async authenticateRequest(req: Request): Promise<User> {
    const cookies = this.parseCookies(req.headers.cookie);
    const sessionCookie = cookies.get(COOKIE_NAME);
    const session = await this.verifySession(sessionCookie);

    if (!session) {
      throw ForbiddenError("Invalid session cookie");
    }

    const sessionUserId = session.openId;
    let user = await db.getUserByOpenId(sessionUserId);

    if (!user) {
      throw ForbiddenError("User not found");
    }

    await db.upsertUser({
      openId: user.openId,
      lastSignedIn: new Date(),
    });

    return user;
  }
}

export const sdk = new SDKServer();
