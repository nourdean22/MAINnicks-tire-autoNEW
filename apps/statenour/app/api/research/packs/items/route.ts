/**
 * /api/research/packs/items — List Research Pack Items Endpoint
 *
 * GET → Returns claims, contradictions, actions, and questions for a pack.
 *
 * Secured by owner-auth.
 */

import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { redactPaths } from "@/lib/research/redact";

export const GET = apiHandler(
  async (req) => {
    const { searchParams } = new URL(req.url);
    const slug = searchParams.get("slug");

    if (!slug) {
      return Response.json({ error: "slug query param is required" }, { status: 400 });
    }

    const items = await prisma.brainMemory.findMany({
      where: {
        category: {
          in: [
            "research_claim",
            "research_contradiction",
            "research_action",
            "research_question",
          ],
        },
        deletedAt: null,
        metadata: {
          path: ["slug"],
          equals: slug,
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    const parsedItems = items.map((p) => {
      const meta = (p.metadata as Record<string, any>) || {};
      return {
        id: p.id,
        category: p.category,
        key: p.key,
        content: redactPaths(p.content),
        citation: meta.citation ? redactPaths(meta.citation) : null,
        requiresSourceVerification: meta.requiresSourceVerification || false,
        verificationScore: meta.verificationScore || 1.0,
        verificationStatus: meta.verification_status || "source_supported",
      };
    });

    return parsedItems;
  },
  { auth: "owner" }
);
