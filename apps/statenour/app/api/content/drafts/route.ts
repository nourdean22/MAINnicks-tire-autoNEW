/**
 * /api/content/drafts — list + create content drafts.
 * v10.0.529.106 · Wave 76.
 *
 * GET ?status=pending|approved|rejected|scheduled|all · returns list
 * POST { content, imageUrl?, suggestedPlatforms?, kind? } · creates
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth-guard";
import { createDraft, listDrafts, getDraftCounts, type DraftStatus } from "@/lib/content/drafts";
import { sanitizeError } from "@/lib/utils/sanitize-error";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  content: z.string().min(1).max(4000),
  imageUrl: z.string().url().nullable().optional(),
  suggestedPlatforms: z.array(z.string()).max(10).optional(),
  kind: z.enum(["post", "thread", "story", "reel"]).optional(),
  source: z.string().max(80).optional(),
});

export async function GET(req: Request) {
  await requireSession(req);
  const { searchParams } = new URL(req.url);
  const status = (searchParams.get("status") ?? "pending") as DraftStatus | "all";
  const limit = parseInt(searchParams.get("limit") ?? "50", 10);

  try {
    const [drafts, counts] = await Promise.all([
      listDrafts({ status, limit }),
      getDraftCounts(),
    ]);
    return NextResponse.json({
      drafts,
      counts,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json({ error: sanitizeError(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  await requireSession(req);
  try {
    const input = createSchema.parse(await req.json());
    const result = await createDraft(input);
    return NextResponse.json({ ok: true, ...result }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: sanitizeError(err) }, { status: 400 });
  }
}
