// /api/brain/escalations — return the most-recent unresolved escalation.
//
// v7 · BATCH 2F · Apr 28. Powers the chat placeholder + HQ banner +
// any UI surface that wants to know "is something on fire right now?"
//
// v10.0.529.106 · Wave 79 · migrated to apiHandler wrapper. Returns
// raw NextResponse so the existing UI (which reads {escalation: ...})
// continues to see the same top-level shape. Wrapper still adds
// rate limiting, normalized auth, audit trace IDs, error sanitization.

import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = apiHandler(
  async () => {
    // Latest escalation in the last 6h
    const recent = await prisma.brainMemory
      .findFirst({
        where: {
          category: "lead_escalation",
          createdAt: { gte: new Date(Date.now() - 6 * 60 * 60 * 1000) },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, content: true, metadata: true, createdAt: true },
      })
      .catch(() => null);

    if (!recent) return NextResponse.json({ escalation: null });

    return NextResponse.json({
      escalation: {
        id: recent.id,
        content: recent.content,
        metadata: recent.metadata,
        ageMinutes: Math.round((Date.now() - recent.createdAt.getTime()) / 60_000),
      },
    });
  },
  { auth: "owner" },
);
