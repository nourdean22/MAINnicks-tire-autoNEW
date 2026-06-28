/**
 * GET /api/intelligence/sources — owner-only · list all registered intelligence sources
 * POST /api/intelligence/sources — owner-only · register a new intelligence source
 */
import { prisma } from "@/lib/prisma";
import { apiHandler, readRequestJson } from "@/lib/utils/http";
import { z } from "zod";

export const dynamic = "force-dynamic";

const CreateSourceSchema = z.object({
  name: z.string().min(2),
  url: z.string().url(),
  domain: z.enum(["ai", "seo", "competitor", "automotive", "macro"]),
  sourceType: z.enum(["official", "primary", "secondary", "community"]),
  authScore: z.number().min(0).max(100).optional(),
  refreshInterval: z.number().int().positive().optional(),
});

export const GET = apiHandler(async (req) => {
  const url = new URL(req.url);
  const domain = url.searchParams.get("domain") || undefined;

  const sources = await prisma.registeredSource.findMany({
    where: domain ? { domain } : {},
    orderBy: { createdAt: "desc" },
  });

  return { sources };
}, { auth: "owner" });

export const POST = apiHandler(async (req) => {
  const payload = await readRequestJson(req);
  const parsed = CreateSourceSchema.parse(payload);

  const existing = await prisma.registeredSource.findUnique({
    where: { url: parsed.url },
  });

  if (existing) {
    return {
      error: "Conflict",
      message: `A source with URL ${parsed.url} is already registered.`,
      source: existing,
    };
  }

  const defaultAuthScores: Record<string, number> = {
    official: 95.0,
    primary: 85.0,
    secondary: 60.0,
    community: 40.0,
  };

  const newSource = await prisma.registeredSource.create({
    data: {
      name: parsed.name,
      url: parsed.url,
      domain: parsed.domain,
      sourceType: parsed.sourceType,
      authScore: parsed.authScore ?? defaultAuthScores[parsed.sourceType] ?? 70.0,
      refreshInterval: parsed.refreshInterval ?? 86400,
    },
  });

  return { source: newSource };
}, { auth: "owner" });
