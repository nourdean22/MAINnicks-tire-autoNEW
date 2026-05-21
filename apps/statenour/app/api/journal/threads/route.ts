/**
 * /api/journal/threads · ADR-0013 · Phase D
 *
 * Owner-only · CRUD over JournalThread.
 *
 *   GET   /api/journal/threads?includeDormant=true   → ThreadSummary[]
 *   POST  /api/journal/threads                       → confirm a
 *           convergence candidate · body:
 *           { clusterHash, name, summary? }
 *           → 201 { threadId, memberCount }
 */

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { ServiceError } from "@/lib/utils/service-error";
import { logger as rootLogger } from "@/lib/logger";
import { sanitizeError } from "@/lib/utils/sanitize-error";
import {
  confirmCandidate,
  createEmptyThread,
  listThreads,
} from "@/lib/services/journal-threads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 15;

const log = rootLogger.withSurface("api/journal/threads");

export async function GET(req: Request) {
  try {
    await requireSession(req);
    const url = new URL(req.url);
    const includeDormant = url.searchParams.get("includeDormant") === "true";
    const data = await listThreads({ includeDormant });
    return NextResponse.json({ data });
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    log.error("threads_list_failed", { error: sanitizeError(err) });
    return NextResponse.json(
      { error: sanitizeError(err) },
      { status: 500 },
    );
  }
}

/**
 * POST /api/journal/threads · two modes:
 *   1. { clusterHash, name, summary? }   · confirm convergence candidate
 *   2. { name, summary? }                · operator-initiated empty thread
 *
 * Mode #2 added 2026-05-18 PM follow-up · operator-control completion.
 * When body has clusterHash, treat as confirm-candidate (existing). When
 * body has only name, create an empty thread the auto-join hook can
 * populate. memberCount starts at 0 · scoreEntryAgainstActiveThreads
 * filters those out until first member joins via auto-join or operator
 * pinning (future).
 */
export async function POST(req: Request) {
  try {
    await requireSession(req);
    const body = (await req.json().catch(() => ({}))) as {
      clusterHash?: string;
      name?: string;
      summary?: string;
    };
    if (!body.name) {
      return NextResponse.json(
        { error: "name is required" },
        { status: 400 },
      );
    }
    const result = body.clusterHash
      ? await confirmCandidate({
          clusterHash: body.clusterHash,
          name: body.name,
          summary: body.summary ?? null,
        })
      : await createEmptyThread({
          name: body.name,
          summary: body.summary ?? null,
        });
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 422 });
    }
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    log.error("thread_create_failed", { error: sanitizeError(err) });
    return NextResponse.json(
      { error: sanitizeError(err) },
      { status: 500 },
    );
  }
}
