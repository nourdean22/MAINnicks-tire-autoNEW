/**
 * GET /api/system/cache-telemetry · v10.0.385
 *
 * Returns the prompt-cache telemetry report · per-provider hit rate,
 * total tokens by class (creation/read/regular/output), estimated
 * cost savings ratio. Operator-only · session required.
 *
 * Resets on Vercel cold start (acceptable · we sample, not audit).
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { buildCacheReport } from "@/lib/observability/cache-telemetry";
import { withTracing } from "@/lib/utils/with-tracing";

export const dynamic = "force-dynamic";

async function handler(req: NextRequest): Promise<Response> {
  // Auth: requireSession invoked below
  try { await requireSession(req); } catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }
  return NextResponse.json(buildCacheReport());
}

// Auth: handler above invokes requireSession on first line.
export const GET = withTracing(handler, { name: "/api/system/cache-telemetry" });
