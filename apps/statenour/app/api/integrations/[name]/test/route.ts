/**
 * POST /api/integrations/[name]/test · v10.0.90 · 2026-05-02.
 *
 * Manual "test connection" trigger per integration. Hits the row's
 * `healthCheckUrl` (when set), measures latency, surfaces the
 * response status. When healthCheckUrl is null, falls back to a
 * provider-specific lightweight ping (telegram /getMe, openai /models,
 * etc.).
 *
 * Updates Integration.status + lastSyncAt + consecutiveFailures
 * based on result so downstream components see fresh state.
 *
 * Auth: owner only.
 */

import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { ServiceError } from "@/lib/utils/service-error";

const TIMEOUT_MS = 8000;

interface PingResult {
  ok: boolean;
  status: number | "ERR";
  ms: number;
  detail?: string;
}

async function ping(url: string, init?: RequestInit): Promise<PingResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal });
    clearTimeout(timer);
    return {
      ok: r.ok,
      status: r.status,
      ms: Date.now() - t0,
      detail: r.ok ? undefined : await r.text().then((t) => t.slice(0, 200)),
    };
  } catch (err) {
    clearTimeout(timer);
    return {
      ok: false,
      status: "ERR",
      ms: Date.now() - t0,
      detail: err instanceof Error ? err.message.slice(0, 200) : String(err),
    };
  }
}

// Provider-specific lightweight pings — used when healthCheckUrl is null.
async function fallbackPing(name: string): Promise<PingResult | null> {
  const env = (k: string) => process.env[k]?.trim();
  switch (name) {
    case "telegram": {
      const token = env("TELEGRAM_BOT_TOKEN");
      if (!token) return { ok: false, status: "ERR", ms: 0, detail: "TELEGRAM_BOT_TOKEN missing" };
      return ping(`https://api.telegram.org/bot${token}/getMe`);
    }
    case "openai": {
      const token = env("OPENAI_API_KEY");
      if (!token) return { ok: false, status: "ERR", ms: 0, detail: "OPENAI_API_KEY missing" };
      return ping("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${token}` },
      });
    }
    case "anthropic": {
      const token = env("ANTHROPIC_API_KEY");
      if (!token) return { ok: false, status: "ERR", ms: 0, detail: "ANTHROPIC_API_KEY missing" };
      // Anthropic requires a real header set — minimal probe via /v1/models
      return ping("https://api.anthropic.com/v1/models", {
        headers: {
          "x-api-key": token,
          "anthropic-version": "2023-06-01",
        },
      });
    }
    case "resend": {
      const token = env("RESEND_API_KEY");
      if (!token) return { ok: false, status: "ERR", ms: 0, detail: "RESEND_API_KEY missing" };
      return ping("https://api.resend.com/domains", {
        headers: { Authorization: `Bearer ${token}` },
      });
    }
    case "stripe": {
      const token = env("STRIPE_SECRET_KEY");
      if (!token) return { ok: false, status: "ERR", ms: 0, detail: "STRIPE_SECRET_KEY missing" };
      return ping("https://api.stripe.com/v1/balance", {
        headers: { Authorization: `Bearer ${token}` },
      });
    }
    case "twilio": {
      const sid = env("TWILIO_ACCOUNT_SID");
      const token = env("TWILIO_AUTH_TOKEN");
      if (!sid || !token)
        return { ok: false, status: "ERR", ms: 0, detail: "TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN required" };
      return ping(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        },
      });
    }
    case "google_oauth": {
      // Token refresh is the actual health check; fast-path — read
      // Integration row status (set by lib/services/google-oauth.ts).
      return null; // signal "no fallback ping" — caller surfaces row state
    }
    case "neon-postgres": {
      // DB ping via prisma — caller can do this without a network call
      return null;
    }
    default:
      return null;
  }
}

export const POST = apiHandler(
  async (req, ctx) => {
    const params = await (ctx?.params as Promise<{ name: string }> | undefined);
    const name = params?.name;
    if (!name) throw new ServiceError("name param required", 400);

    const integration = await prisma.integration.findUnique({
      where: { name },
    });
    if (!integration) {
      throw new ServiceError(`Integration not found: ${name}`, 404);
    }

    // Prefer the configured healthCheckUrl; otherwise fall back to a
    // provider-specific probe.
    let result: PingResult | null = null;
    let probeKind: "healthCheckUrl" | "fallback" | "none" = "none";

    if (integration.healthCheckUrl) {
      result = await ping(integration.healthCheckUrl);
      probeKind = "healthCheckUrl";
    } else {
      result = await fallbackPing(name);
      probeKind = result ? "fallback" : "none";
    }

    if (!result) {
      return {
        ok: false,
        name,
        probeKind: "none",
        note: "No healthCheckUrl set + no provider-specific fallback wired",
      };
    }

    // Update Integration row with fresh state
    const newStatus = result.ok ? "healthy" : "degraded";
    const newConsecutiveFailures = result.ok
      ? 0
      : (integration.consecutiveFailures ?? 0) + 1;
    await prisma.integration.update({
      where: { name },
      data: {
        status: newStatus,
        consecutiveFailures: newConsecutiveFailures,
        errorCount: result.ok
          ? integration.errorCount
          : (integration.errorCount ?? 0) + 1,
        lastSyncAt: result.ok ? new Date() : integration.lastSyncAt,
      },
    });

    return {
      ok: result.ok,
      name,
      probeKind,
      latencyMs: result.ms,
      status: result.status,
      detail: result.detail,
      newRowStatus: newStatus,
      consecutiveFailures: newConsecutiveFailures,
    };
  },
  { auth: "owner" },
);
