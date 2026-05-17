/**
 * /api/social/publish — unified social publish endpoint.
 *
 * v6 · BATCH 4 · Apr 28. POST { platforms: ["instagram"|"facebook"], imageUrl, caption, message? }
 * → { results: PublishResult[] }
 *
 * Direct publish to Meta IG + FB. Buffer scheduling lives at /api/social/schedule.
 *
 * Auth: session. POST is irreversible — caller MUST have shown explicit
 * confirmation in the UI before hitting this endpoint. Rate-limit: 5/min
 * per user (we don't want a typo to fire 30 IG posts).
 */

import { NextResponse } from "next/server";
import { publishToInstagram, publishToFacebook, type PublishResult } from "@/lib/social/meta-publish";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

interface PublishBody {
  platforms?: Array<"instagram" | "facebook">;
  imageUrl?: string;
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

  const platforms = (body.platforms ?? []).filter(
    (p) => p === "instagram" || p === "facebook",
  );
  if (platforms.length === 0) {
    return NextResponse.json({ error: "no_platforms" }, { status: 400 });
  }
  if (!body.caption && !body.message) {
    return NextResponse.json({ error: "missing_text" }, { status: 400 });
  }
  if (platforms.includes("instagram") && !body.imageUrl) {
    return NextResponse.json({ error: "instagram_requires_image" }, { status: 400 });
  }

  // Resolve relative imageUrl to absolute (Meta needs public URL)
  let absoluteImageUrl: string | undefined = body.imageUrl;
  if (absoluteImageUrl && absoluteImageUrl.startsWith("/")) {
    const host = process.env.NEXT_PUBLIC_APP_URL?.trim()
      || process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim()
      || (req.headers.get("host") ? `https://${req.headers.get("host")}` : "");
    if (!host) {
      return NextResponse.json(
        { error: "cannot_resolve_image_url — set NEXT_PUBLIC_APP_URL or VERCEL_PROJECT_PRODUCTION_URL" },
        { status: 500 },
      );
    }
    absoluteImageUrl = host.startsWith("http") ? `${host}${body.imageUrl}` : `https://${host}${body.imageUrl}`;
  }

  // Run publishes in parallel — IG and FB are independent paths.
  const tasks: Promise<PublishResult>[] = [];
  if (platforms.includes("instagram")) {
    tasks.push(publishToInstagram({
      imageUrl: absoluteImageUrl!,
      caption: body.caption || body.message || "",
    }));
  }
  if (platforms.includes("facebook")) {
    tasks.push(publishToFacebook({
      message: body.message || body.caption || "",
      imageUrl: absoluteImageUrl,
      linkUrl: body.linkUrl,
    }));
  }

  const results = await Promise.all(tasks);

  // Audit each publish so /system/events shows it
  for (const r of results) {
    void prisma.auditEvent.create({
      data: {
        actor: "social-publish",
        eventType: r.ok ? `published_${r.platform}` : `publish_failed_${r.platform}`,
        detail: r.ok
          ? `Posted to ${r.platform} · ${r.permalink ?? r.postId}`
          : `Failed ${r.platform}: ${r.error}`,
        payload: {
          platform: r.platform,
          postId: r.postId,
          permalink: r.permalink,
          error: r.error,
          caption: (body.caption ?? body.message ?? "").slice(0, 500),
        },
      },
    }).catch(() => {});
  }

  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.length - succeeded;

  return NextResponse.json({
    ok: failed === 0,
    succeeded,
    failed,
    results,
  });
}
