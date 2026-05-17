/**
 * POST /api/brain/telemetry · v10.0.415
 *
 * Lightweight telemetry recorder for the v10.0.397-414 brain
 * feedback layers. Operator UI fires this on:
 *   · see-also expander click (related-wisdom-links)
 *   · evolution panel deprecate (wisdom-evolution-panel)
 *   · mode-persona chip cycle (mode-persona-chip)
 *
 * Body · { event: string, value?: number, tags?: object }
 *
 * Why a separate route · the existing routes are domain-specific
 * (deprecate POSTs to /api/brain/wisdom/[id]). Click-tracking is
 * orthogonal · one endpoint, many event types · keeps the surface
 * area small for the operator dashboards.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { recordMetric } from "@/lib/services/metrics";
import { withTracing } from "@/lib/utils/with-tracing";

export const dynamic = "force-dynamic";

const ALLOWED_EVENTS = new Set([
  "see_also_click",
  "evolution_deprecate",
  "evolution_review",
  "mode_chip_cycle",
  "mode_chip_send",
  "improve_page_view",
]);

async function handler(req: NextRequest): Promise<Response> {
  // Auth: requireSession invoked below
  try { await requireSession(req); } catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }

  let body: { event?: string; value?: number; tags?: Record<string, unknown> } = {};
  try { body = (await req.json()) as typeof body; } catch { /* ignore */ }
  const event = typeof body.event === "string" ? body.event : "";
  if (!ALLOWED_EVENTS.has(event)) {
    return NextResponse.json({ error: "unknown_event" }, { status: 400 });
  }

  const value = typeof body.value === "number" && Number.isFinite(body.value) ? body.value : 1;
  await recordMetric(`brain_feedback.${event}`, value, {
    unit: "count",
    tags: body.tags ?? {},
    source: "brain-feedback-ui",
  });

  return NextResponse.json({ ok: true });
}

// Auth: handler above invokes requireSession on first line.
export const POST = withTracing(handler, { name: "/api/brain/telemetry" });
