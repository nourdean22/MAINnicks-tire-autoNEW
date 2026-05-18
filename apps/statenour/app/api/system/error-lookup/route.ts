/**
 * GET /api/system/error-lookup?errorId=err_xxx · Phase K (2026-05-18 PM)
 *
 * Returns the sanitized ErrorLog row for a given errorId. Closes the
 * H.7.1 loop · the sanitizer returns errorId to the wire and now
 * persists the full sanitized entry to ErrorLog · the operator types
 * the errorId here and gets the full context without grepping Railway
 * runtime logs.
 *
 * Owner-only. Also supports ?recent=N to list the last N sanitized
 * errors (when the operator doesn't know which errorId to look up).
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth-guard";
import { ServiceError } from "@/lib/utils/service-error";
import { sanitizeError } from "@/lib/ai/reasoning/error-sanitizer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 15;

interface LookupRow {
  id: string;
  errorId: string | null;
  level: string;
  message: string;
  route: string | null;
  op: string | null;
  classified: string | null;
  rawMsg: string | null;
  stack: string | null;
  createdAt: string;
}

export async function GET(req: Request) {
  try {
    await requireSession(req);
    const url = new URL(req.url);
    const errorId = url.searchParams.get("errorId");
    const recent = url.searchParams.get("recent");

    if (errorId) {
      // Lookup by exact errorId · search content + context JSON
      const rows = await prisma.errorLog.findMany({
        where: {
          OR: [
            { message: { contains: errorId } },
            // Prisma JSON path query · context.errorId equals
            // (the JSON contains operator via @> would be ideal but
            // varies by driver · contains-search is fine for cuid-like keys)
            { context: { path: ["errorId"], equals: errorId } },
          ],
        },
        orderBy: { createdAt: "desc" },
        take: 5,
      });
      return NextResponse.json(
        { errorId, matches: rows.map(rowToLookupRow) },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }

    // Default · last N sanitized errors
    const limit = Math.max(
      1,
      Math.min(100, Number(recent ?? 50)),
    );
    const rows = await prisma.errorLog.findMany({
      where: {
        context: { path: ["kind"], equals: "sanitized_error" },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return NextResponse.json(
      { recent: rows.map(rowToLookupRow) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const { publicMessage, errorId } = sanitizeError(err, {
      route: "/api/system/error-lookup",
      op: "GET",
    });
    return NextResponse.json(
      { error: "lookup_failed", message: publicMessage, errorId },
      { status: 500 },
    );
  }
}

function rowToLookupRow(r: {
  id: string;
  level: string;
  message: string;
  stack: string | null;
  context: unknown;
  createdAt: Date;
}): LookupRow {
  const ctx = (r.context ?? {}) as {
    errorId?: string;
    route?: string;
    op?: string;
    rawMsg?: string;
    classified?: string;
  };
  return {
    id: r.id,
    errorId: ctx.errorId ?? null,
    level: r.level,
    message: r.message,
    route: ctx.route ?? null,
    op: ctx.op ?? null,
    classified: ctx.classified ?? null,
    rawMsg: ctx.rawMsg ?? null,
    stack: r.stack,
    createdAt: r.createdAt.toISOString(),
  };
}
