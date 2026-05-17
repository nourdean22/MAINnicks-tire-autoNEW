import { z } from "zod";

import { assertRunnerRequest } from "@/lib/internal/runner-auth";
import { replaceCaptureInbox } from "@/lib/services/runner-state";
import { handleRouteError, jsonOk, readRequestJson } from "@/lib/utils/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const itemSchema = z.object({
  item_key: z.string(),
  source: z.string(),
  kind: z.string(),
  title: z.string(),
  summary: z.string(),
  excerpt: z.string().nullable().optional(),
  content_path: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  captured_at: z.string()
});

const inputSchema = z.object({
  nodeKey: z.string().min(1),
  payload: z.object({
    status: z.string(),
    detail: z.string().optional(),
    generated_at: z.string(),
    scanned_sources: z.array(z.string()).default([]),
    items: z.array(itemSchema)
  })
});

export async function POST(request: Request) {
  try {
    assertRunnerRequest(request);
    const input = inputSchema.parse(await readRequestJson(request));
    await replaceCaptureInbox(input.payload, {
      nodeKey: input.nodeKey
    });
    return jsonOk({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
