/**
 * /api/social/schedule — schedule via Buffer.
 *
 * v6 · BATCH 4 · Apr 28. POST { text, imageUrl?, linkUrl?, profileIds?, scheduledAt? }
 *
 * Wraps lib/social/buffer.ts. Use when Nour wants a post in Buffer's
 * queue instead of going live immediately. Buffer holds, scheduled
 * time fires, post lands.
 *
 * misc-pages slice (2026-05-22 · legacy-modernizer REST→tRPC) · the
 * GET (connection + profiles) and POST (schedule + audit) moved to the
 * shared `lib/services/social-actions` module the
 * `operator.socialSchedule` / `operator.scheduleSocialPost` tRPC
 * procedures also call · drift structurally impossible. The route
 * stays mounted as the rollback path.
 *
 * Auth: session.
 */

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import {
  getSocialSchedule,
  scheduleSocialPost,
  SocialScheduleInputError,
} from "@/lib/services/social-actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ScheduleBody {
  text?: string;
  imageUrl?: string;
  videoUrl?: string;
  linkUrl?: string;
  profileIds?: string[];
  scheduledAt?: string;
  shareNow?: boolean;
}

export async function GET(req: Request) {
  try { await requireSession(req); } catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }
  return NextResponse.json(await getSocialSchedule());
}

export async function POST(req: Request) {
  try { await requireSession(req); } catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }

  let body: ScheduleBody;
  try {
    body = (await req.json()) as ScheduleBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  try {
    const result = await scheduleSocialPost(
      {
        text: body.text ?? "",
        imageUrl: body.imageUrl,
        videoUrl: body.videoUrl,
        linkUrl: body.linkUrl,
        profileIds: body.profileIds,
        scheduledAt: body.scheduledAt,
        shareNow: body.shareNow,
      },
      req.headers.get("host") ?? undefined,
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof SocialScheduleInputError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
