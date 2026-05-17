import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
export const dynamic = "force-dynamic";

/**
 * GET /api/ai/venice-status — Live Venice API status + balance
 *
 * Makes a minimal API call to Venice to read response headers:
 * - USD balance, DIEM balance
 * - Rate limits (remaining requests, tokens)
 * - Model info, deprecation warnings
 * - API version
 *
 * v10.0.44 — auth gate. Pre-fix any caller could read the live
 * Venice account balance + rate-limit state. Owner-only now.
 */
export async function GET(req: Request) {
  await requireSession(req);
  const key = process.env.VENICE_API_KEY;
  if (!key) {
    return NextResponse.json({ ok: false, error: "VENICE_API_KEY not set" }, { status: 503 });
  }

  try {
    // Minimal request — just enough to get response headers with balance
    const res = await fetch("https://api.venice.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return NextResponse.json({
        ok: false,
        error: `Venice API returned ${res.status}`,
        requestId: res.headers.get("CF-RAY"),
      }, { status: res.status });
    }

    const models = await res.json();

    return NextResponse.json({
      ok: true,
      balance: {
        usd: res.headers.get("x-venice-balance-usd"),
        diem: res.headers.get("x-venice-balance-diem"),
      },
      rateLimits: {
        requestsRemaining: res.headers.get("x-ratelimit-remaining-requests"),
        requestsLimit: res.headers.get("x-ratelimit-limit-requests"),
        tokensRemaining: res.headers.get("x-ratelimit-remaining-tokens"),
        tokensLimit: res.headers.get("x-ratelimit-limit-tokens"),
      },
      api: {
        version: res.headers.get("x-venice-version"),
        requestId: res.headers.get("CF-RAY"),
      },
      models: {
        total: models?.data?.length ?? 0,
        chat: models?.data?.filter((m: any) => m.type === "chat" || m.id?.includes("llama") || m.id?.includes("glm"))?.length ?? 0,
        image: models?.data?.filter((m: any) => m.type === "image" || m.id?.includes("banana") || m.id?.includes("flux"))?.length ?? 0,
      },
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : "Failed to reach Venice API",
    }, { status: 500 });
  }
}
