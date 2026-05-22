/**
 * /api/admin/knowledge-refresh — fan-out to all knowledge-pull crons.
 *
 * v6 · BATCH 6 · Apr 28 · slimmed straggler-pages REST→tRPC slice
 * (2026-05-22). Single button, eight pulls. Lets Nour force-refresh
 * the whole knowledge corpus without waiting for the next cron fire.
 *
 * Body: { only?: string[] }
 *   only — optional list of subsystems to refresh (else all)
 *
 * Returns: per-subsystem result + final cache flush.
 *
 * The fan-out logic moved to lib/services/knowledge-refresh.ts so this
 * route and the new `operator.knowledgeRefresh` tRPC procedure call ONE
 * function · drift impossible. This route is the thin REST shell that
 * stays mounted.
 *
 * Auth: session.
 */

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import {
  runKnowledgeRefresh,
  KnowledgeRefreshError,
} from "@/lib/services/knowledge-refresh";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 180;

interface RefreshBody {
  only?: string[];
}

export async function POST(req: Request) {
  try {
    await requireSession(req);
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: RefreshBody;
  try {
    body = (await req.json().catch(() => ({}))) as RefreshBody;
  } catch {
    body = {};
  }

  try {
    const result = await runKnowledgeRefresh({
      headers: req.headers,
      only: body.only,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof KnowledgeRefreshError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status },
      );
    }
    throw err;
  }
}
