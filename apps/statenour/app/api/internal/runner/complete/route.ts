import { WorkItemType } from "@prisma/client";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { assertRunnerRequest } from "@/lib/internal/runner-auth";
import { completeWorkItem } from "@/lib/services/runner-state";
import { ExternalWorkerResultSchema } from "@/lib/workers/contracts";
import { recordExternalWorkerCompleted } from "@/lib/workers/external-worker";
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
  const before = await prisma.workItem.findUnique({
    where: { id: input.workItemId },
    select: { id: true, type: true, requestPayload: true },
  });
  if (before?.type === WorkItemType.AI_EXTERNAL_WORKER) {
    ExternalWorkerResultSchema.parse(input.payload ?? {});
  }
  const completed = await completeWorkItem(input);
  if (before?.type === WorkItemType.AI_EXTERNAL_WORKER && completed) {
    await recordExternalWorkerCompleted({
      id: before.id,
      requestPayload: before.requestPayload,
      resultPayload: input.payload,
      status: input.status,
      errorCode: input.errorCode,
    });
  }
  return { ok: true };
});
