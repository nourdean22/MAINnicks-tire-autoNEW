/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { type WorkflowExecutionStateMap } from "@hexabot-ai/graph";
import { useCallback, useEffect, useRef, useState } from "react";

import { useFind } from "@/hooks/crud/useFind";
import { useAuth } from "@/hooks/useAuth";
import { EntityType, Format } from "@/services/types";
import { useWorkflowEventSubscription } from "@/websocket/workflow-event-hooks";

import type {
  NodeExecutionState,
  SubscribeWorkflowProps,
} from "../types/workflow.types";
import {
  type ExecutionStateUpdateAction,
  isWorkflowEventForFlow,
  mapWorkflowEventToExecutionActions,
  restoreWorkflowExecutionStates,
} from "../utils/workflow-execution-events.utils";

export const useWorkflowExecutionState = (flowId?: string) => {
  const { user } = useAuth();
  const { data: workflowRuns = [] } = useFind(
    { entity: EntityType.WORKFLOW_RUN, format: Format.FULL },
    {
      params: {
        where: {
          ["workflow.id"]: flowId,
          ["triggeredBy.id"]: user?.id,
        },
      },
      hasCount: false,
      initialSortState: [{ field: "createdAt", sort: "desc" }],
    },
    { enabled: Boolean(flowId && user?.id) },
  );
  const latestRun = workflowRuns[0];
  const [executionStates, setExecutionStates] =
    useState<WorkflowExecutionStateMap>({});
  const executionTimeoutIdsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const hasLiveEventRef = useRef(false);
  const clearExecutionTimeouts = useCallback(() => {
    executionTimeoutIdsRef.current.forEach((timeoutId) => {
      clearTimeout(timeoutId);
    });
    executionTimeoutIdsRef.current = [];
  }, []);
  const appendExecutionState = useCallback(
    (key: string, state: NodeExecutionState, t?: number) => {
      setExecutionStates((previousStates) => ({
        ...previousStates,
        [key]: [...(previousStates[key] ?? []), { state, t: t ?? Date.now() }],
      }));
    },
    [],
  );
  const runExecutionAction = useCallback(
    (action: ExecutionStateUpdateAction) => {
      if (action.type === "clear") {
        setExecutionStates({});

        return;
      }

      appendExecutionState(action.key, action.state, action.t);
    },
    [appendExecutionState],
  );
  const scheduleExecutionAction = useCallback(
    (action: ExecutionStateUpdateAction) => {
      if (!action.delayMs) {
        runExecutionAction(action);

        return;
      }

      const timeoutId = setTimeout(() => {
        executionTimeoutIdsRef.current = executionTimeoutIdsRef.current.filter(
          (pendingTimeoutId) => pendingTimeoutId !== timeoutId,
        );
        runExecutionAction(action);
      }, action.delayMs);

      executionTimeoutIdsRef.current.push(timeoutId);
    },
    [runExecutionAction],
  );
  const handleWorkflowExecutionEvent = useCallback(
    (event: SubscribeWorkflowProps) => {
      if (!isWorkflowEventForFlow(event, flowId)) {
        return;
      }

      hasLiveEventRef.current = true;
      const actions = mapWorkflowEventToExecutionActions(event);

      actions.forEach(scheduleExecutionAction);
    },
    [flowId, scheduleExecutionAction],
  );

  useWorkflowEventSubscription(handleWorkflowExecutionEvent);

  useEffect(() => {
    clearExecutionTimeouts();
    hasLiveEventRef.current = false;
    setExecutionStates({});
  }, [flowId, clearExecutionTimeouts]);

  useEffect(() => {
    if (!hasLiveEventRef.current) {
      setExecutionStates(restoreWorkflowExecutionStates(latestRun?.stepLog));
    }
  }, [latestRun]);

  useEffect(() => {
    return () => {
      clearExecutionTimeouts();
    };
  }, [clearExecutionTimeouts]);

  return executionStates;
};
