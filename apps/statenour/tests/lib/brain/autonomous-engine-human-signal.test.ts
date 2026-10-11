/**
 * daily_score_reminder and drift_escalation must read a HUMAN signal.
 *
 * THE DEFECT (audit 2026-10-10, report 13). Both rules keyed on
 * identity_snapshot.updatedAt, but the nightly refresh-identity cron upserts
 * those rows (`@updatedAt`) whether or not the operator did anything. So
 * drift_escalation could never fire while the cron ran, and
 * daily_score_reminder judged "engaged today" off a machine write.
 *
 * The signal now: a user-role chat message, a task completion
 * (lastCompletedAt), or an inbound Telegram message in one of the two lanes
 * that leave a durable row (the ask lane's "telegram-ask" agent trace; the
 * dump/voice lane's journal_ingested audit event with payload.source
 * "telegram"), inside the window, in ET. A failed read is UNKNOWN and
 * the rule stays quiet: never nag on a number nobody measured.
 *
 * Driven through the real triggers; the fake models filter fixture rows by
 * the WHERE the trigger sends, so a predicate that counts an assistant
 * message or yesterday's message fails here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";

type Chat = { role: string; createdAt: Date };
type TaskRow = { lastCompletedAt: Date | null; deletedAt: Date | null };
type Trace = { source: string; label: string; createdAt: Date };
type Audit = { eventType: string; payload: { source: string }; createdAt: Date };

const h = vi.hoisted(() => ({
  chats: [] as Array<{ role: string; createdAt: Date }>,
  tasks: [] as Array<{ lastCompletedAt: Date | null; deletedAt: Date | null }>,
  traces: [] as Array<{ source: string; label: string; createdAt: Date }>,
  audits: [] as Array<{ eventType: string; payload: { source: string }; createdAt: Date }>,
  traceFails: false,
  auditFails: false,
  chatFails: false,
  snapshotAt: null as Date | null,
  alerted: null as unknown,
}));

const gte = (d: Date | null, where?: { gte?: Date }) => !!d && (!where?.gte || d >= where.gte);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    chatMessage: {
      findFirst: vi.fn(async ({ where }: { where: { role?: string; createdAt?: { gte?: Date } } }) => {
        if (h.chatFails) throw new Error("neon unreachable");
        return (
          h.chats.find((c) => (!where.role || c.role === where.role) && gte(c.createdAt, where.createdAt)) ?? null
        );
      }),
    },
    task: {
      findFirst: vi.fn(
        async ({ where }: { where: { deletedAt?: null; lastCompletedAt?: { gte?: Date } } }) =>
          h.tasks.find(
            (t) =>
              (where.deletedAt !== null || t.deletedAt === null) && gte(t.lastCompletedAt, where.lastCompletedAt),
          ) ?? null,
      ),
    },
    // The Telegram webhook answers inbound free text in cmdAsk and leaves one
    // agent_traces row labelled "telegram-ask" (success or failure).
    agentTrace: {
      findFirst: vi.fn(
        async ({ where }: { where: { source?: string; label?: string; createdAt?: { gte?: Date } } }) => {
          if (h.traceFails) throw new Error("neon unreachable");
          return (
            h.traces.find(
              (t) =>
                (!where.source || t.source === where.source) &&
                (!where.label || t.label === where.label) &&
                gte(t.createdAt, where.createdAt),
            ) ?? null
          );
        },
      ),
    },
    // Telegram dumps and voice notes go through ingestJournal with its default
    // source "telegram", which writes one journal_ingested audit event.
    auditEvent: {
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: { eventType?: string; createdAt?: { gte?: Date }; payload?: { path?: string[]; equals?: unknown } };
        }) => {
          if (h.auditFails) throw new Error("neon unreachable");
          return (
            h.audits.find(
              (a) =>
                (!where.eventType || a.eventType === where.eventType) &&
                (!where.payload ||
                  (where.payload.path?.join(".") === "source" && a.payload.source === where.payload.equals)) &&
                gte(a.createdAt, where.createdAt),
            ) ?? null
          );
        },
      ),
    },
    // The cron-rolled snapshot: present and fresh, which is exactly what
    // made the old proxy read "engaged".
    brainMemory: {
      findUnique: vi.fn(async () => (h.snapshotAt ? { updatedAt: h.snapshotAt, deletedAt: null } : null)),
      findFirst: vi.fn(async () => (h.snapshotAt ? { id: "snap" } : null)),
    },
    autonomousAction: { findFirst: vi.fn(async () => h.alerted) },
  },
}));
vi.mock("@/lib/services/telegram", () => ({ sendTelegram: vi.fn() }));
vi.mock("@/lib/services/email", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/brain/memory-manager", () => ({ brainMemory: { remember: vi.fn() } }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { withSurface: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { __ruleTriggerForTest } from "@/lib/brain/autonomous-engine";

const trigger = (name: string) => {
  const t = __ruleTriggerForTest(name);
  if (!t) throw new Error(`no rule named ${name}`);
  return t;
};

// Saturday 2026-10-10, 20:00 EDT (inside daily_score_reminder's 19-22 window).
const NOW = new Date("2026-10-11T00:00:00Z");
const et = (iso: string) => new Date(`${iso}-04:00`);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  h.chats = [];
  h.tasks = [];
  h.traces = [];
  h.audits = [];
  h.traceFails = false;
  h.auditFails = false;
  h.chatFails = false;
  h.snapshotAt = null;
  h.alerted = null;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("daily_score_reminder · engaged today = a human write, not the cron roll", () => {
  it("nudges when only the cron touched the snapshot today and the operator did nothing", async () => {
    h.snapshotAt = et("2026-10-10T04:30:00"); // refresh-identity roll, today
    h.chats = [{ role: "assistant", createdAt: et("2026-10-10T09:00:00") }] satisfies Chat[];
    expect(await trigger("daily_score_reminder")()).toHaveLength(1);
  });

  it("stays quiet after a user chat message today, even with yesterday's snapshot", async () => {
    h.snapshotAt = et("2026-10-09T23:00:00");
    h.chats = [{ role: "user", createdAt: et("2026-10-10T10:00:00") }] satisfies Chat[];
    expect(await trigger("daily_score_reminder")()).toEqual([]);
  });

  it("stays quiet after a task completion today", async () => {
    h.tasks = [{ lastCompletedAt: et("2026-10-10T11:15:00"), deletedAt: null }] satisfies TaskRow[];
    expect(await trigger("daily_score_reminder")()).toEqual([]);
  });

  it("a user message from yesterday evening ET does not count for today", async () => {
    h.chats = [{ role: "user", createdAt: et("2026-10-09T23:30:00") }] satisfies Chat[];
    expect(await trigger("daily_score_reminder")()).toHaveLength(1);
  });

  it("a failed engagement read is unknown: no nudge", async () => {
    h.chatFails = true;
    expect(await trigger("daily_score_reminder")()).toEqual([]);
  });
});

describe("drift_escalation · 3 quiet days = no human write in 3 days", () => {
  it("fires when the cron kept the snapshot fresh but the operator has been silent 4 days", async () => {
    h.snapshotAt = et("2026-10-09T23:00:00");
    h.chats = [{ role: "user", createdAt: et("2026-10-06T12:00:00") }] satisfies Chat[];
    expect(await trigger("drift_escalation")()).toHaveLength(1);
  });

  it("does not fire after a user message 2 days ago", async () => {
    h.chats = [{ role: "user", createdAt: et("2026-10-08T12:00:00") }] satisfies Chat[];
    expect(await trigger("drift_escalation")()).toEqual([]);
  });

  it("does not fire after a task completion 2 days ago", async () => {
    h.tasks = [{ lastCompletedAt: et("2026-10-08T12:00:00"), deletedAt: null }] satisfies TaskRow[];
    expect(await trigger("drift_escalation")()).toEqual([]);
  });

  it("does not fire twice inside 3 days", async () => {
    h.alerted = { id: "prior" };
    expect(await trigger("drift_escalation")()).toEqual([]);
  });

  it("a failed engagement read is unknown: no alert", async () => {
    h.chatFails = true;
    expect(await trigger("drift_escalation")()).toEqual([]);
  });

  it("does not fire after a Telegram message 2 days ago", async () => {
    h.traces = [{ source: "tool", label: "telegram-ask", createdAt: et("2026-10-08T12:00:00") }] satisfies Trace[];
    expect(await trigger("drift_escalation")()).toEqual([]);
  });
});

describe("Telegram counts: the operator texting the bot is engagement", () => {
  it("daily_score_reminder stays quiet after a Telegram message today", async () => {
    h.traces = [{ source: "tool", label: "telegram-ask", createdAt: et("2026-10-10T13:00:00") }] satisfies Trace[];
    expect(await trigger("daily_score_reminder")()).toEqual([]);
  });

  it("a Telegram message from yesterday evening ET does not count for today", async () => {
    h.traces = [{ source: "tool", label: "telegram-ask", createdAt: et("2026-10-09T23:30:00") }] satisfies Trace[];
    expect(await trigger("daily_score_reminder")()).toHaveLength(1);
  });

  it("a machine trace today (another label) is not the operator", async () => {
    h.traces = [{ source: "tool", label: "adversarial-critic", createdAt: et("2026-10-10T13:00:00") }] satisfies Trace[];
    expect(await trigger("daily_score_reminder")()).toHaveLength(1);
  });

  it("a failed trace read is unknown: no nudge", async () => {
    h.traceFails = true;
    expect(await trigger("daily_score_reminder")()).toEqual([]);
  });

  it("the webhook still writes the row this signal reads", () => {
    // The producer lives in app/api/telegram/webhook/route.ts (cmdAsk). Rename
    // the label there and this signal goes silently dark.
    const src = readFileSync("app/api/telegram/webhook/route.ts", "utf8");
    expect(src).toMatch(/source: "tool", label: "telegram-ask"/);
  });
});

describe("Telegram dumps and voice notes count: the journal lane", () => {
  const ingest = (source: string, iso: string): Audit => ({
    eventType: "journal_ingested",
    payload: { source },
    createdAt: et(iso),
  });

  it("daily_score_reminder stays quiet after a Telegram dump or voice note today", async () => {
    h.audits = [ingest("telegram", "2026-10-10T13:00:00")];
    expect(await trigger("daily_score_reminder")()).toEqual([]);
  });

  it("drift_escalation does not fire after a Telegram voice note 2 days ago", async () => {
    h.audits = [ingest("telegram", "2026-10-08T12:00:00")];
    expect(await trigger("drift_escalation")()).toEqual([]);
  });

  it("CONTROL: a chat-sourced ingest, yesterday's dump, or another event type does not count today", async () => {
    h.audits = [
      ingest("chat", "2026-10-10T13:00:00"),
      ingest("telegram", "2026-10-09T23:30:00"),
      { eventType: "brain_insight", payload: { source: "telegram" }, createdAt: et("2026-10-10T13:00:00") },
    ];
    expect(await trigger("daily_score_reminder")()).toHaveLength(1);
  });

  it("a failed audit read is unknown: no nudge", async () => {
    h.auditFails = true;
    expect(await trigger("daily_score_reminder")()).toEqual([]);
  });

  it("the producers still write the row this signal reads", () => {
    // ingestJournal defaults source to "telegram" and records it on the
    // journal_ingested event; the webhook's dump and voice paths take that
    // default. Rename either and this lane goes silently dark.
    const ingestSrc = readFileSync("lib/brain/journal-ingest.ts", "utf8");
    expect(ingestSrc).toMatch(/source: "telegram" \| "chat" \| "manual" = "telegram"/);
    expect(ingestSrc).toMatch(/eventType: "journal_ingested",[\s\S]{0,300}payload: \{[\s\S]{0,80}\bsource,/);
    const hook = readFileSync("app/api/telegram/webhook/route.ts", "utf8");
    expect(hook).toMatch(/ingestJournal\(args\)/);
    expect(hook).toMatch(/ingestJournal\(transcript\)/);
  });
});
