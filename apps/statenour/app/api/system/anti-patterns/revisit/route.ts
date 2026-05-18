import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

/**
 * POST /api/system/anti-patterns/revisit — mark an anti-pattern as
 * revisited. Bumps revisitCount + lastRevisitedAt so the UI + Nick
 * tool can surface "revisited 3x — pattern confirmed" signal.
 */

const Schema = z.object({ key: z.string().min(1).max(60) });

interface AntiPatternMeta {
  attempt: string;
  outcome: string;
  severity: string;
  domain: string;
  firstTriedAt: string;
  lastRevisitedAt: string | null;
  revisitCount: number;
  tags: string[];
}

export const POST = apiHandler(async (req) => {
  const { key } = Schema.parse(await req.json());
  const existing = await prisma.brainMemory.findUnique({
    where: { category_key: { category: BRAIN_CATEGORIES.ANTI_PATTERN, key } },
  });
  if (!existing) {
    throw Object.assign(new Error(`no anti-pattern: ${key}`), { status: 404, code: "NOT_FOUND" });
  }
  const meta = (existing.metadata as unknown as AntiPatternMeta | null) ?? {
    attempt: "",
    outcome: "",
    severity: "warn",
    domain: "other",
    firstTriedAt: existing.createdAt.toISOString(),
    lastRevisitedAt: null,
    revisitCount: 0,
    tags: [],
  };
  const next: AntiPatternMeta = {
    ...meta,
    lastRevisitedAt: new Date().toISOString(),
    revisitCount: (meta.revisitCount ?? 0) + 1,
  };
  await prisma.brainMemory.update({
    where: { category_key: { category: BRAIN_CATEGORIES.ANTI_PATTERN, key } },
    data: { metadata: next as unknown as object },
  });
  return { key, revisitCount: next.revisitCount };
// v10.0.119 audit-pattern follow-up · owner-gated.
}, { auth: "owner" });
