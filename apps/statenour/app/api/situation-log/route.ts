/**
 * GET/POST /api/situation-log — CRUD for situation logs.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

import { requireSession } from "@/lib/auth-guard";
const createSituationSchema = z.object({
  context: z.string().min(1).max(200),
  situation: z.string().min(1).max(5000),
  emotion: z.string().max(200).optional(),
  response: z.string().max(5000).optional(),
  outcome: z.string().max(5000).optional(),
  lessonLearned: z.string().max(5000).optional(),
  lawBook: z.string().max(100).optional(),
  lawNumber: z.number().int().min(1).optional(),
  urgency: z.enum(["info", "low", "medium", "high", "critical"]).optional(),
});

export async function GET(req: NextRequest) {
  // v10.0.529.105 · Wave 49 · was UNAUTHENTICATED · exposed personal
  // logs (emotions · context · strategic-law refs) to anyone who could
  // reach the URL. POST always had requireSession; GET was skipped.
  // Per docs/CONSOLIDATION-PLAN-2026-05-16.md §Wave 49.
  await requireSession(req);
  const limit = parseInt(req.nextUrl.searchParams.get("limit") || "20");
  const context = req.nextUrl.searchParams.get("context");

  const where: Record<string, unknown> = {};
  if (context) where.context = context;

  const logs = await prisma.situationLog.findMany({
    where,
    include: { law: { select: { id: true, book: true, number: true, title: true, shortTitle: true } } },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 100),
  });

  return NextResponse.json({ logs, total: logs.length });
}

export async function POST(req: NextRequest) {
  await requireSession(req);
  try {
    const { context, situation, emotion, response, outcome, lessonLearned, lawBook, lawNumber, urgency } = createSituationSchema.parse(await req.json());

    let lawId: string | null = null;
    if (lawBook && lawNumber) {
      const law = await prisma.strategicLaw.findUnique({
        where: { book_number: { book: lawBook as any, number: lawNumber } },
      });
      if (law) lawId = law.id;
    }

    const log = await prisma.situationLog.create({
      data: {
        context,
        situation,
        emotion: emotion || null,
        response: response || null,
        outcome: outcome || null,
        lessonLearned: lessonLearned || null,
        lawId,
        urgency: urgency || "info",
      },
      include: { law: true },
    });

    // Durable-fanout wave (audit 2026-07-15) · enrich + embed +
    // thread-join ride the journal/entry.captured Inngest event as
    // durable, retried steps (dispatchJournalFanout degrades to the
    // inline path when the send fails). Never fails the POST.
    void (async () => {
      const { dispatchJournalFanout } = await import("@/lib/brain/journal-fanout");
      await dispatchJournalFanout("situation_log", log.id);
    })().catch(() => { /* dispatch never throws · double net */ });

    return NextResponse.json({ log });
  } catch (err) {
    console.error("[situation-log]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
