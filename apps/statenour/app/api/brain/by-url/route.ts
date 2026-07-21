/**
 * GET /api/brain/by-url · Wave J · 2026-05-23.
 *
 * Token-authed endpoint for the Chrome extension's F3 "page-aware
 * re-discovery" feature. Given a URL, returns the operator's prior
 * brain captures that mention that URL (in metadata.sourceUrl) OR
 * that domain (in content/metadata text).
 *
 * Why this matters · the operator clipped a competitor's pricing page
 * 3 months ago; today they're on that same page. Without this endpoint
 * they'd have to remember the prior note + go searching. With it, the
 * extension popup shows "you have 2 prior notes on this URL · expand"
 * before they even type.
 *
 * Query:
 *   ?url=<encoded>         · required · the current tab's URL
 *   ?limit=<n>             · optional · 1..20 · default 5
 *
 * Returns:
 *   200 · { url, domain, notes: [{ id, content, capturedAt, category }] }
 *   401 · { error: "invalid token" }
 *   400 · { error: "url required" }
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { validateToken } from "@/lib/auth/extension-token";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("api/brain/by-url");

const QueryInput = z.object({
  url: z.string().url().max(2000),
  limit: z.coerce.number().int().min(1).max(20).optional(),
});

export const dynamic = "force-dynamic";

function extractDomain(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const token = await validateToken(auth);
  if (!token) {
    return Response.json({ error: "invalid token" }, { status: 401 });
  }

  const url = req.nextUrl.searchParams.get("url");
  const limitRaw = req.nextUrl.searchParams.get("limit");
  let parsed: z.infer<typeof QueryInput>;
  try {
    parsed = QueryInput.parse({
      url: url ?? "",
      limit: limitRaw ?? undefined,
    });
  } catch (e) {
    return Response.json(
      {
        error: "validation",
        detail: e instanceof Error ? e.message.slice(0, 200) : String(e),
      },
      { status: 400 },
    );
  }

  const limit = parsed.limit ?? 5;
  const domain = extractDomain(parsed.url);

  try {
    // Two-pass lookup:
    //   1. EXACT URL match · metadata->>sourceUrl equals the input URL
    //   2. DOMAIN match · metadata->>sourceUrl contains the domain
    //      OR content contains the domain (fallback for older rows)
    // De-duplicated by id. Newest first.
    const exact = await prisma.brainMemory.findMany({
      where: {
        deletedAt: null,
        metadata: { path: ["sourceUrl"], equals: parsed.url },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        content: true,
        category: true,
        createdAt: true,
        metadata: true,
      },
    });

    // If we hit the limit on exact, skip the domain fallback.
    let domainHits: typeof exact = [];
    if (exact.length < limit && domain) {
      const remaining = limit - exact.length;
      // Use string_contains on the metadata.sourceUrl path · falls back
      // to content match for legacy rows pre-Wave-J.
      domainHits = await prisma.brainMemory.findMany({
        where: {
          deletedAt: null,
          // Skip rows already in exact[]
          id: { notIn: exact.map((e) => e.id) },
          OR: [
            { metadata: { path: ["sourceUrl"], string_contains: domain } },
            { content: { contains: domain, mode: "insensitive" } },
          ],
        },
        orderBy: { createdAt: "desc" },
        take: remaining,
        select: {
          id: true,
          content: true,
          category: true,
          createdAt: true,
          metadata: true,
        },
      });
    }

    const allRows = [...exact, ...domainHits];

    const notes = allRows.map((r) => {
      const meta = (r.metadata ?? {}) as {
        sourceUrl?: string | null;
        sourceTitle?: string | null;
      };
      return {
        id: r.id,
        content: r.content.slice(0, 400),
        category: r.category,
        capturedAt: r.createdAt.toISOString(),
        sourceUrl: meta.sourceUrl ?? null,
        sourceTitle: meta.sourceTitle ?? null,
      };
    });

    log.info("by_url_lookup", {
      tokenLabel: token.label,
      domain,
      exactHits: exact.length,
      domainHits: domainHits.length,
    });

    return Response.json({
      url: parsed.url,
      domain,
      notes,
    });
  } catch (e) {
    log.warn("by_url_lookup_failed", {
      err: e instanceof Error ? e.message.slice(0, 200) : String(e),
    });
    // truth-substrate audit P0 (#6): the lookup FAILED — do not present the empty
    // result as fact. `lookupFailed: true` lets the client distinguish "this read
    // errored" from "this URL genuinely has no prior notes" (previously identical:
    // notes:[] + 200). Kept 200 + notes:[] for backward-compatible clients.
    return Response.json(
      { url: parsed.url, domain, notes: [], lookupFailed: true },
      { status: 200 },
    );
  }
}
