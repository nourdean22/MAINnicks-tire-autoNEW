import { z } from "zod";

import { assertRunnerRequest } from "@/lib/internal/runner-auth";
import { replaceRecoverySnapshot } from "@/lib/services/runner-state";
import { handleRouteError, jsonOk, readRequestJson } from "@/lib/utils/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const itemSchema = z.object({
  entity_key: z.string(),
  source: z.string(),
  title: z.string(),
  summary: z.string(),
  priority_score: z.number(),
  status: z.string(),
  payload: z.record(z.string(), z.unknown()).optional(),
  updated_at: z.string()
});

const inputSchema = z.object({
  nodeKey: z.string().min(1),
  payload: z.object({
    status: z.string(),
    detail: z.string().optional(),
    session_ready: z.boolean(),
    final_url: z.string().optional(),
    final_title: z.string().optional(),
    item_count: z.number(),
    generated_at: z.string(),
    source: z.string(),
    items: z.array(itemSchema)
  })
});

export async function POST(request: Request) {
  try {
    assertRunnerRequest(request);
    const input = inputSchema.parse(await readRequestJson(request));
    await replaceRecoverySnapshot(input.payload, {
      nodeKey: input.nodeKey
    });
    return jsonOk({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
