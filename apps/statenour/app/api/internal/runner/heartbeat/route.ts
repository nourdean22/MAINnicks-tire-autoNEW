import { z } from "zod";

import { assertRunnerRequest } from "@/lib/internal/runner-auth";
import { heartbeatRunner } from "@/lib/services/runner-state";
import { apiHandler, readRequestJson } from "@/lib/utils/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const inputSchema = z.object({
  nodeKey: z.string().min(1),
  label: z.string().min(1),
  status: z.string().optional(),
  version: z.string().optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export const POST = apiHandler(async (req) => {
  assertRunnerRequest(req);
  const input = inputSchema.parse(await readRequestJson(req));
  await heartbeatRunner(input);
  return { ok: true };
});
