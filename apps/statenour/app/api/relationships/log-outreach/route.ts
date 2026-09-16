/**
 * /api/relationships/log-outreach · Wave AB Phase 2 · 2026-05-28.
 *
 * Operator hit "log outreach" on a Nick's pick. Records:
 *   1. RelationshipLedger row (+1 deposit · source="outreach") through the
 *      ledger seam, which also moves lastInteraction + interactionCount in
 *      the same transaction (2026-09-16 — this route used to carry its own
 *      copy of that bump; measured before the change, ZERO "outreach" rows
 *      had ever landed in production).
 *   2. BrainMemory(RELATIONSHIPS_OUTREACH) with the draft + rationale
 *      so future Nick reads can see what was sent without scanning SMS
 *
 * Body: { personId, message, rationale? }
 * Returns: { ok, ledgerId, memoryId } — memoryId is null when the secondary
 * memory write failed (the ledger row is the primary record and carries the
 * message in its metadata).
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { logger as rootLogger } from "@/lib/logger";
import {
  PersonNotFoundError,
  recordInteraction,
  type RecordedInteraction,
} from "@/lib/services/people/record-interaction";

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
    const now = new Date();
    const trimmedMessage = message.slice(0, 1000);
    const ledgerNote = `outreach · ${trimmedMessage.slice(0, 160)}${trimmedMessage.length > 160 ? "…" : ""}`;

    let recorded: RecordedInteraction;
    try {
      recorded = await recordInteraction({
        personId: body.personId,
        amount: 1,
        note: ledgerNote,
        source: "outreach",
        at: now,
        metadata: {
          kind: "ai_draft_sent",
          rationale: body.rationale ?? null,
          message: trimmedMessage,
          origin: "ai_drafted",
        },
      });
    } catch (err) {
      if (err instanceof PersonNotFoundError) {
        return NextResponse.json({ error: "not_found" }, { status: 404 });
      }
      throw err;
    }

    // Secondary record — the ledger row above already carries the message.
    let memoryId: string | null = null;
    try {
      const memory = await prisma.brainMemory.create({
        data: {
          category: BRAIN_CATEGORIES.RELATIONSHIPS_OUTREACH,
          key: `${body.personId}:${now.getTime()}`,
          content: `[Outreach · ${recorded.personName}] ${trimmedMessage}`,
          confidence: 1.0,
          source: "operator",
          createdBy: "user",
          metadata: {
            personId: body.personId,
            personName: recorded.personName,
            rationale: body.rationale ?? null,
            message: trimmedMessage,
            loggedAt: now.toISOString(),
          } as never,
        },
        select: { id: true },
      });
      memoryId = memory.id;
    } catch (memErr) {
      log.warn("outreach_memory_failed", {
        err: memErr instanceof Error ? memErr.message : String(memErr),
        personId: body.personId,
      });
    }

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
      ledgerId: recorded.ledgerId,
      memoryId,
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
