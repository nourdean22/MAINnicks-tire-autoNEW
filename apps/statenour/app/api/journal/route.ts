/**
 * GET /api/journal — Unified journal feed
 *
 * Phase TT (2026-05-19 AM) · heavy lifting moved to
 * `lib/services/journal-feed.buildJournalFeed` so both this REST
 * endpoint AND the new `trpc.journal.feed` query call the same
 * function · drift between consumers structurally impossible.
 *
 * Pre-fix the route was 238 LOC inline · now it's a 20-LOC delegator.
 *
 * v10.0.37 — owner-gated. The endpoint returns BrainDump (raw
 * thoughts) · Reflection · SituationLog · DecisionReplay rows ·
 * all sensitive · public access was a CRITICAL privacy hole closed.
 */
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { buildJournalFeed } from "@/lib/services/journal-feed";

export async function GET(req: Request) {
  await requireSession(req);
  const url = new URL(req.url);
  const view = await buildJournalFeed({
    limit: Number(url.searchParams.get("limit")) || 50,
    days: Number(url.searchParams.get("days")) || 30,
    type: url.searchParams.get("type"),
    source: url.searchParams.get("source") || "all",
  });
  return NextResponse.json({ data: view });
}
