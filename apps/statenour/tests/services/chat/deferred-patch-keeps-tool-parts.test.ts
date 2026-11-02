/**
 * B1 (2026-11-01): the deferred action-receipt patch rebuilds the stored row's `parts` when an
 * action block failed while the reply claimed it. It must carry the row's tool parts forward
 * (keepStoredToolParts), or the cards vanish from exactly the turns whose claims they disprove.
 *
 * Harness copied from action-receipt-trace.test.ts (same mocks, in-memory store).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, unknown> & { id: string; operationKey: string; state: string; attemptNo: number; holdUntil: Date | null };

const db = vi.hoisted(() => {
  const calls: Array<{ op: string; args: any }> = [];
  const handlers: Record<string, (args: any) => unknown> = {};
  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: (_t, method) => {
          if (typeof method !== "string" || method === "then") return undefined;
          return (args: unknown) => {
            const op = `${name}.${method}`;
            calls.push({ op, args });
            const h = handlers[op];
            return new Promise((resolve) => resolve(h ? h(args) : null));
          };
        },
      },
    );
  const prisma = new Proxy({}, { get: (_t, name) => (typeof name === "string" && name !== "then" ? model(name) : undefined) });
  return { calls, handlers, prisma, attempts: new Map<string, any>() };
});
vi.mock("@/lib/prisma", () => ({ prisma: db.prisma }));

const agent = vi.hoisted(() => ({ executeActions: (() => undefined) as any }));
vi.mock("@/lib/ai/nick-agent", () => ({
  parseActions: (text: string) => (text.includes("```action") ? [{ type: "task.create", params: { title: "Call Bob" } }] : []),
  executeActions: (...a: unknown[]) => agent.executeActions(...a),
}));
vi.mock("@/lib/ai/memory", () => ({ recordInteraction: async () => undefined }));
vi.mock("@/lib/brain/pipeline-controller", () => ({ processConversation: async () => undefined }));
vi.mock("@/lib/brain/conversation-memory", () => ({ summarizeAndStoreConversation: async () => undefined }));
vi.mock("@/lib/chat/auto-rename", () => ({ maybeAutoRename: async () => undefined }));
vi.mock("@/lib/services/metrics", () => ({ metricRecordedForTrace: async () => true, recordMetricStrict: async () => ({}) }));
vi.mock("@/lib/ai/receipts/action-done-shadow-recorder", () => ({
  ACTION_DONE_SHADOW_METRIC: "action_done_shadow",
  recordActionDoneShadow: async () => "skipped",
}));
vi.mock("@/lib/ai/chat/recommendation-novelty-shadow", () => ({
  RECOMMENDATION_NOVELTY_METRIC: "recommendation_novelty",
  recordRecommendationNoveltyShadow: async () => undefined,
}));
vi.mock("@/lib/services/chat/prior-recommendations", () => ({ loadPriorRecommendations: async () => [] }));
vi.mock("@/lib/ai/content-feedback", () => ({ detectContentFeedback: () => null, persistContentFeedback: async () => undefined }));
vi.mock("@/lib/personal/friction-tracker", () => ({ detectFriction: () => null, persistFriction: async () => undefined }));
vi.mock("@/lib/ai/suggestion-cache", () => ({ warmSuggestionCache: () => undefined, heuristicSuggestions: () => [] }));
const logError = vi.hoisted(() => ({ fn: (..._a: unknown[]) => undefined }));
vi.mock("@/lib/utils/error-log", () => ({ logError: (...a: unknown[]) => logError.fn(...a) }));

import { runDeferredBackgroundWork } from "@/lib/services/chat/deferred-background-work";

const ACTION_TEXT = 'On it.\n```action\n{"type":"task.create","params":{"title":"Call Bob"}}\n```';
const ctx = (over: Record<string, unknown> = {}) =>
  ({
    log: { info: vi.fn(), warn: vi.fn() },
    convId: "c1",
    traceId: "t1",
    provider: "openai",
    modelId: "m",
    mode: "standard",
    personality: "x",
    topicTier: "t",
    startedAt: Date.now(),
    userContent: "ok do it",
    cleanedText: "On it.",
    text: ACTION_TEXT,
    messages: [],
    createdAssistantId: "a1",
    ...over,
  }) as unknown as Parameters<typeof runDeferredBackgroundWork>[0];

const attemptFor = (traceId: string): Row | undefined =>
  [...db.attempts.values()].find((r: Row) => r.operationKey.includes(traceId));
const outboxDoneMarks = () =>
  db.calls.filter((c) => c.op === "postTurnOutbox.update" && c.args?.data?.status === "done");

function installAttemptStore() {
  db.attempts.clear();
  db.handlers["actionAttempt.create"] = ({ data }: { data: Row }) => {
    if (db.attempts.has(data.operationKey)) throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    const row = { ...data, id: `att_${db.attempts.size + 1}` };
    db.attempts.set(data.operationKey, row);
    return { id: row.id, attemptNo: row.attemptNo };
  };
  const find = (where: { id?: string; operationKey?: string }) =>
    [...db.attempts.values()].find((r: Row) => (where.id ? r.id === where.id : r.operationKey === where.operationKey)) ?? null;
  db.handlers["actionAttempt.findUnique"] = ({ where }: { where: { id?: string; operationKey?: string } }) => find(where);
  db.handlers["actionAttempt.update"] = ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
    const row = find(where);
    if (row) Object.assign(row, data);
    return row;
  };
  db.handlers["actionAttempt.updateMany"] = () => ({ count: 0 });
}

beforeEach(() => {
  db.calls.length = 0;
  for (const k of Object.keys(db.handlers)) delete db.handlers[k];
  installAttemptStore();
  db.handlers["chatMessage.create"] = () => ({ id: "receipt_msg" });
  db.handlers["auditEvent.create"] = () => ({ id: "ae" });
  agent.executeActions = vi.fn(async () => [{ action: "task.create", success: true, result: { id: "task_1" } }]);
  logError.fn = vi.fn();
});

const auditRows = (eventType: string) =>
  db.calls
    .filter((c) => c.op === "auditEvent.create" && c.args?.data?.eventType === eventType)
    .map((c) => c.args.data.payload as Record<string, unknown>);


const toolPart = { type: "tool-getTasks", toolCallId: "c1", input: {}, state: "output-available", output: { tasks: [] } };
const rowPatches = () => db.calls.filter((c) => c.op === "chatMessage.update" && c.args?.where?.id === "a1").map((c) => c.args.data);

describe("the deferred action-receipt patch keeps the row's tool parts", () => {
  it("a failed task.create rewrites the text and keeps the stored card ahead of it", async () => {
    db.handlers["chatMessage.findUnique"] = () => ({ parts: [toolPart, { type: "text", text: "On it." }] });
    agent.executeActions = vi.fn(async () => [{ action: "task.create", success: false, error: "boom" }]);

    await runDeferredBackgroundWork(ctx());

    const patch = rowPatches().at(-1);
    expect(patch, "the patch fired (positive control)").toBeDefined();
    expect(patch.content).not.toBe("On it.");
    expect(patch.parts.map((p: { type: string }) => p.type)).toEqual(["tool-getTasks", "text"]);
    expect(patch.parts.some((p: { text?: string }) => p.text === "On it.")).toBe(false);
  });
});
