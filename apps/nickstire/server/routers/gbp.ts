import { router, adminProcedure } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { db } from "../lib/db-helper";
import { appSecretKv, socialDrafts } from "../../drizzle/schema";
import { eq, inArray } from "drizzle-orm";
import { createLogger } from "../lib/logger";
import {
  getAuthUrl,
  exchangeCode,
  getAuthenticatedClient,
  listGbpAccounts,
  listGbpLocations,
  publishGbpPost,
  GbpLocalPostParams
} from "@nour/gbp-publisher";
import { dispatch } from "../services/eventBus";

const log = createLogger("routers:gbp");

// Helper to load Google Business Profile secrets from the DB/env
async function loadGbpSecrets() {
  const secrets = {
    clientId: process.env.GBP_CLIENT_ID || "",
    clientSecret: process.env.GBP_CLIENT_SECRET || "",
    redirectUri: process.env.GBP_REDIRECT_URI || "",
    refreshToken: process.env.GBP_REFRESH_TOKEN || "",
    accountId: process.env.GBP_ACCOUNT_ID || "",
    locationId: process.env.GBP_LOCATION_ID || "",
  };

  try {
    const d = await db();
    if (d) {
      const rows = await d
        .select()
        .from(appSecretKv)
        .where(
          inArray(appSecretKv.k, [
            "gbp_client_id",
            "gbp_client_secret",
            "gbp_redirect_uri",
            "gbp_refresh_token",
            "gbp_account_id",
            "gbp_location_id",
          ])
        );

      for (const row of rows) {
        if (row.k === "gbp_client_id") secrets.clientId = row.v;
        if (row.k === "gbp_client_secret") secrets.clientSecret = row.v;
        if (row.k === "gbp_redirect_uri") secrets.redirectUri = row.v;
        if (row.k === "gbp_refresh_token") secrets.refreshToken = row.v;
        if (row.k === "gbp_account_id") secrets.accountId = row.v;
        if (row.k === "gbp_location_id") secrets.locationId = row.v;
      }
    }
  } catch (err) {
    log.error("Failed to load GBP secrets from DB:", { error: err instanceof Error ? err.message : String(err) });
  }

  return secrets;
}

// Helper to save secrets into appSecretKv
async function saveGbpSecret(k: string, v: string) {
  try {
    const d = await db();
    if (d) {
      await d
        .insert(appSecretKv)
        .values({ k, v })
        .onDuplicateKeyUpdate({ set: { v } });
    }
  } catch (err) {
    log.error(`Failed to save GBP secret ${k} to DB:`, { error: err instanceof Error ? err.message : String(err) });
  }
}

// Create an authenticated client with callbacks configured to save refreshed tokens
async function createAuthClient(secrets: Awaited<ReturnType<typeof loadGbpSecrets>>) {
  if (!secrets.clientId || !secrets.clientSecret || !secrets.refreshToken) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Google Business Profile is not connected or configured. Missing client ID, client secret, or refresh token."
    });
  }

  return getAuthenticatedClient({
    clientId: secrets.clientId,
    clientSecret: secrets.clientSecret,
    refreshToken: secrets.refreshToken,
    onTokenRefreshed: async (tokens: any) => {
      if (tokens.refreshToken) {
        await saveGbpSecret("gbp_refresh_token", tokens.refreshToken);
      }
      if (tokens.accessToken) {
        await saveGbpSecret("gbp_access_token", tokens.accessToken);
      }
    }
  });
}

export const gbpRouter = router({
  /**
   * WP-22 GBP leg (2026-07-29) · READ-ONLY performance metrics via the
   * SAME business.manage grant the publisher holds — zero new
   * credentials. Fail-closed until the one-time Connect flow has run:
   * returns connected:false with the exact operator action instead of
   * throwing, so the admin card renders the instruction, not an error.
   */
  performance: adminProcedure
    .input(z.object({ days: z.number().int().min(7).max(90).default(30) }).optional())
    .query(async ({ input }) => {
      const secrets = await loadGbpSecrets();
      if (!secrets.refreshToken || !secrets.clientId || !secrets.clientSecret) {
        return {
          ok: false as const,
          connected: false as const,
          action: "Connect Google Business Profile first: Admin → Content → GBP Posts → Connect",
        };
      }
      if (!secrets.locationId) {
        return {
          ok: false as const,
          connected: true as const,
          action: "GBP is connected but no location is selected — pick the location in GBP Posts setup",
        };
      }
      const client = await createAuthClient(secrets);
      const tokenRes = await client.getAccessToken();
      const accessToken = typeof tokenRes === "string" ? tokenRes : tokenRes?.token;
      if (!accessToken) {
        return { ok: false as const, connected: true as const, action: "token refresh failed — reconnect GBP" };
      }
      const { fetchGbpPerformance } = await import("../services/gbpPerformance");
      const result = await fetchGbpPerformance({
        locationId: secrets.locationId,
        accessToken,
        days: input?.days ?? 30,
      });
      return { connected: true as const, ...result };
    }),

  /**
   * Retrieves connection and configuration status.
   * Leverages loadGbpSecrets but returns only fingerprints for security.
   */
  getAuthStatus: adminProcedure.query(async () => {
    const secrets = await loadGbpSecrets();
    return {
      configured: !!(secrets.clientId && secrets.clientSecret),
      connected: !!secrets.refreshToken,
      locationConfigured: !!(secrets.accountId && secrets.locationId),
      clientIdFingerprint: secrets.clientId ? `…${secrets.clientId.slice(-6)}` : null,
      accountId: secrets.accountId || null,
      locationId: secrets.locationId || null,
    };
  }),

  /**
   * Generates the Google OAuth 2.0 authorization URL.
   */
  getAuthUrl: adminProcedure
    .input(z.object({
      redirectUri: z.string().url().optional(),
    }).optional())
    .query(async ({ input }) => {
      const secrets = await loadGbpSecrets();
      const redirectUri = input?.redirectUri || secrets.redirectUri;

      if (!secrets.clientId || !secrets.clientSecret) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Google OAuth client details are missing in database secrets ('gbp_client_id', 'gbp_client_secret')."
        });
      }

      if (!redirectUri) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Redirect URI is not specified. Set redirectUri in the request or configure 'gbp_redirect_uri' in secrets."
        });
      }

      try {
        const url = getAuthUrl({
          clientId: secrets.clientId,
          clientSecret: secrets.clientSecret,
          redirectUri,
          state: "gbp-oauth"
        });
        return { url };
      } catch (err: any) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to generate auth URL: ${err.message}`
        });
      }
    }),

  /**
   * Exchanges authorization code for tokens, saves the refresh token, and returns available GMB accounts.
   */
  reconnect: adminProcedure
    .input(z.object({
      code: z.string().min(1),
      redirectUri: z.string().url().optional(),
    }))
    .mutation(async ({ input }) => {
      const secrets = await loadGbpSecrets();
      const redirectUri = input.redirectUri || secrets.redirectUri;

      if (!secrets.clientId || !secrets.clientSecret) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Google OAuth client details are missing in database secrets."
        });
      }

      if (!redirectUri) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Redirect URI is missing. Configure 'gbp_redirect_uri' or pass redirectUri in the request."
        });
      }

      try {
        const tokens = await exchangeCode({
          clientId: secrets.clientId,
          clientSecret: secrets.clientSecret,
          redirectUri,
          code: input.code
        });

        if (!tokens.refreshToken) {
          throw new Error("No refresh token returned by Google. Ensure you revoke permissions first or force consent.");
        }

        await saveGbpSecret("gbp_refresh_token", tokens.refreshToken);
        if (tokens.accessToken) {
          await saveGbpSecret("gbp_access_token", tokens.accessToken);
        }

        const authClient = getAuthenticatedClient({
          clientId: secrets.clientId,
          clientSecret: secrets.clientSecret,
          refreshToken: tokens.refreshToken
        });

        const accounts = await listGbpAccounts(authClient);
        return { success: true, accounts };
      } catch (err: any) {
        log.error("GBP token exchange and connection failed:", { error: err.message });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `OAuth Reconnect Failed: ${err.message}`
        });
      }
    }),

  /**
   * Retrieves locations for a specific GMB account.
   */
  listLocations: adminProcedure
    .input(z.object({
      accountName: z.string().min(1) // format: "accounts/{accountId}"
    }))
    .query(async ({ input }) => {
      const secrets = await loadGbpSecrets();
      const authClient = await createAuthClient(secrets);

      try {
        const locations = await listGbpLocations(authClient, input.accountName);
        return { locations };
      } catch (err: any) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to fetch GBP locations: ${err.message}`
        });
      }
    }),

  /**
   * Saves the chosen account and location names to the secrets store.
   */
  saveLocation: adminProcedure
    .input(z.object({
      accountId: z.string().min(1),
      locationId: z.string().min(1)
    }))
    .mutation(async ({ input }) => {
      await saveGbpSecret("gbp_account_id", input.accountId);
      await saveGbpSecret("gbp_location_id", input.locationId);
      return { success: true };
    }),

  /**
   * Publishes a post to Google Business Profile.
   * Updates draft status in socialDrafts table on success.
   */
  publishPost: adminProcedure
    .input(z.object({
      draftId: z.string().optional(),
      topicType: z.enum(["STANDARD", "EVENT", "OFFER"]).default("STANDARD"),
      summary: z.string().min(1),
      ctaType: z.enum(["BOOK", "ORDER", "SHOP", "LEARN_MORE", "SIGN_UP", "CALL"]).optional(),
      ctaUrl: z.string().url().optional(),
      mediaUrls: z.array(z.string().url()).optional(),
      event: z.object({
        title: z.string().min(1),
        schedule: z.object({
          startDate: z.object({ year: z.number(), month: z.number(), day: z.number() }),
          endDate: z.object({ year: z.number(), month: z.number(), day: z.number() }),
        })
      }).optional()
    }))
    .mutation(async ({ input }) => {
      const secrets = await loadGbpSecrets();

      if (!secrets.accountId || !secrets.locationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Google Business Profile location is not configured. Run getAuthStatus and select a location."
        });
      }

      const authClient = await createAuthClient(secrets);

      // Build the GBP post payload
      const postPayload: GbpLocalPostParams = {
        topicType: input.topicType,
        summary: input.summary,
      };

      if (input.ctaType) {
        postPayload.callToAction = {
          actionType: input.ctaType,
          url: input.ctaUrl
        };
      }

      if (input.mediaUrls && input.mediaUrls.length > 0) {
        postPayload.media = input.mediaUrls.map((url) => ({
          mediaFormat: "PHOTO",
          sourceUrl: url
        }));
      }

      if (input.event) {
        postPayload.event = {
          title: input.event.title,
          schedule: input.event.schedule
        };
      }

      try {
        const result = await publishGbpPost({
          authClient,
          accountName: secrets.accountId,
          locationName: secrets.locationId,
          post: postPayload
        });

        // If a draftId is provided, mark the draft as posted and record details
        if (input.draftId) {
          const d = await db();
          if (d) {
            const existing = await d
              .select()
              .from(socialDrafts)
              .where(eq(socialDrafts.id, input.draftId))
              .limit(1);

            if (existing.length > 0) {
              const row = existing[0];
              let brief: any = {};
              try {
                brief = JSON.parse(row.briefJson);
              } catch (e) {
                log.error("Failed to parse socialDraft briefJson:", e);
              }

              brief.status = "posted";
              brief.gbpPostId = result.name;
              brief.gbpSearchUrl = result.searchUrl || "";
              brief.gbpPostedAt = new Date().toISOString();

              await d
                .update(socialDrafts)
                .set({
                  briefJson: JSON.stringify(brief)
                })
                .where(eq(socialDrafts.id, input.draftId));
            }
          }
        }

        // Sync with Statenour Command Center Queue
        try {
          await dispatch("social_draft:sync", {
            id: input.draftId || `gbp-post-${result.name.split("/").pop() || Date.now()}`,
            content: input.summary,
            status: "published",
            imageUrl: (input.mediaUrls && input.mediaUrls[0]) || null,
            platforms: ["gbp"],
            kind: "post",
            source: "nick",
            sourceMetadata: {
              gbpPostId: result.name,
              gbpSearchUrl: result.searchUrl || "",
              publishedAt: new Date().toISOString(),
              topicType: input.topicType,
              ctaType: input.ctaType,
              ctaUrl: input.ctaUrl,
            },
            publishedAt: new Date().toISOString(),
          }, { source: "gbp_router" });
        } catch (syncErr) {
          log.warn("Failed to sync published GBP post to Statenour:", syncErr);
        }

        return {
          success: true,
          postId: result.name,
          searchUrl: result.searchUrl || null,
          state: result.state || null
        };
      } catch (err: any) {
        log.error("Google Business Profile post publication failed:", { error: err.message });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `GBP Publication Failed: ${err.message}`
        });
      }
    })
});
