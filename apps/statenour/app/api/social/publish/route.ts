/**
 * /api/social/publish — unified social publish endpoint.
 *
 * v6 · BATCH 4 · Apr 28. POST { platforms: ["instagram"|"facebook"], imageUrl, caption, message? }
 * → { results: PublishResult[] }
 *
 * Direct publish to Meta IG + FB. Buffer scheduling lives at /api/social/schedule.
 *
 * misc-pages slice (2026-05-22 · legacy-modernizer REST→tRPC) · the
 * publish + audit logic moved to the shared `lib/services/social-actions`
 * module the `operator.socialPublish` tRPC procedure also calls ·
 * drift structurally impossible. The route stays mounted as the
 * rollback path.
 *
 * Auth: session. POST is irreversible — caller MUST have shown explicit
 * confirmation in the UI before hitting this endpoint.
 */

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import {
  publishSocialPost,
  SocialPublishInputError,
  SocialImageUrlUnresolvedError,
} from "@/lib/services/social-actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

interface PublishBody {
  platforms?: Array<"instagram" | "facebook">;
  imageUrl?: string;
  videoUrl?: string;
  caption?: string;
  /** FB-only — for text-without-image posts */
  message?: string;
  linkUrl?: string;
}

export async function POST(req: Request) {
  try { await requireSession(req); } catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }

  let body: PublishBody;
  try {
    body = (await req.json()) as PublishBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  try {
    const result = await publishSocialPost(
      {
        platforms: body.platforms ?? [],
        imageUrl: body.imageUrl,
        videoUrl: body.videoUrl,
        caption: body.caption,
        message: body.message,
        linkUrl: body.linkUrl,
      },
      req.headers.get("host") ?? undefined,
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof SocialPublishInputError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof SocialImageUrlUnresolvedError) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
    throw err;
  }
}
