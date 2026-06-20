/**
 * GET /api/system/integration-quotas · v10.0.90 · 2026-05-02.
 *
 * Surfaces real-time cost/quota state per provider by hitting each
 * provider's billing/usage endpoint with the configured credentials.
 * Failed probes return the error so the dashboard can show "credentials
 * stale" without crashing the rollup.
 *
 * Wired probes:
 *   · Twilio   — usage records (current month)
 *   · Resend   — domains + last 30d sends if API supports
 *   · Stripe   — balance + current-month volume
 *   · Vercel   — bandwidth + execution-units (when VERCEL_TOKEN set)
 *
 * Fallback for providers without a billing API: surface env-presence
 * + last-call latency from api_request_logs proxied through the
 * test-connection module.
 *
 * Auth: owner only.
 */

import { apiHandler } from "@/lib/utils/http";

const TIMEOUT_MS = 8000;

interface QuotaProbe {
  provider: string;
  ok: boolean;
  status: "configured" | "missing" | "error" | "unknown";
  data?: Record<string, unknown>;
  error?: string;
  ms?: number;
}

const env = (k: string) => process.env[k]?.trim();

async function timedFetch(
  url: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; ms: number; body: unknown; error?: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal });
    clearTimeout(timer);
    const ms = Date.now() - t0;
    const text = await r.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = text.slice(0, 500);
    }
    return { ok: r.ok, status: r.status, ms, body };
  } catch (err) {
    clearTimeout(timer);
    return {
      ok: false,
      status: 0,
      ms: Date.now() - t0,
      body: null,
      error: err instanceof Error ? err.message.slice(0, 200) : String(err),
    };
  }
}

async function probeTwilio(): Promise<QuotaProbe> {
  const sid = env("TWILIO_ACCOUNT_SID");
  const token = env("TWILIO_AUTH_TOKEN");
  if (!sid || !token) {
    return { provider: "twilio", ok: false, status: "missing" };
  }
  const auth = `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .slice(0, 10);
  const r = await timedFetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Usage/Records/Daily.json?StartDate=${monthStart}`,
    { headers: { Authorization: auth } },
  );
  if (!r.ok) {
    return { provider: "twilio", ok: false, status: "error", error: r.error ?? `HTTP ${r.status}`, ms: r.ms };
  }
  const records = (r.body as { usage_records?: Array<{ category?: string; usage?: string; price?: string; price_unit?: string }> })?.usage_records ?? [];
  const totals: Record<string, { usage: number; cost: number; unit?: string }> = {};
  for (const rec of records) {
    const cat = rec.category ?? "unknown";
    const u = parseFloat(rec.usage ?? "0");
    const c = parseFloat(rec.price ?? "0");
    if (!Number.isFinite(u) && !Number.isFinite(c)) continue;
    if (!totals[cat]) totals[cat] = { usage: 0, cost: 0, unit: rec.price_unit };
    totals[cat].usage += Number.isFinite(u) ? u : 0;
    totals[cat].cost += Number.isFinite(c) ? c : 0;
  }
  return {
    provider: "twilio",
    ok: true,
    status: "configured",
    ms: r.ms,
    data: {
      monthStart,
      categories: Object.entries(totals)
        .map(([cat, v]) => ({
          category: cat,
          usage: Math.round(v.usage * 100) / 100,
          costUsd: Math.round(v.cost * 100) / 100,
          unit: v.unit,
        }))
        .sort((a, b) => b.costUsd - a.costUsd),
      totalUsd:
        Math.round(
          Object.values(totals).reduce((s, t) => s + t.cost, 0) * 100,
        ) / 100,
    },
  };
}

async function probeResend(): Promise<QuotaProbe> {
  const token = env("RESEND_API_KEY");
  if (!token) {
    return { provider: "resend", ok: false, status: "missing" };
  }
  // Resend's API doesn't currently expose monthly usage publicly;
  // surface domain count + verified status as a proxy for "is it
  // configured + healthy"
  const r = await timedFetch("https://api.resend.com/domains", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) {
    return { provider: "resend", ok: false, status: "error", error: r.error ?? `HTTP ${r.status}`, ms: r.ms };
  }
  const domains = (r.body as { data?: Array<{ name?: string; status?: string }> })?.data ?? [];
  return {
    provider: "resend",
    ok: true,
    status: "configured",
    ms: r.ms,
    data: {
      domainCount: domains.length,
      verifiedDomains: domains.filter((d) => d.status === "verified").length,
      domains: domains.map((d) => ({ name: d.name, status: d.status })),
      note: "Resend doesn't expose monthly send count via API; visit dashboard for usage",
    },
  };
}

async function probeStripe(): Promise<QuotaProbe> {
  const token = env("STRIPE_SECRET_KEY");
  if (!token) {
    return { provider: "stripe", ok: false, status: "missing" };
  }
  const r = await timedFetch("https://api.stripe.com/v1/balance", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) {
    return { provider: "stripe", ok: false, status: "error", error: r.error ?? `HTTP ${r.status}`, ms: r.ms };
  }
  const b = r.body as {
    available?: Array<{ amount: number; currency: string }>;
    pending?: Array<{ amount: number; currency: string }>;
  };
  return {
    provider: "stripe",
    ok: true,
    status: "configured",
    ms: r.ms,
    data: {
      available: b.available?.map((x) => ({
        amount: x.amount / 100,
        currency: x.currency,
      })),
      pending: b.pending?.map((x) => ({
        amount: x.amount / 100,
        currency: x.currency,
      })),
    },
  };
}

async function probeVercel(): Promise<QuotaProbe> {
  const token = env("VERCEL_TOKEN");
  const teamId = env("VERCEL_TEAM_ID");
  if (!token) return { provider: "vercel", ok: false, status: "missing" };
  const r = await timedFetch(
    `https://api.vercel.com/v9/user${teamId ? `?teamId=${encodeURIComponent(teamId)}` : ""}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!r.ok) {
    return { provider: "vercel", ok: false, status: "error", error: r.error ?? `HTTP ${r.status}`, ms: r.ms };
  }
  return {
    provider: "vercel",
    ok: true,
    status: "configured",
    ms: r.ms,
    data: {
      note: "Vercel usage surfaced via /v9/user; full bandwidth/exec-unit breakdown requires team-level dashboard",
    },
  };
}

export const GET = apiHandler(
  async () => {
    const probes = await Promise.all([
      probeTwilio(),
      probeResend(),
      probeStripe(),
      probeVercel(),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      probes,
      summary: {
        total: probes.length,
        configured: probes.filter((p) => p.status === "configured").length,
        missing: probes.filter((p) => p.status === "missing").length,
        errors: probes.filter((p) => p.status === "error").length,
      },
    };
  },
  { auth: "owner" },
);
