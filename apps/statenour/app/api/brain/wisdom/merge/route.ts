/**
 * POST /api/brain/wisdom/merge · v10.0.383
 *
 * Merge a near-duplicate wisdom into a primary one. The secondary's
 * seenCount is added to the primary, the secondary is soft-deleted,
 * and a metadata.mergedFrom audit trail is left on the primary.
 *
 * Body:
 *   { primaryId: string, secondaryId: string, mergedContent?: string }
 *
 * If mergedContent is provided · primary's content is replaced with
 * the operator-edited combined version. Otherwise primary keeps its
 * existing content and absorbs the secondary's recall heat.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { withTracing } from "@/lib/utils/with-tracing";

async function handler(req: NextRequest): Promise<Response> {
  // Auth: requireSession invoked below
  try { await requireSession(req); } catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }

  const body = (await req.json().catch(() => ({}))) as {
    primaryId?: string;
    secondaryId?: string;
    mergedContent?: string;
  };

  if (!body.primaryId || !body.secondaryId) {
    return NextResponse.json({ error: "primaryId + secondaryId required" }, { status: 400 });
  }
  if (body.primaryId === body.secondaryId) {
    return NextResponse.json({ error: "cannot merge a memory with itself" }, { status: 400 });
  }

  try {
    const [primary, secondary] = await Promise.all([
      prisma.brainMemory.findUnique({
        where: { id: body.primaryId },
        select: { id: true, content: true, seenCount: true, metadata: true, key: true, category: true },
      }),
      prisma.brainMemory.findUnique({
        where: { id: body.secondaryId },
        select: { id: true, content: true, seenCount: true, key: true },
      }),
    ]);

    if (!primary) return NextResponse.json({ error: "primary not found" }, { status: 404 });
    if (!secondary) return NextResponse.json({ error: "secondary not found" }, { status: 404 });

    const meta = (primary.metadata ?? {}) as Record<string, unknown>;
    const mergedFrom = Array.isArray(meta.mergedFrom) ? (meta.mergedFrom as Array<unknown>) : [];
    mergedFrom.push({
      id: secondary.id,
      key: secondary.key,
      mergedAt: new Date().toISOString(),
      addedSeenCount: secondary.seenCount,
    });
    meta.mergedFrom = mergedFrom;

    // Run the merge in a transaction · primary updated + secondary soft-deleted atomically.
    const [updatedPrimary] = await prisma.$transaction([
      prisma.brainMemory.update({
        where: { id: primary.id },
        data: {
          content:
            body.mergedContent && body.mergedContent.trim().length >= 30
              ? body.mergedContent.trim().slice(0, 2000)
              : primary.content,
          seenCount: primary.seenCount + secondary.seenCount,
          confidence: 1.0, // operator vouched by merging
          createdBy: "user",
          lastSeen: new Date(),
          metadata: meta as never,
        },
        select: { id: true, content: true, seenCount: true, confidence: true },
      }),
      prisma.brainMemory.update({
        where: { id: secondary.id },
        data: {
          deletedAt: new Date(),
          metadata: { mergedInto: primary.id, mergedAt: new Date().toISOString() } as never,
        },
      }),
    ]);

    return NextResponse.json({ ok: true, action: "merged", primary: updatedPrimary });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message?.slice(0, 200) ?? "merge failed" },
      { status: 500 },
    );
  }
}

// Auth: handler above invokes requireSession on first line.
export const POST = withTracing(handler, { name: "/api/brain/wisdom/merge" });
