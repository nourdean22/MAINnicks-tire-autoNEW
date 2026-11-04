/**
 * R3 round 1, item 5: a promise's text reaches the logs through the reused create path. Make it a task
 * passes the promise text as the task title, and createTaskFromAPI logged `title.slice(0, 60)` on an Inbox
 * miss and on a failed Telegram ping; telegram.ts logged `preview: text.slice(0, 80)` when the bot token is
 * unset. Logs carry ids and reasons only. The ping to Nour itself stays.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  logs: [] as unknown[][],
  send: vi.fn(async (_t: string) => {
    throw new Error("telegram down");
  }),
}));

vi.mock("@/lib/logger", async (orig) => {
  const actual = await orig<typeof import("@/lib/logger")>();
  const capture = (level: string) => (...a: unknown[]) => h.logs.push([level, ...a]);
  return {
    ...actual,
    logger: {
      ...actual.logger,
      withSurface: (s: string) => ({
        ...actual.logger.withSurface(s),
        info: capture(`${s}.info`),
        warn: capture(`${s}.warn`),
        error: capture(`${s}.error`),
      }),
    },
  };
});
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/runtime", () => ({ isDemoMode: false }));
vi.mock("@/lib/services/tasks", () => ({
  createTask: vi.fn(async () => ({ id: "t1" })),
  liftGoalOnTaskComplete: vi.fn(),
  scheduleGlobalPrioritySync: vi.fn(),
}));
vi.mock("@/lib/services/missions", () => ({
  resolveInboxMissionId: vi.fn(async () => {
    throw new Error("no inbox");
  }),
}));
vi.mock("@/lib/services/telegram", () => ({ sendTelegram: (t: string) => h.send(t) }));

const SECRET = "Tell Dana about the biopsy results";

beforeEach(() => {
  h.logs = [];
  h.send.mockClear();
});

describe("the create path logs ids, never the task's text", () => {
  it("createTaskFromAPI: an Inbox miss and a failed ping log no title, and the ping still carries it to Nour", async () => {
    const { createTaskFromAPI } = await import("@/lib/services/task-actions");
    await createTaskFromAPI({ title: SECRET } as never);
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.send.mock.calls[0][0]).toContain(SECRET);
    const warned = h.logs.filter((l) => String(l[0]).endsWith(".warn"));
    expect(warned.length, "both failure paths were exercised").toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(h.logs)).not.toContain("Tell Dana");
  });

  it("notifyTaskCreated is the shared ping (Make it a task reuses it) and logs no title on failure", async () => {
    const { notifyTaskCreated } = await import("@/lib/services/task-actions");
    await notifyTaskCreated(SECRET, null);
    expect(h.send.mock.calls[0][0]).toContain(SECRET);
    expect(h.logs.length).toBeGreaterThan(0);
    expect(JSON.stringify(h.logs)).not.toContain("Tell Dana");
  });
});

describe("telegram.ts without a bot token", () => {
  it("logs the skip with no preview of the text", async () => {
    vi.doUnmock("@/lib/services/telegram");
    vi.resetModules();
    const saved = { token: process.env.TELEGRAM_BOT_TOKEN, chat: process.env.TELEGRAM_CHAT_ID };
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    try {
      const tg = await import("@/lib/services/telegram");
      await tg.sendTelegram(SECRET).catch(() => {});
      const skipped = h.logs.filter((l) => JSON.stringify(l).includes("not_configured"));
      expect(skipped.length, "the skip path ran").toBeGreaterThan(0);
      expect(JSON.stringify(h.logs)).not.toContain("Tell Dana");
    } finally {
      if (saved.token !== undefined) process.env.TELEGRAM_BOT_TOKEN = saved.token;
      if (saved.chat !== undefined) process.env.TELEGRAM_CHAT_ID = saved.chat;
    }
  });
});
