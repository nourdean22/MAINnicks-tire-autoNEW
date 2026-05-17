import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

import { requireSession } from "@/lib/auth-guard";
import { checkRateLimit, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";
export const runtime = "nodejs";

/**
 * POST /api/ai/chat/lane-check/feedback
 *
 * Records when Nour taps or dismisses a lane-correction chip. Over
 * time, the ratios let the lane-check endpoint tune its regex
 * classifier + severity threshold.
 *
 * Body:
 *   { action: "tapped" | "dismissed", domain: string, severity: string,
 *     userMessage?: string, assistantMessage?: string }
 *
 * Writes a SystemMetric row with metric="lane.chip.feedback",
 * value=1, tags={action, domain, severity, msgHash}. Zero new
 * schema — we already have SystemMetric.
 *
 * The lane-check route can sample this later to know:
 *   - Which domains get dismissed more often (regex may be wrong)
 *   - Which severities correlate with taps vs dismissals
 *   - Time-of-day patterns on dismissal (morning noise vs evening signal)
 *
 * Frontend hook: LaneCorrectionChip calls this on X and on tap.
 */
export async function POST(req: NextRequest) {
  await requireSession(req);
  // v10.0.529.3 D-1 fix · light SystemMetric write · 60/min/IP is
  // generous (chips don't tap that fast in practice) but caps any
  // automated chip-tap loop from filling the metrics table.
  const ip = getClientIp(req);
  const rl = checkRateLimit(
    `/api/ai/chat/lane-check/feedback:${ip}`,
    RATE_LIMITS.general,
  );
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "rate_limited", retryAfterMs: rl.resetAt - Date.now() },
      { status: 429 },
    );
  }
  try {
    const body = (await req.json()) as {
      action?: "tapped" | "dismissed";
      domain?: string;
      severity?: string;
      userMessage?: string;
      assistantMessage?: string;
    };
    if (!body.action || !body.domain) {
      return NextResponse.json(
        { error: "action + domain required", code: "BAD_REQUEST" },
        { status: 400 }
      );
    }

    const msgSample =
      (body.userMessage || "").slice(-80) +
      "|" +
      (body.assistantMessage || "").slice(-80);
    let h = 0;
    for (let i = 0; i < msgSample.length; i++) {
      h = (h * 31 + msgSample.charCodeAt(i)) | 0;
    }
    const msgHash = String(h);

    await prisma.systemMetric
      .create({
        data: {
          metric: "lane.chip.feedback",
          value: body.action === "tapped" ? 1 : 0,
          unit: "bool",
          source: "api",
          tags: {
            action: body.action,
            domain: body.domain,
            severity: body.severity || "unknown",
            msgHash,
          } as any,
        },
      })
      .catch(() => {});

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "feedback failed",
        code: "LANE_FEEDBACK_FAILED",
      },
      { status: 200 } // don't break UI on feedback failures
    );
  }
}
