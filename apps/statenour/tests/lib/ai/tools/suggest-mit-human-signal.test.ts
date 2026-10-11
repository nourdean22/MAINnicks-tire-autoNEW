/**
 * suggestMIT decides "engaged today" from a HUMAN signal, the same helper the
 * autonomous engine uses (operatorEngagedSince).
 *
 * THE DEFECT (audit 2026-10-10, P2-B4 item 2). The tool read
 * identity_snapshot.updatedAt, which the nightly refresh-identity cron bumps
 * whether or not the operator did anything, so the cron alone read as
 * "engaged" and the nudge never showed. It also floored "today" to server
 * midnight (UTC on Railway), not ET midnight.
 *
 * Driven through the real tool; the fake models filter fixture rows by the
 * WHERE the helper sends.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  chats: [] as Array<{ role: string; createdAt: Date }>,
  completions: [] as Date[],
  traces: [] as Array<{ source: string; label: string; createdAt: Date }>,
  telegramIngests: [] as Date[],
  chatFails: false,
  snapshotAt: null as Date | null,
}));

const gte = (d: Date, where?: { gte?: Date }) => !where?.gte || d >= where.gte;

vi.mock("@/lib/prisma", () => ({
  prisma: {
    chatMessage: {
      findFirst: vi.fn(async ({ where }: { where: { role?: string; createdAt?: { gte?: Date } } }) => {
        if (h.chatFails) throw new Error("neon unreachable");
        return h.chats.find((c) => c.role === where.role && gte(c.createdAt, where.createdAt)) ?? null;
      }),
    },
    task: {
      // Two reads share this model: the critical-task lookup (no lastCompletedAt
      // filter, none open here) and the engagement read (lastCompletedAt).
      findFirst: vi.fn(async ({ where }: { where: { lastCompletedAt?: { gte?: Date } } }) => {
        if (!where.lastCompletedAt) return null;
        const at = h.completions.find((d) => gte(d, where.lastCompletedAt));
        return at ? { id: "t1" } : null;
      }),
    },
    agentTrace: {
      findFirst: vi.fn(async ({ where }: { where: { source?: string; label?: string; createdAt?: { gte?: Date } } }) =>
        h.traces.find((t) => t.source === where.source && t.label === where.label && gte(t.createdAt, where.createdAt)) ??
        null,
      ),
    },
    // Telegram dumps and voice notes: journal_ingested with payload.source "telegram".
    auditEvent: {
      findFirst: vi.fn(
        async ({ where }: { where: { eventType?: string; createdAt?: { gte?: Date }; payload?: { equals?: unknown } } }) =>
          where.eventType === "journal_ingested" &&
          where.payload?.equals === "telegram" &&
          h.telegramIngests.some((d) => gte(d, where.createdAt))
            ? { id: "a1" }
            : null,
      ),
    },
    // The cron-rolled snapshot the old code read.
    brainMemory: {
      findUnique: vi.fn(async () => (h.snapshotAt ? { updatedAt: h.snapshotAt, deletedAt: null } : null)),
    },
  },
}));
// A measured quiet shop: nothing else competes for the MIT slot.
vi.mock("@/lib/services/bridge", () => ({
  fetchShopSnapshot: vi.fn(async () => ({ leads: { urgentCount: 0 }, callbacks: { pendingCount: 0 } })),
}));
vi.mock("@/lib/services/telegram", () => ({ sendTelegram: vi.fn() }));
vi.mock("@/lib/services/email", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/brain/memory-manager", () => ({ brainMemory: { remember: vi.fn() } }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/errors/record-error", () => ({ recordError: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { withSurface: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { tasksTools } from "@/lib/ai/tools/tasks";

type Exec = { execute: (args: unknown, opts?: unknown) => Promise<unknown> };
const run = async () => JSON.stringify(await (tasksTools.suggestMIT as unknown as Exec).execute({}, {}));
const NUDGE = "Daily score not started";

// Saturday 2026-10-10, 20:00 EDT.
const NOW = new Date("2026-10-11T00:00:00Z");
const et = (iso: string) => new Date(`${iso}-04:00`);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  h.chats = [];
  h.completions = [];
  h.traces = [];
  h.telegramIngests = [];
  h.chatFails = false;
  h.snapshotAt = null;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("suggestMIT · engaged today = a human write, not the cron roll", () => {
  it("nudges when only the cron rolled the snapshot today", async () => {
    h.snapshotAt = et("2026-10-10T04:30:00");
    expect(await run()).toContain(NUDGE);
  });

  it("no nudge after a user chat message today, even with yesterday's snapshot", async () => {
    h.snapshotAt = et("2026-10-09T23:00:00");
    h.chats = [{ role: "user", createdAt: et("2026-10-10T10:00:00") }];
    expect(await run()).not.toContain(NUDGE);
  });

  it("no nudge after a Telegram message today", async () => {
    h.traces = [{ source: "tool", label: "telegram-ask", createdAt: et("2026-10-10T13:00:00") }];
    expect(await run()).not.toContain(NUDGE);
  });

  it("no nudge after a Telegram dump or voice note today", async () => {
    h.telegramIngests = [et("2026-10-10T13:00:00")];
    expect(await run()).not.toContain(NUDGE);
  });

  it("an assistant message or yesterday's user message is not engagement today", async () => {
    h.chats = [
      { role: "assistant", createdAt: et("2026-10-10T10:00:00") },
      { role: "user", createdAt: et("2026-10-09T23:30:00") },
    ];
    expect(await run()).toContain(NUDGE);
  });

  it("a failed engagement read is unknown: no nudge built on it", async () => {
    h.chatFails = true;
    expect(await run()).not.toContain(NUDGE);
  });
});
