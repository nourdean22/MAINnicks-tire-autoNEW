/**
 * GET /api/system/chat-health — chat-route operator rollup.
 *
 * Single endpoint feeding /system/chat-health. Pulls from
 * AiGeneration, ApiRequestLog, ErrorLog, ToolTelemetry (typed table,
 * post-Wave-53), AuditEvent — every signal needed to answer "is the
 * chat layer healthy and fast right now?"
 *
 * Phase B.7a (2026-05-22) · the rollup assembly moved to the shared
 * `system-pages.buildChatHealth` service so the legacy REST consumer
 * AND the new `system.chatHealth` tRPC procedure can't drift. The route
 * keeps its `{ data }` envelope (the legacy page reads `json.data`).
 * This route stays mounted as the coexistence / rollback path.
 */

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { buildChatHealth } from "@/lib/services/system-pages";

export async function GET(req: Request) {
  await requireSession(req);
  const data = await buildChatHealth();
  return NextResponse.json({ data });
}
