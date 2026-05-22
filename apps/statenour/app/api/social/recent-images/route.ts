/**
 * /api/social/recent-images — last N generated images for the publish picker.
 *
 * v6 · BATCH 4 · Apr 28. Used by the /social UI to populate the
 * "recent generated" thumbnail strip so Nour can publish a fresh image
 * without remembering its ID.
 */

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { getRecentImages } from "@/lib/services/social-actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// misc-pages slice (2026-05-22) · the query moved to the shared
// `getRecentImages` service the `operator.socialRecentImages` tRPC
// procedure also calls · drift structurally impossible.
export async function GET(req: Request) {
  try { await requireSession(req); } catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }
  return NextResponse.json(await getRecentImages());
}
