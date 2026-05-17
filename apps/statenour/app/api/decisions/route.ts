import { prisma } from "@/lib/prisma";
import { apiHandler } from "@/lib/utils/http";
import { ServiceError } from "@/lib/utils/service-error";
import { today } from "@/lib/utils/datetime";
import { logCreate, logUpdate, stripNoise } from "@/lib/db/entity-audit";

// v9.1.14 · GET added `auth: "owner"` — leaked operator decisions.
export const GET = apiHandler(async () => {
  const decisions = await prisma.masteryDecision.findMany({
    orderBy: { date: "desc" },
    take: 50,
  });

  const pendingReview = await prisma.masteryDecision.findMany({
    where: {
      // v9.1.13 · also added deletedAt:null upstream.
      deletedAt: null,
      reviewDate: { lte: today() },
      actualOutcome: null,
    },
  });

  return { decisions, pending_review: pendingReview };
}, { auth: "owner" });

export const POST = apiHandler(async (req) => {
  const body = await req.json();

  if (body.action === "grade" && body.id) {
    // v8.0 — capture before-state for audit diff.
    const before = await prisma.masteryDecision.findUnique({ where: { id: body.id } });
    const updated = await prisma.masteryDecision.update({
      where: { id: body.id },
      data: {
        actualOutcome: body.actual_outcome,
        grade: body.grade,
      },
    });
    if (before) {
      void logUpdate(
        "masteryDecision",
        String(updated.id),
        stripNoise(before as unknown as Record<string, unknown>),
        stripNoise(updated as unknown as Record<string, unknown>),
        { source: "api:decisions.POST.grade", reason: "outcome graded" },
      );
    }
    return { ok: true };
  }

  const { title, domain, stakes, context, options_considered, chosen, reasoning, predicted_outcome, emotional_state, review_date } = body;
  if (!title) throw new ServiceError("title required", 400);

  const created = await prisma.masteryDecision.create({
    data: {
      date: today(),
      title,
      domain: domain || null,
      stakes: stakes || null,
      context: context || null,
      optionsConsidered: JSON.stringify(options_considered || []),
      chosen: chosen || null,
      reasoning: reasoning || null,
      predictedOutcome: predicted_outcome || null,
      emotionalState: emotional_state || null,
      reviewDate: review_date || null,
    },
  });

  // v8.0 — entity-audit create.
  void logCreate("masteryDecision", String(created.id), created as unknown as Record<string, unknown>, {
    source: "api:decisions.POST.create",
  });

  return { ok: true, id: created.id };
}, { auth: "owner" });
