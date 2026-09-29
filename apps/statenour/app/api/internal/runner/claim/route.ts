import { WorkItemType } from "@prisma/client";
import { z } from "zod";

import { assertRunnerRequest } from "@/lib/internal/runner-auth";
import { claimWorkItems } from "@/lib/services/runner-state";
import { recordExternalWorkerStarted } from "@/lib/workers/external-worker";
import { apiHandler, readRequestJson } from "@/lib/utils/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const inputSchema = z.object({
  nodeKey: z.string().min(1),
  limit: z.number().int().min(1).max(10).optional(),
  types: z.array(z.nativeEnum(WorkItemType)).optional()
});

export const POST = apiHandler(async (req) => {
  assertRunnerRequest(req);
  const input = inputSchema.parse(await readRequestJson(req));
  const workItems = await claimWorkItems(input);
  await Promise.all(
    workItems
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .filter((item) => item.type === WorkItemType.AI_EXTERNAL_WORKER)
      .map((item) => recordExternalWorkerStarted(item)),
  );

  return {
    items: workItems
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .map((item) => ({
        id: item.id,
        type: item.type,
        requestPayload: item.requestPayload,
        createdAt: item.createdAt.toISOString()
      }))
  };
});
