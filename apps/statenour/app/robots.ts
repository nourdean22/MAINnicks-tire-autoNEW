import type { MetadataRoute } from "next";

/**
 * /robots.txt — block all crawlers.
 *
 * statenour-os is a private owner-only surface. Every /mastery/* page
 * is behind Google OAuth (see middleware.ts), so search-engine crawlers
 * can never see the content — but until this file existed, bots would
 * hit the root and get a 404 (which Vercel logs as noise).
 *
 * `disallow: "/"` tells well-behaved crawlers to skip the whole domain
 * without trying to enumerate paths. Silences the 404 pattern surfaced
 * by the 2026-04-22 deep deploy audit.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        disallow: "/",
      },
    ],
  };
}
