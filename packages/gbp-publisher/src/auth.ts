import { google } from "googleapis";

export const GBP_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/business.manage"
];

export interface GbpAuthTokens {
  accessToken?: string | null;
  refreshToken?: string | null;
  expiryDate?: number | null;
}

/**
 * Generates the Google OAuth consent screen URL for Google Business Profile management.
 */
export function getAuthUrl(params: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  state?: string;
}): string {
  if (!params.clientId || !params.clientSecret || !params.redirectUri) {
    throw new Error("Missing required OAuth parameters: clientId, clientSecret, or redirectUri");
  }

  const oauth2Client = new google.auth.OAuth2(
    params.clientId,
    params.clientSecret,
    params.redirectUri
  );

  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: GBP_OAUTH_SCOPES,
    prompt: "consent", // Force to get a refresh token
    state: params.state
  });
}

/**
 * Exchanges authorization code for tokens (refresh token and access token).
 */
export async function exchangeCode(params: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
}): Promise<GbpAuthTokens> {
  if (!params.clientId || !params.clientSecret || !params.redirectUri || !params.code) {
    throw new Error("Missing required parameters for token exchange");
  }

  const oauth2Client = new google.auth.OAuth2(
    params.clientId,
    params.clientSecret,
    params.redirectUri
  );

  const { tokens } = await oauth2Client.getToken(params.code);
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiryDate: tokens.expiry_date
  };
}

/**
 * Returns a pre-authenticated OAuth2 client with auto-refresh configured.
 * Optional onTokenRefreshed callback can be used to persist newly minted tokens.
 */
export function getAuthenticatedClient(params: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  onTokenRefreshed?: (tokens: GbpAuthTokens) => void | Promise<void>;
}): any {
  if (!params.clientId || !params.clientSecret || !params.refreshToken) {
    throw new Error("Missing credentials (clientId, clientSecret, or refreshToken) to build authenticated client");
  }

  const oauth2Client = new google.auth.OAuth2(
    params.clientId,
    params.clientSecret
  );

  oauth2Client.setCredentials({
    refresh_token: params.refreshToken
  });

  if (params.onTokenRefreshed) {
    oauth2Client.on("tokens", (tokens) => {
      params.onTokenRefreshed?.({
        accessToken: tokens.access_token,
        expiryDate: tokens.expiry_date,
        refreshToken: tokens.refresh_token // Note: Google might not return refresh_token on refresh
      });
    });
  }

  return oauth2Client;
}
