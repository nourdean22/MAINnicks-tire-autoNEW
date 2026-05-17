/**
 * GET /api/brain/wisdom/evolution · v10.0.406
 *
 * Surfaces three classes of self-evolution candidates the operator
 * can review on /brain/wisdom:
 *
 *   stale     · wisdoms inactive 60+ days with confidence < 0.5
 *   redundant · pairs with cosine ≥ 0.92 and shared topic tags
 *   low_trust · active recently but confidence drifting < 0.5
 *
 * NEVER auto-mutates · operator approves each move via the existing
 * deprecate / restore / promote endpoints (v10.0.383).
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { runWisdomEvolution } from "@/lib/brain/wisdom-evolution";
import { withTracing } from "@/lib/utils/with-tracing";

export const dynamic = "force-dynamic";

async function handler(req: NextRequest): Promise<Response> {
  // Auth: requireSession invoked below
  try { await requireSession(req); } catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }

  try {
    const result = await runWisdomEvolution();
    return NextResponse.json({
      ...result,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message?.slice(0, 200) ?? "computation failed" },
      { status: 500 },
    );
  }
}

// Auth: handler above invokes requireSession on first line.
export const GET = withTracing(handler, { name: "/api/brain/wisdom/evolution" });
