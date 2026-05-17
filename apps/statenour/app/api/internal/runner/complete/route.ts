import { z } from "zod";

import { assertRunnerRequest } from "@/lib/internal/runner-auth";
import { completeWorkItem } from "@/lib/services/runner-state";
import { apiHandler, readRequestJson } from "@/lib/utils/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const inputSchema = z.object({
  workItemId: z.string().min(1),
  status: z.enum(["completed", "failed"]),
  payload: z.record(z.string(), z.unknown()).optional().nullable(),
  errorCode: z.string().optional().nullable(),
  errorMessage: z.string().optional().nullable()
});

export const POST = apiHandler(async (req) => {
  assertRunnerRequest(req);
  const input = inputSchema.parse(await readRequestJson(req));
  await completeWorkItem(input);
  return { ok: true };
});
