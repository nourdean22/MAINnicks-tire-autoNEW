/**
 * /api/research/packs — List Research Packs Endpoint
 *
 * GET → Returns all ingested research packs metadata.
 *
 * Secured by owner-auth.
 */

import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { redactPaths } from "@/lib/research/redact";

export const GET = apiHandler(
  async () => {
    const packs = await prisma.brainMemory.findMany({
      where: {
        category: "research_pack",
        deletedAt: null,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    const parsedPacks = packs.map((p) => {
      const meta = (p.metadata as Record<string, any>) || {};
      return {
        id: p.id,
        key: p.key,
        content: redactPaths(p.content), // Redact absolute paths in manifest text
        slug: meta.slug || p.key.replace("pack_", ""),
        domain: meta.domain || "general",
        sourceCount: meta.sourceCount || 0,
        confidence: meta.confidence || 0.85,
        ingestedAt: meta.ingestedAt || p.createdAt,
      };
    });

    return parsedPacks;
  },
  { auth: "owner" }
);
