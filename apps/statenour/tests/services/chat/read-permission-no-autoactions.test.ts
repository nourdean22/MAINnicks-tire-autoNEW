/**
 * tests/services/chat/read-permission-no-autoactions.test.ts · 2026-10-10
 * (audit 04-F11)
 *
 * THE DEFECT: Read permission means "no autonomous change" (gate.ts READ-MODE
 * CONTRACT), and prepare-tools strips mutating tools from a Read turn. But two
 * writers never saw the permission at all:
 *   1. persistUserTurn's task-completion detector auto-completed a task from
 *      "just finished X" (persist-user-turn.ts:255-281);
 *   2. runDeferredBackgroundWork executed the model's ```action blocks
 *      (deferred-background-work.ts:391-453).
 *
 * Pinned: on a Read turn neither writes. The detector still surfaces its
 * high-confidence match as a "did you finish X?" suggestion (a prompt for the
 * operator, not a change). Permission arrives either explicitly (input/ctx,
 * which the outbox payload carries into a replay) or from the turn.
 * Controls: a Draft turn auto-completes and runs its action blocks.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

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
  return { calls, handlers, prisma };
});
vi.mock("@/lib/prisma", () => ({ prisma: db.prisma }));

const turnState = vi.hoisted(() => ({ turn: null as Record<string, unknown> | null }));
vi.mock("@/lib/agent/turn-context", () => ({
  currentTurn: () => turnState.turn,
  withTurnContext: (_seed: unknown, fn: () => unknown) => fn(),
  updateTurnContext: () => undefined,
}));

// persistUserTurn's fire-and-forget phase.
const detector = vi.hoisted(() => ({ checkTask: (() => undefined) as any }));
vi.mock("@/lib/brain/importance-scorer", () => ({ persistIfImportant: async () => ({ persisted: false }) }));
vi.mock("@/lib/brain/task-completion-detector", () => ({
  detectTaskCompletion: async () => ({ taskId: "task_7", title: "Call Bob about the tires", confidence: 0.95, userPhrase: "just called bob" }),
}));
vi.mock("@/lib/services/task-actions", () => ({ checkTask: (...a: unknown[]) => detector.checkTask(...a) }));

// runDeferredBackgroundWork's dependencies.
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
vi.mock("@/lib/utils/error-log", () => ({ logError: () => undefined }));

import { persistUserTurn } from "@/lib/services/chat/persist-user-turn";
import { runDeferredBackgroundWork } from "@/lib/services/chat/deferred-background-work";

const log = () => ({ info: vi.fn(), warn: vi.fn() });
const auditRows = () =>
  db.calls.filter((c) => c.op === "auditEvent.create").map((c) => c.args.data as { actor: string; payload: Record<string, unknown> });

async function userTurn(extra: Record<string, unknown> = {}) {
  await persistUserTurn({
    convId: "c1",
    lastUserMsg: { role: "user", content: "I just called Bob about the tires" },
    userContent: "I just called Bob about the tires",
    log: log(),
    ...extra,
  } as Parameters<typeof persistUserTurn>[0]);
  // The detector runs fire-and-forget after the row is written.
  await vi.waitFor(() => expect(auditRows().filter((r) => r.actor === "task_completion_detector").length).toBe(1));
}

const ACTION_TEXT = 'On it.\n```action\n{"type":"task.create","params":{"title":"Call Bob"}}\n```';
const deferredCtx = (over: Record<string, unknown> = {}) =>
  ({
    log: log(),
    convId: "c1",
    traceId: `t-${Math.random().toString(36).slice(2)}`,
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

beforeEach(() => {
  db.calls.length = 0;
  for (const k of Object.keys(db.handlers)) delete db.handlers[k];
  db.handlers["chatMessage.create"] = () => ({ id: "msg_1" });
  db.handlers["auditEvent.create"] = () => ({ id: "ae" });
  db.handlers["actionAttempt.create"] = ({ data }: { data: Record<string, unknown> }) => ({ id: "att_1", attemptNo: 1, ...data });
  db.handlers["actionAttempt.findUnique"] = () => ({ state: "EXECUTING", holdUntil: new Date(Date.now() + 60_000) });
  detector.checkTask = vi.fn(async () => ({ ok: true }));
  agent.executeActions = vi.fn(async () => [{ action: "task.create", success: true }]);
  turnState.turn = null;
});

describe("task auto-complete respects Read permission", () => {
  it("a Read turn does not complete the task; it surfaces the match as a suggestion instead", async () => {
    await userTurn({ actionPermission: "read" });
    expect(detector.checkTask).not.toHaveBeenCalled();
    const [row] = auditRows().filter((r) => r.actor === "task_completion_detector");
    expect(row.payload).toMatchObject({ taskId: "task_7", suggestion: true });
  });

  it("the turn's own permission counts when the caller passes none", async () => {
    turnState.turn = { conversationId: "c1", privateMode: false, untrustedInput: false, inferredBasisOnly: false, actionPermission: "read" };
    await userTurn();
    expect(detector.checkTask).not.toHaveBeenCalled();
  });

  it("positive control: a Draft turn auto-completes the high-confidence match", async () => {
    await userTurn({ actionPermission: "draft" });
    expect(detector.checkTask).toHaveBeenCalledTimes(1);
    expect(detector.checkTask).toHaveBeenCalledWith(expect.objectContaining({ id: "task_7", action: "complete" }));
  });
});

describe("action blocks respect Read permission", () => {
  it("a Read turn's action blocks are not executed and nothing is claimed", async () => {
    const c = deferredCtx({ actionPermission: "read" });
    await runDeferredBackgroundWork(c);
    expect(agent.executeActions).not.toHaveBeenCalled();
    expect(db.calls.some((x) => x.op.startsWith("actionAttempt."))).toBe(false);
    expect(c.log.info).toHaveBeenCalledWith("nick_agent_actions_skipped_read_permission", expect.objectContaining({ count: 1 }));
  });

  it("the turn's own permission counts when the ctx carries none", async () => {
    turnState.turn = { conversationId: "c1", privateMode: false, untrustedInput: false, inferredBasisOnly: false, actionPermission: "read" };
    await runDeferredBackgroundWork(deferredCtx());
    expect(agent.executeActions).not.toHaveBeenCalled();
  });

  it("positive control: a Draft turn runs its action blocks", async () => {
    await runDeferredBackgroundWork(deferredCtx({ actionPermission: "draft" }));
    expect(agent.executeActions).toHaveBeenCalledTimes(1);
  });
});
