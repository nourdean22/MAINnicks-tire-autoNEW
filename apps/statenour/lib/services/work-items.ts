import { WorkItemType } from "@prisma/client";

import { enqueueWorkItem, waitForWorkItemResult } from "@/lib/services/runner-state";

type StructuredAiWorkType = "AI_NEXT_MOVE" | "AI_DRIFT_ANALYSIS" | "AI_CLARIFY_MISSION";

export function isRunnerQueueEnabled() {
  return process.env.RUNNER_USE_QUEUE === "true";
}

export async function enqueueStructuredAiWork(input: {
  type: StructuredAiWorkType;
  systemPrompt: string;
  userPrompt: string;
  schemaName: string;
  schema: Record<string, unknown>;
}) {
  const workItem = await enqueueWorkItem({
    type: input.type,
    requestPayload: {
      kind: "structured_ai",
      systemPrompt: input.systemPrompt,
      userPrompt: input.userPrompt,
      schemaName: input.schemaName,
      schema: input.schema
    }
  });

  if (!workItem) {
    return null;
  }

  return workItem;
}

export async function awaitQueuedPayload<T>(workItemId: string, timeoutMs = 8500) {
  return waitForWorkItemResult<T>(workItemId, timeoutMs);
}

export async function enqueueAleRefreshWork() {
  const workItem = await enqueueWorkItem({
    type: WorkItemType.ALE_REFRESH,
    requestPayload: {
      kind: "ale_refresh",
      headless: true
    }
  });

  if (!workItem) {
    return null;
  }

  return workItem;
}
