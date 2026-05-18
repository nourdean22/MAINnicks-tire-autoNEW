/**
 * /api/journal/suggestions · ADR-0013 · Phase D follow-up
 *
 * Owner-only · entries the capture-hook scored in the 0.65-0.80
 * SUGGEST band (between auto-join and ignore). Operator confirms
 * or rejects each one.
 *
 *   GET     /api/journal/suggestions          → ThreadSuggestion[]
 *   POST    /api/journal/suggestions          → accept · body { key }
 *   DELETE  /api/journal/suggestions?key=...  → dismiss
 */

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { logger as rootLogger } from "@/lib/logger";
import { sanitizeError } from "@/lib/utils/sanitize-error";
import {
  acceptThreadSuggestion,
  dismissThreadSuggestion,
  listThreadSuggestions,
} from "@/lib/services/journal-threads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 15;

const log = rootLogger.withSurface("api/journal/suggestions");

export async function GET(req: Request) {
  try {
    await requireSession(req);
    const data = await listThreadSuggestions();
    return NextResponse.json({ data });
  } catch (err) {
    log.error("suggestions_list_failed", { error: sanitizeError(err) });
    return NextResponse.json(
      { error: sanitizeError(err) },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    await requireSession(req);
    const body = (await req.json().catch(() => ({}))) as { key?: string };
    if (!body.key) {
      return NextResponse.json(
        { error: "key required" },
        { status: 400 },
      );
    }
    const result = await acceptThreadSuggestion(body.key);
    if (!result.joined && result.error) {
      return NextResponse.json({ error: result.error }, { status: 422 });
    }
    return NextResponse.json(result);
  } catch (err) {
    log.error("suggestion_accept_failed", { error: sanitizeError(err) });
    return NextResponse.json(
      { error: sanitizeError(err) },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
  try {
    await requireSession(req);
    const url = new URL(req.url);
    const key = url.searchParams.get("key");
    if (!key) {
      return NextResponse.json(
        { error: "key query param required" },
        { status: 400 },
      );
    }
    const result = await dismissThreadSuggestion(key);
    return NextResponse.json(result);
  } catch (err) {
    log.error("suggestion_dismiss_failed", { error: sanitizeError(err) });
    return NextResponse.json(
      { error: sanitizeError(err) },
      { status: 500 },
    );
  }
}
