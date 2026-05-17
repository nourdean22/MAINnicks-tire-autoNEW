/**
 * /api/social/schedule — schedule via Buffer.
 *
 * v6 · BATCH 4 · Apr 28. POST { text, imageUrl?, linkUrl?, profileIds?, scheduledAt? }
 *
 * Wraps lib/social/buffer.ts. Use when Nour wants a post in Buffer's
 * queue instead of going live immediately. Buffer holds, scheduled
 * time fires, post lands.
 *
 * Auth: session.
 */

import { NextResponse } from "next/server";
import { scheduleBufferPost, listBufferProfiles, checkBufferConnection } from "@/lib/social/buffer";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth-guard";
import { sanitizeError } from "@/lib/utils/sanitize-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ScheduleBody {
  text?: string;
  imageUrl?: string;
  linkUrl?: string;
  profileIds?: string[];
  scheduledAt?: string;
  shareNow?: boolean;
}

export async function GET(req: Request) {
  try { await requireSession(req); } catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }

  // GET returns connection status + connected profiles for the schedule UI
  try {
    const [connection, profiles] = await Promise.all([
      checkBufferConnection(),
      listBufferProfiles().catch(() => []),
    ]);
    return NextResponse.json({
      ok: true,
      connection,
      profiles,
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: sanitizeError(err),
    });
  }
}

export async function POST(req: Request) {
  try { await requireSession(req); } catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }

  let body: ScheduleBody;
  try {
    body = (await req.json()) as ScheduleBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.text || body.text.trim().length === 0) {
    return NextResponse.json({ error: "missing_text" }, { status: 400 });
  }

  // Resolve relative URL like /api/social/publish does
  let absoluteImageUrl: string | undefined = body.imageUrl;
  if (absoluteImageUrl && absoluteImageUrl.startsWith("/")) {
    const host = process.env.NEXT_PUBLIC_APP_URL?.trim()
      || process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim()
      || (req.headers.get("host") ? `https://${req.headers.get("host")}` : "");
    if (host) {
      absoluteImageUrl = host.startsWith("http")
        ? `${host}${body.imageUrl}`
        : `https://${host}${body.imageUrl}`;
    }
  }

  const result = await scheduleBufferPost({
    text: body.text,
    imageUrl: absoluteImageUrl,
    linkUrl: body.linkUrl,
    profileIds: body.profileIds,
    scheduledAt: body.scheduledAt,
    shareNow: body.shareNow,
  });

  void prisma.auditEvent.create({
    data: {
      actor: "social-schedule",
      eventType: result.ok ? "scheduled_buffer" : "schedule_buffer_failed",
      detail: result.ok
        ? `Queued ${result.bufferUpdateIds.length} updates · for ${result.scheduledFor}`
        : `Buffer schedule failed: ${result.error}`,
      payload: {
        bufferUpdateIds: result.bufferUpdateIds,
        scheduledFor: result.scheduledFor,
        error: result.error,
        text: body.text.slice(0, 500),
      },
    },
  }).catch(() => {});

  return NextResponse.json(result);
}
