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
import { logger as rootLogger } from "@/lib/logger";
import { sanitizeError } from "@/lib/utils/sanitize-error";
import {
  confirmCandidate,
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
    log.error("threads_list_failed", { error: sanitizeError(err) });
    return NextResponse.json(
      { error: sanitizeError(err) },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    await requireSession(req);
    const body = (await req.json().catch(() => ({}))) as {
      clusterHash?: string;
      name?: string;
      summary?: string;
    };
    if (!body.clusterHash || !body.name) {
      return NextResponse.json(
        { error: "clusterHash and name are required" },
        { status: 400 },
      );
    }
    const result = await confirmCandidate({
      clusterHash: body.clusterHash,
      name: body.name,
      summary: body.summary ?? null,
    });
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 422 });
    }
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    log.error("thread_create_failed", { error: sanitizeError(err) });
    return NextResponse.json(
      { error: sanitizeError(err) },
      { status: 500 },
    );
  }
}
