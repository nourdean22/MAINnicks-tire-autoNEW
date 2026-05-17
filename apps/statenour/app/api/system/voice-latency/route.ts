/**
 * GET /api/system/voice-latency — v10.0.526 · Arc A Feature 3
 *
 * Composite voice-latency state for the Ultron tile + ops dashboards.
 * Returns P50/P95 per stage over the trailing window + breach streak
 * + nightly recommended-delta hints.
 *
 * Query params ·
 *   ?days=7   · window length (default 7, max 90)
 *
 * Auth · owner. The VoiceLatencyEvent rows themselves are produced by
 * the VAPI webhooks (server-to-server) and the nightly sync cron · no
 * customer data is reflected here, only aggregate latency.
 */

import { apiHandler } from "@/lib/utils/http";
import { getVoiceLatencyState } from "@/lib/services/voice-latency";

export const dynamic = "force-dynamic";

export const GET = apiHandler(
  async (req) => {
    const url = new URL(req.url);
    const days = Math.max(
      1,
      Math.min(90, parseInt(url.searchParams.get("days") ?? "7", 10) || 7),
    );
    return await getVoiceLatencyState(days);
  },
  { auth: "owner" },
);
