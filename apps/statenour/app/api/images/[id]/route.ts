/**
 * GET /api/images/[id] — Serve a generated image by ID.
 * Images are stored as base64 in AuditEvent payload.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const record = await prisma.auditEvent.findUnique({
    where: { id },
    select: { payload: true, eventType: true },
  });

  if (!record || record.eventType !== "generated_image") {
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  }

  const payload = record.payload as Record<string, unknown>;
  const base64 = payload?.base64 as string;

  if (!base64) {
    return NextResponse.json({ error: "No image data" }, { status: 404 });
  }

  const buffer = Buffer.from(base64, "base64");

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400",
      "Content-Length": String(buffer.length),
    },
  });
}
