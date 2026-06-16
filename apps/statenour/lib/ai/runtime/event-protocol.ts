export type CockpitEvent =
  | {
      type: "intent.classified";
      payload: {
        intent: string;
        mode: "fast" | "operator" | "engineer";
        model: string;
        provider: string;
        targets: string[];
      };
    }
  | {
      type: "memory.recalled";
      payload: {
        hits: Array<{ id: string; content: string; similarity: number; category: string }>;
        contradictions: Array<{ id: string; claim: string; reality: string; severity: string }>;
      };
    }
  | {
      type: "agent.thought_started";
      payload: {
        reasoningToken: string;
      };
    }
  | {
      type: "tool.plan_created";
      payload: {
        actions: Array<{ id: string; type: string; params: Record<string, unknown>; riskClass: "auto" | "pending" | "forbidden" }>;
      };
    }
  | {
      type: "tool.execution_started";
      payload: {
        actionId: string;
        toolName: string;
      };
    }
  | {
      type: "tool.execution_succeeded";
      payload: {
        actionId: string;
        toolName: string;
        result: unknown;
      };
    }
  | {
      type: "tool.execution_failed";
      payload: {
        actionId: string;
        toolName: string;
        error: string;
      };
    }
  | {
      type: "approval.required";
      payload: {
        approvalId: string;
        toolName: string;
        params: Record<string, unknown>;
        reason: string;
      };
    }
  | {
      type: "message.completed";
      payload: {
        text: string;
        costCents: number;
        durationMs: number;
        inputTokens: number;
        outputTokens: number;
      };
    };

import { AsyncLocalStorage } from "node:async_hooks";

export const cockpitEventStore = new AsyncLocalStorage<{
  traceId: string;
  publish: (event: CockpitEvent) => void;
}>();

export function publishCockpitEvent(event: CockpitEvent) {
  const store = cockpitEventStore.getStore();
  if (store) {
    store.publish(event);
  }
}

