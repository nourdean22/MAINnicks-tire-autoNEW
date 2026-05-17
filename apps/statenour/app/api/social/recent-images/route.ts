/**
 * /api/social/recent-images — last N generated images for the publish picker.
 *
 * v6 · BATCH 4 · Apr 28. Used by the /social UI to populate the
 * "recent generated" thumbnail strip so Nour can publish a fresh image
 * without remembering its ID.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  try { await requireSession(req); } catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }

  const rows = await prisma.auditEvent
    .findMany({
      where: {
        OR: [
          { eventType: "generated_image" },
          { eventType: "upscaled_image" },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 24,
      select: { id: true, detail: true, createdAt: true, eventType: true },
    })
    .catch(() => [] as Array<{ id: string; detail: string | null; createdAt: Date; eventType: string }>);

  return NextResponse.json({
    ok: true,
    images: rows.map((r) => ({
      id: r.id,
      detail: r.detail ?? "",
      createdAt: r.createdAt.toISOString(),
      eventType: r.eventType,
    })),
  });
}
