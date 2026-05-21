/**
 * Hot-flush the system-prompt cache.
 *
 * v6 · Used when knowledge changes (pin write, brand_rule edit, Drive
 * sync, business_knowledge.ts hot-reload) and the next chat turn must
 * rebuild from scratch instead of serving the 45s-TTL cached prompt.
 *
 * POST /api/system/prompt-cache-flush
 * Body: { reason: string }
 * Returns: { ok: true, flushed: <count> }
 *
 * Auth: requires CRON_SECRET header OR an authenticated session
 * (caller's choice — both paths gated). Open the trigger up only for
 * the things that legitimately need it; spamming this defeats the
 * cache that protects ~3s of latency on cold prompt builds.
 */

import { NextResponse } from "next/server";
import { hotFlushPromptCache } from "@/lib/ai/system-prompt-cache";
import { requireSession, safeEqual } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  // Auth: CRON_SECRET header (for crons) OR authenticated session.
  const authHeader = req.headers.get("authorization") ?? "";
  const cronSecret = process.env.CRON_SECRET;
  // Constant-time compare (safeEqual) — a plain `===` on the secret is a
  // timing oracle. Matches the canonical guard in auth-guard.ts.
  const isCronCall =
    !!cronSecret &&
    (safeEqual(authHeader, `Bearer ${cronSecret}`) || safeEqual(authHeader, cronSecret));

  if (!isCronCall) {
    // Fall back to session auth (Vercel-deployed admin paths).
    try { await requireSession(req); } catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }
  }

  let reason = "manual flush";
  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body?.reason === "string" && body.reason.length > 0) {
      reason = body.reason.slice(0, 200);
    }
  } catch {
    // body is optional
  }

  hotFlushPromptCache(reason);

  return NextResponse.json({
    ok: true,
    reason,
    flushedAt: new Date().toISOString(),
  });
}
