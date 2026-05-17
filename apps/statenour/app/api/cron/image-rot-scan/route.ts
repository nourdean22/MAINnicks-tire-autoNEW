// /api/cron/image-rot-scan — daily check that generated-image URLs still resolve.
//
// v7 · BATCH 6 · Apr 28. Walks recent auditEvent rows for generated_image
// + upscaled_image, validates the payload's base64 still exists. If the
// payload's gone (somehow corrupted), flags the row so chat history
// doesn't render as broken-image.
//
// Vercel cron schedule: "0 13 * * *"  (8am Cleveland)

import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";

const MAX_ROWS_PER_RUN = 200;

export const maxDuration = 60;

export const GET = cronHandler(async () => {
  // Only check images created in the last 30d (older ones are
  // exposed via cleanup crons separately)
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const rows = await prisma.auditEvent.findMany({
    where: {
      eventType: { in: ["generated_image", "upscaled_image"] },
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
    take: MAX_ROWS_PER_RUN,
    select: { id: true, payload: true, createdAt: true },
  }).catch(() => [] as Array<{ id: string; payload: unknown; createdAt: Date }>);

  let healthy = 0;
  let rotted = 0;
  const rottedIds: string[] = [];

  for (const r of rows) {
    const payload = r.payload as { base64?: string } | null;
    if (!payload?.base64 || typeof payload.base64 !== "string" || payload.base64.length < 100) {
      rotted++;
      rottedIds.push(r.id);
    } else {
      healthy++;
    }
  }

  if (rotted > 0) {
    await prisma.brainMemory.create({
      data: {
        category: "image_rot_alert",
        key: `rot:${new Date().toISOString().split("T")[0]}`,
        source: "image_rot_scan",
        content: `🖼️ ${rotted} image records have missing/corrupted payload (out of ${rows.length} scanned).`,
        confidence: 0.95,
        metadata: {
          scanned: rows.length,
          rotted,
          rottedIds: rottedIds.slice(0, 50),
        } as unknown as Parameters<typeof prisma.brainMemory.create>[0]["data"]["metadata"],
      },
    }).catch(() => {});
  }

  return {
    ok: true,
    scanned: rows.length,
    healthy,
    rotted,
    summary: `${healthy} healthy · ${rotted} rotted (${rows.length} scanned)`,
  };
});

export const POST = GET;
