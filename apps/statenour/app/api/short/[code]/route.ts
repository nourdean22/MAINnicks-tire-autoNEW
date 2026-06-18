import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { apiHandler } from "@/lib/utils/http";
import { getClientIp } from "@/lib/rate-limit";
import { ServiceError } from "@/lib/utils/service-error";

export const dynamic = "force-dynamic";

/**
 * GET /api/short/[code]
 * Wildcard short link redirector. Matches [code] against ShortLink.
 * Anonymizes client IP, logs referrer/User-Agent, appends UTM params,
 * and performs a 302 redirect.
 */
export const GET = apiHandler(
  async (req, { params }) => {
    const { code } = await params!;
    if (!code) {
      throw new ServiceError("Short code is required", 400);
    }

    // Find the short link
    const shortLink = await prisma.shortLink.findUnique({
      where: { id: code },
    });

    if (!shortLink) {
      throw new ServiceError("Short link not found", 404);
    }

    // 1. Increment click count
    await prisma.shortLink.update({
      where: { id: code },
      data: { clickCount: { increment: 1 } },
    });

    // 2. Log click details
    const ip = getClientIp(req);
    const ipHash = createHash("sha256").update(ip).digest("hex");
    const userAgent = req.headers.get("user-agent") || null;
    const referrer = req.headers.get("referer") || req.headers.get("referrer") || null;

    await prisma.linkClick.create({
      data: {
        shortLinkId: code,
        ipHash,
        userAgent,
        referrer,
      },
    });

    // 3. Append UTM parameters if applicable
    let redirectUrl = shortLink.url;
    try {
      // If it's a relative URL, resolve it using request's origin
      const baseUrl = new URL(req.url).origin;
      const destinationUrl = new URL(shortLink.url, baseUrl);

      if (shortLink.source && !destinationUrl.searchParams.has("utm_source")) {
        destinationUrl.searchParams.set("utm_source", shortLink.source);
      }
      if (shortLink.medium && !destinationUrl.searchParams.has("utm_medium")) {
        destinationUrl.searchParams.set("utm_medium", shortLink.medium);
      }
      if (shortLink.campaign && !destinationUrl.searchParams.has("utm_campaign")) {
        destinationUrl.searchParams.set("utm_campaign", shortLink.campaign);
      }
      redirectUrl = destinationUrl.toString();
    } catch (e) {
      // Fallback if URL parsing fails
    }

    // 4. Perform 302 redirect
    return NextResponse.redirect(redirectUrl, 302);
  },
  { auth: "none" }
);
