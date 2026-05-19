/**
 * POST /api/ai/tasks · v10.0.226 · Nick generates 3-5 daily tasks
 *
 * Phase SS.3 (2026-05-19 AM) · heavy lifting moved to
 * `lib/services/ai-tasks.generateAiTasks` so both this REST endpoint
 * AND the new `trpc.task.aiGenerate` mutation call the same function ·
 * drift between consumers structurally impossible.
 *
 * Rate-limit check (HTTP 429) stays at the request boundary · the
 * service has no Request reference so cross-transport rate-limiting
 * keys would need a separate refactor. The tRPC path is owner-only +
 * single-operator so abuse risk is essentially zero.
 *
 * Pre-fix the route was 280 LOC inline; now it's a 35-LOC delegator
 * that maps the service's discriminated-union result to HTTP status
 * codes the client expects (429/502/503/200).
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth-guard";
import { safeParseBody } from "@/lib/utils/http";
import { checkAiRateLimit } from "@/lib/rate-limit";
import { generateAiTasks } from "@/lib/services/ai-tasks";

export const maxDuration = 60;

const inputSchema = z.object({
  action: z.enum(["generate"]).default("generate"),
  existingTasks: z.array(z.string().min(1).max(500)).max(200).optional(),
});

export async function POST(req: NextRequest) {
  await requireSession(req);

  // Rate-limit · returns a 429 Response when over budget, null when allowed
  const rateLimited = checkAiRateLimit(req);
  if (rateLimited) return rateLimited;

  const parsed = await safeParseBody(inputSchema, req, "api/ai/tasks");
  if (!parsed.ok) return parsed.response;

  const result = await generateAiTasks({
    existingTasks: parsed.data.existingTasks ?? [],
  });

  if (!result.ok) {
    if (result.kind === "providers_failed") {
      return NextResponse.json(
        {
          error: "all AI providers failed",
          providerFailures: result.failures,
          tasks: [],
        },
        { status: 503 },
      );
    }
    if (result.kind === "parse_failed") {
      return NextResponse.json(
        {
          error: "could not parse AI output",
          rawSnippet: result.rawSnippet,
          provider: result.provider,
          tasks: [],
        },
        { status: 502 },
      );
    }
  }

  return NextResponse.json(result);
}
