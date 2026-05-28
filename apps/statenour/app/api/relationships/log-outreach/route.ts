/**
 * /api/relationships/log-outreach · Wave AB Phase 2 · 2026-05-28.
 *
 * Operator hit "log outreach" on a Nick's pick. Records:
 *   1. RelationshipLedger row (+1 deposit · source="outreach")
 *   2. BrainMemory(RELATIONSHIPS_OUTREACH) with the draft + rationale
 *      so future Nick reads can see what was sent without scanning SMS
 *   3. Touches PersonProfile.lastInteraction = now
 *
 * Body: { personId, message, rationale? }
 * Returns: { ok, ledgerId, memoryId }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("api/relationships/log-outreach");

interface RequestBody {
  personId: string;
  message: string;
  rationale?: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    await requireSession(req);
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const message = (body.message ?? "").trim();
  if (!body?.personId || !message) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  try {
    const person = await prisma.personProfile.findUnique({
      where: { id: body.personId },
      select: { id: true, name: true },
    });
    if (!person) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const now = new Date();
    const trimmedMessage = message.slice(0, 1000);
    const ledgerNote = `outreach · ${trimmedMessage.slice(0, 160)}${trimmedMessage.length > 160 ? "…" : ""}`;

    const [ledger, memory] = await prisma.$transaction([
      prisma.relationshipLedger.create({
        data: {
          personId: body.personId,
          amount: 1,
          note: ledgerNote,
          source: "outreach",
          metadata: {
            kind: "ai_draft_sent",
            rationale: body.rationale ?? null,
            message: trimmedMessage,
            origin: "ai_drafted",
          } as never,
        },
        select: { id: true },
      }),
      prisma.brainMemory.create({
        data: {
          category: BRAIN_CATEGORIES.RELATIONSHIPS_OUTREACH,
          key: `${body.personId}:${now.getTime()}`,
          content: `[Outreach · ${person.name}] ${trimmedMessage}`,
          confidence: 1.0,
          source: "operator",
          createdBy: "user",
          metadata: {
            personId: body.personId,
            personName: person.name,
            rationale: body.rationale ?? null,
            message: trimmedMessage,
            loggedAt: now.toISOString(),
          } as never,
        },
        select: { id: true },
      }),
      prisma.personProfile.update({
        where: { id: body.personId },
        data: { lastInteraction: now, interactionCount: { increment: 1 } },
        select: { id: true },
      }),
    ]);

    // Invalidate today's picks cache so the just-logged person doesn't
    // keep appearing in the picks list.
    try {
      const today = now.toISOString().slice(0, 10);
      await prisma.brainMemory.deleteMany({
        where: {
          category: BRAIN_CATEGORIES.RELATIONSHIPS_PICKS_TODAY,
          key: today,
        },
      });
    } catch (cacheErr) {
      log.warn("picks_cache_invalidation_failed", {
        err:
          cacheErr instanceof Error ? cacheErr.message : String(cacheErr),
      });
    }

    return NextResponse.json({
      ok: true,
      ledgerId: ledger.id,
      memoryId: memory.id,
    });
  } catch (err) {
    log.error("log_outreach_failed", {
      err: err instanceof Error ? err.message : String(err),
      personId: body.personId,
    });
    return NextResponse.json(
      { error: "log_failed" },
      { status: 500 },
    );
  }
}
