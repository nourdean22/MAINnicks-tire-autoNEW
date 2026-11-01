/**
 * POST /api/intent/compose · W6 intent surface (docs/design/ui-v3/W6-INTENT-SURFACE.md §4A).
 * Owner only, behind W6_INTENT_SURFACE, read-only: the model is handed only read-only registered tools
 * (lib/intent/compose.ts), so nothing here writes or sends. One trace per call, label "intent-surface",
 * is what the 2026-11-29 kill read counts.
 */
import { z } from "zod";
import { generateText } from "ai";
import { apiHandler } from "@/lib/utils/http";
import { ServiceError } from "@/lib/utils/service-error";
import { sanitizeError } from "@/lib/utils/sanitize-error";
import { getModel } from "@/lib/ai/provider";
import { nourTools } from "@/lib/ai/tools";
import { mintTraceId, recordTrace } from "@/lib/ai/agent-trace";
import { withTurnContext } from "@/lib/agent/turn-context";
import { composeIntent, isIntentSurfaceOn, INTENT_MAX_CHARS, type Generate } from "@/lib/intent/compose";

const bodySchema = z.object({ intent: z.string().trim().min(1).max(INTENT_MAX_CHARS) });

export const POST = apiHandler(
  async (req) => {
    if (!(await isIntentSurfaceOn())) throw new ServiceError("Not found", 404);
    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw new ServiceError(`Say what you want to see, in ${INTENT_MAX_CHARS} characters or fewer.`, 400);
    const { intent } = parsed.data;

    const traceId = mintTraceId();
    const startedAt = Date.now();
    const start = { traceId, source: "tool" as const, label: "intent-surface", inputChars: intent.length };
    const generate: Generate = (opts) =>
      generateText({
        ...opts,
        model: getModel("reason"),
        tools: opts.tools as Parameters<typeof generateText>[0]["tools"],
        abortSignal: AbortSignal.timeout(20_000),
      });

    try {
      const result = await withTurnContext({}, () => composeIntent({ intent, tools: nourTools, generate }));
      void recordTrace(start, {
        durationMs: Date.now() - startedAt,
        toolCalls: result.parts.length,
        metadataDelta: { refused: result.refused, failed: result.failed, tools: result.parts.map((p) => p.type) },
      });
      return result;
    } catch (err) {
      void recordTrace(start, {
        durationMs: Date.now() - startedAt,
        errorClass: "intent_compose_failed",
        errorMessage: sanitizeError(err).slice(0, 300),
      });
      throw new ServiceError(`Nick could not compose this screen: ${sanitizeError(err)}`, 502);
    }
  },
  { auth: "owner", rateLimit: "ai" },
);
