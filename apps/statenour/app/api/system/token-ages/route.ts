/**
 * GET /api/system/token-ages · v10.0.88 · 2026-05-02.
 *
 * Surface for token expiry / rotation cadence. The Meta Page Access
 * Token rotates ~60 days from issuance — without a tracker, the
 * operator either has it written down somewhere or finds out via a
 * 401 storm at 2am.
 *
 * Sources:
 *   · Integration table (google_oauth · stores grantedAt in config)
 *   · Env-presence flags (Meta / Buffer / Stripe / Twilio)
 *   · Hard-coded issue dates from arsenal_integrations.md memory
 *     (operator updates them when rotating)
 *
 * Returns days-until-expiry per token + a flat alert array for
 * anything <14 days from expiry. Idea: alert-telegram-bridge could
 * pick this up later if the token-age cron starts persisting
 * BrainMemory category=token_expiring.
 *
 * Auth: owner only — exposes token presence (not values).
 */

import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";

interface TokenStatus {
  id: string;
  label: string;
  rotationCadenceDays: number | "rolling" | "indefinite";
  /** ISO timestamp of issuance, or null if not tracked yet. */
  issuedAt: string | null;
  /** ISO timestamp of estimated expiry; null when rolling/indefinite. */
  expiresAt: string | null;
  daysSinceIssued: number | null;
  daysUntilExpiry: number | null;
  envPresent: boolean;
  status: "healthy" | "rotate-soon" | "expired" | "missing" | "rolling" | "indefinite" | "unknown";
  notes?: string;
}

const day = 86_400_000;
const has = (k: string) =>
  typeof process.env[k] === "string" && process.env[k]!.trim().length > 0;

function statusFromExpiry(daysUntil: number | null): TokenStatus["status"] {
  if (daysUntil === null) return "unknown";
  if (daysUntil <= 0) return "expired";
  if (daysUntil <= 14) return "rotate-soon";
  return "healthy";
}

// Hard-coded known issuance dates. Operator updates these when
// rotating a token (PR or env-overrides).
const KNOWN_ISSUE_DATES: Record<string, string | undefined> = {
  meta_page_access_token: process.env.META_TOKEN_ISSUED_AT ?? "2026-04-28",
  buffer_access_token: process.env.BUFFER_TOKEN_ISSUED_AT,
};

export const GET = apiHandler(
  async () => {
    const tokens: TokenStatus[] = [];

    // ── Meta Page Access Token (60-day rotation) ──────────────────
    {
      const envPresent =
        has("META_PAGE_ACCESS_TOKEN") || has("META_GRAPH_TOKEN");
      const issued = KNOWN_ISSUE_DATES.meta_page_access_token;
      const issuedAt = issued ? new Date(`${issued}T00:00:00Z`) : null;
      const expiresAt = issuedAt
        ? new Date(issuedAt.getTime() + 60 * day)
        : null;
      const daysSince = issuedAt
        ? Math.floor((Date.now() - issuedAt.getTime()) / day)
        : null;
      const daysUntil = expiresAt
        ? Math.floor((expiresAt.getTime() - Date.now()) / day)
        : null;
      tokens.push({
        id: "meta_page_access_token",
        label: "Meta Page Access Token (IG + FB publish)",
        rotationCadenceDays: 60,
        issuedAt: issuedAt?.toISOString() ?? null,
        expiresAt: expiresAt?.toISOString() ?? null,
        daysSinceIssued: daysSince,
        daysUntilExpiry: daysUntil,
        envPresent,
        status: !envPresent ? "missing" : statusFromExpiry(daysUntil),
        notes:
          "Long-lived 60d Page token. Rotate via Graph API Explorer → exchange user token → page token. Update META_TOKEN_ISSUED_AT env after rotation.",
      });
    }

    // ── Google OAuth (rolling refresh) ────────────────────────────
    {
      const integration = await prisma.integration
        .findUnique({ where: { name: "google_oauth" } })
        .catch(() => null);
      const cfg = (integration?.config as
        | { grantedAt?: string; lastRefreshAt?: string; email?: string }
        | null) ?? null;
      const grantedAt = cfg?.grantedAt ? new Date(cfg.grantedAt) : null;
      const daysSince = grantedAt
        ? Math.floor((Date.now() - grantedAt.getTime()) / day)
        : null;
      const status: TokenStatus["status"] = !integration
        ? "missing"
        : integration.status === "failed"
          ? "expired"
          : "rolling";
      tokens.push({
        id: "google_oauth_refresh",
        label: `Google OAuth refresh (Drive + Gmail + Calendar) ${cfg?.email ? "· " + cfg.email : ""}`,
        rotationCadenceDays: "rolling",
        issuedAt: grantedAt?.toISOString() ?? null,
        expiresAt: null,
        daysSinceIssued: daysSince,
        daysUntilExpiry: null,
        envPresent:
          has("AUTH_GOOGLE_CLIENT_ID") || has("GOOGLE_OAUTH_CLIENT_ID"),
        status,
        notes:
          "Refresh token doesn't expire unless revoked or 6mo of inactivity. consecutiveFailures + status='failed' on the Integration row signals revoked.",
      });
    }

    // ── Buffer (no expiry) ────────────────────────────────────────
    {
      const envPresent = has("BUFFER_ACCESS_TOKEN");
      tokens.push({
        id: "buffer_access_token",
        label: "Buffer (multi-platform schedule)",
        rotationCadenceDays: "indefinite",
        issuedAt: null,
        expiresAt: null,
        daysSinceIssued: null,
        daysUntilExpiry: null,
        envPresent,
        status: envPresent ? "indefinite" : "missing",
        notes: envPresent
          ? "Buffer tokens don't expire."
          : "NOT SET — generate at https://buffer.com/developers/apps and set BUFFER_ACCESS_TOKEN.",
      });
    }

    // ── Stripe webhook signing secret (indefinite, manual rotation) ─
    {
      const envPresent = has("STRIPE_WEBHOOK_SECRET");
      tokens.push({
        id: "stripe_webhook_secret",
        label: "Stripe webhook signing secret",
        rotationCadenceDays: "indefinite",
        issuedAt: null,
        expiresAt: null,
        daysSinceIssued: null,
        daysUntilExpiry: null,
        envPresent,
        status: envPresent ? "indefinite" : "missing",
        notes:
          "No expiry. Rotate manually via Stripe dashboard if compromised. Update STRIPE_WEBHOOK_SECRET env.",
      });
    }

    // ── Twilio (no expiry on auth token; rotate on compromise) ────
    {
      const envPresent = has("TWILIO_ACCOUNT_SID") && has("TWILIO_AUTH_TOKEN");
      tokens.push({
        id: "twilio_auth",
        label: "Twilio (SMS)",
        rotationCadenceDays: "indefinite",
        issuedAt: null,
        expiresAt: null,
        daysSinceIssued: null,
        daysUntilExpiry: null,
        envPresent,
        status: envPresent ? "indefinite" : "missing",
        notes: "Master auth token; rotate via Twilio console if compromised.",
      });
    }

    // ── CRON_SECRET (rotate on compromise) ────────────────────────
    {
      const envPresent = has("CRON_SECRET");
      tokens.push({
        id: "cron_secret",
        label: "Cron secret (Vercel scheduler auth)",
        rotationCadenceDays: "indefinite",
        issuedAt: null,
        expiresAt: null,
        daysSinceIssued: null,
        daysUntilExpiry: null,
        envPresent,
        status: envPresent ? "indefinite" : "missing",
      });
    }

    const alerts = tokens.filter(
      (t) => t.status === "rotate-soon" || t.status === "expired" || t.status === "missing",
    );

    return {
      generatedAt: new Date().toISOString(),
      tokens,
      alerts,
      summary: {
        total: tokens.length,
        healthy: tokens.filter((t) => t.status === "healthy").length,
        rotateSoon: tokens.filter((t) => t.status === "rotate-soon").length,
        expired: tokens.filter((t) => t.status === "expired").length,
        missing: tokens.filter((t) => t.status === "missing").length,
        rolling: tokens.filter((t) => t.status === "rolling").length,
        indefinite: tokens.filter((t) => t.status === "indefinite").length,
      },
    };
  },
  { auth: "owner" },
);
