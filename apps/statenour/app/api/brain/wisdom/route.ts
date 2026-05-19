/**
 * GET /api/brain/wisdom · v10.0.355 · Phase UU (2026-05-19 AM)
 *
 * Feeds the /brain/wisdom dashboard. Returns ALL wisdom-category
 * brain memories grouped by origin (skill-ingestion source) and by
 * ingestion source + hotness-ranked.
 *
 * Phase UU · heavy lifting moved to `lib/services/brain-wisdom`
 * so both this REST endpoint AND the new `trpc.brain.wisdom` query
 * call the same `buildWisdomFeed()` · drift impossible.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { withTracing } from "@/lib/utils/with-tracing";
import { buildWisdomFeed } from "@/lib/services/brain-wisdom";

export const dynamic = "force-dynamic";

async function handler(req: NextRequest): Promise<Response> {
  try {
    await requireSession(req);
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await buildWisdomFeed());
}

export const GET = withTracing(handler, { name: "/api/brain/wisdom" });
