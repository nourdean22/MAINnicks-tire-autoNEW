/**
 * POST /api/judge-eval/run · Phase V.6 (2026-05-18 PM)
 *
 * Operator ad-hoc trigger for the AGENT_V1 → AGENT_V2 judge-eval
 * comparator. Operator POSTs a {prompt, v1Reply, v2Reply, intentClass?}
 * payload · we run the LLM judge + persist the row · the
 * /system/judge-eval page picks it up on next refetch.
 *
 * Why a manual endpoint instead of an automatic shadow-execute cron:
 * shadow execution requires running BOTH the V1 and V2 chat paths in
 * parallel · safe but bigger scope. The manual endpoint lets the
 * operator build the comparison corpus from real prod traffic that's
 * already captured (e.g. paste in a V2 reply + the V1 reply from a
 * canary 50/50 split when ready). The dashboard + verdict pipeline
 * are the gating prerequisite per docs/migrations/agent-v1-to-v2.md
 * Phase 0 · this endpoint unblocks that work without forcing a
 * shadow-execute design now.
 *
 * Auth · owner only · same gate as /system/judge-eval read.
 *
 * Body shape ·
 *   { prompt: string · 1-4000 chars
 *   , v1Reply: string · 1-8000 chars
 *   , v2Reply: string · 1-8000 chars
 *   , intentClass?: string · optional · enables per-intent breakdown
 *   }
 *
 * Returns · { id, judgment } where id is the BrainMemory key for the
 * persisted row · judgment is the Judgment shape from comparator.ts.
 */

import { z } from "zod";
import { apiHandler, readRequestJson } from "@/lib/utils/http";
import { ServiceError } from "@/lib/utils/service-error";
import { compareReplies } from "@/lib/ai/judge-eval/comparator";
import { recordComparison } from "@/lib/ai/judge-eval/persistence";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const InputSchema = z.object({
  prompt: z.string().min(1).max(4000),
  v1Reply: z.string().min(1).max(8000),
  v2Reply: z.string().min(1).max(8000),
  intentClass: z.string().max(80).optional(),
});

export const POST = apiHandler(
  async (req) => {
    const body = await readRequestJson<unknown>(req);
    const parsed = InputSchema.safeParse(body);
    if (!parsed.success) {
      throw new ServiceError("Invalid payload.", 400, parsed.error.flatten());
    }
    const input = parsed.data;

    const judgment = await compareReplies({
      prompt: input.prompt,
      v1Reply: input.v1Reply,
      v2Reply: input.v2Reply,
      intentClass: input.intentClass,
    });

    const id = await recordComparison({
      prompt: input.prompt,
      v1Reply: input.v1Reply,
      v2Reply: input.v2Reply,
      judgment,
      intentClass: input.intentClass,
    });

    return { id, judgment };
  },
  { auth: "owner" },
);
