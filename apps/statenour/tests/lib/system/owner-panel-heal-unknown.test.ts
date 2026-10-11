/**
 * The owner panel's action-attempts read bounds the cron healer's UNKNOWN
 * claims to 48h (2026-10-10).
 *
 * A heal of a cron that runs past triggerCronByPath's 55 s abort settles
 * UNKNOWN. The healer's next run resolves it from the healed run's own
 * cron_job_logs row; one still open after that never will be. The panel read
 * had no time bound for UNKNOWN, so each such row stayed a rose exception
 * forever. Other tools' UNKNOWN rows still stay until reconciled.
 *
 * The fake evaluates the Prisma where, so the test asserts what reaches the
 * panel, not the shape of the query.
 */
import { describe, it, expect, vi } from "vitest";

const h = vi.hoisted(() => ({ attempts: [] as Record<string, unknown>[] }));

vi.mock("@/lib/prisma", () => {
  type Where = Record<string, unknown>;
  const ms = (x: unknown) => (x as Date).getTime();
  const matches = (row: Where, where: Where): boolean =>
    Object.entries(where).every(([k, cond]) => {
      if (k === "OR") return (cond as Where[]).some((w) => matches(row, w));
      if (k === "AND") return (cond as Where[]).every((w) => matches(row, w));
      if (k === "NOT") return !(Array.isArray(cond) ? cond.some((w) => matches(row, w)) : matches(row, cond as Where));
      const v = row[k];
      if (cond === null || typeof cond !== "object") return v === cond;
      return Object.entries(cond).every(([op, x]) => {
        if (op === "in") return (x as unknown[]).includes(v);
        if (op === "not") return v !== x;
        if (op === "gte") return ms(v) >= ms(x);
        if (op === "lt") return ms(v) < ms(x);
        if (op === "startsWith") return String(v).startsWith(x as string);
        throw new Error(`fake prisma: unsupported operator ${op}`);
      });
    });
  const generic = () => ({
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
    aggregate: vi.fn().mockResolvedValue({ _sum: { costCents: 0 }, _count: { _all: 0 }, _min: { createdAt: null } }),
  });
  return {
    prisma: new Proxy(
      {},
      {
        get: (_t, prop: string) => {
          if (prop === "$queryRaw") return () => Promise.resolve([]);
          if (prop === "actionAttempt") {
            return { findMany: async ({ where }: { where: Where }) => h.attempts.filter((r) => matches(r, where)) };
          }
          return generic();
        },
      },
    ),
  };
});
vi.mock("@/lib/automation/approval-queue", () => ({ listPendingActions: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/ai/budget", () => ({ listLaneStatus: vi.fn().mockResolvedValue({ lanes: [] }) }));
vi.mock("@/lib/services/chat/post-turn-outbox", () => ({
  getOutboxHealth: vi.fn().mockResolvedValue({ pending: 0, processing: 0, done24h: 0, dead: 0, oldestDeadAt: null, lastDeadError: null }),
}));
vi.mock("@/lib/intelligence/value-attribution", () => ({ buildCostPerOutcomeAttribution: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/db/migration-manifest", () => ({ REPO_MIGRATIONS: [] }));

import { buildOwnerPanel } from "@/lib/system/owner-panel-data";

const HOUR = 3_600_000;
const NOW = new Date("2026-10-10T12:00:00Z");

function unknownAttempt(id: string, tool: string, ageMs: number) {
  const startedAt = new Date(NOW.getTime() - ageMs);
  return {
    id,
    operationKey: `${tool}:${id}`,
    tool,
    effectClass: "write",
    state: "UNKNOWN",
    reason: "heal returned HTTP 0",
    startedAt,
    settledAt: new Date(startedAt.getTime() + 55_000),
    updatedAt: new Date(startedAt.getTime() + 55_000),
  };
}

const onPanel = async () =>
  (await buildOwnerPanel(NOW)).exceptions.map((e) => e.evidence).filter((e) => e.startsWith("action_attempts"));

describe("owner panel · cron.heal UNKNOWN is bounded to 48h", () => {
  it("a cron.heal UNKNOWN from 3 days ago is not on the panel", async () => {
    h.attempts = [unknownAttempt("heal_old", "cron.heal", 72 * HOUR)];

    expect(await onPanel()).toEqual([]);
  });

  it("CONTROL: a cron.heal UNKNOWN from 2 hours ago is on the panel", async () => {
    h.attempts = [unknownAttempt("heal_new", "cron.heal", 2 * HOUR)];

    expect(await onPanel()).toEqual(["action_attempts heal_new"]);
  });

  it("CONTROL: another tool's UNKNOWN from 3 days ago stays until it is reconciled", async () => {
    h.attempts = [unknownAttempt("tg_old", "telegram.send", 72 * HOUR)];

    expect(await onPanel()).toEqual(["action_attempts tg_old"]);
  });
});
