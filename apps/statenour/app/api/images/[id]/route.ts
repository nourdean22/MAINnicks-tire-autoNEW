/**
 * GET /api/images/[id] — Serve a generated image by ID.
 * Images are stored as base64 in AuditEvent payload.
 *
 * 2026-09-07 (program D13) · capability URLs. `?exp=&sig=` is verified by
 * lib/images/signed-url.ts; with IMAGES_REQUIRE_SIGNATURE=1 a raw id is
 * refused (401). Flag off keeps raw access (chat markdown, /content
 * publish, Meta fetches) byte-identical — but a PRESENT and invalid
 * signature is always refused, so a tampered link never degrades to public.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizeImageRequest } from "@/lib/images/signed-url";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const auth = authorizeImageRequest({
    id,
    exp: req.nextUrl.searchParams.get("exp"),
    sig: req.nextUrl.searchParams.get("sig"),
  });
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }

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

  // A signed link must not be cached past its own expiry.
  const maxAge = auth.expiresAt
    ? Math.max(0, Math.min(86_400, Math.floor((auth.expiresAt - Date.now()) / 1000)))
    : 86_400;

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": `public, max-age=${maxAge}`,
      "Content-Length": String(buffer.length),
    },
  });
}
