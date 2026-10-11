/**
 * The confidence-tier tally counts EVERY approved/rejected row, auto-purge
 * included. Pinned on purpose.
 *
 * The nightly data-cleanup purge flips every action pending over 7 days to
 * approval "rejected", approvedBy "auto-purge". The engine's tally (approved /
 * decided per actionType, fed to canAutoExecute) counts those rows. That
 * DEPRESSES acceptance, which only makes auto-execution harder: fail-safe.
 * lib/ai/trust-ladder.ts excludes them for its read-only scoreboard. The
 * 2026-10-10 audit recommends excluding them here too; that loosens a live
 * safety gate, so it waits on the operator (trust-ladder.ts MACHINE_APPROVERS).
 * B4 changed it on its own; P2-B4 reverted it. Changing this pin is that
 * operator decision, not a cleanup.
 *
 * Driven through the real rule loop. The fake groupBy filters fixture rows by
 * the WHERE the engine sends, with SQL NULL semantics (`not` / `notIn` drop
 * NULLs, as Postgres does).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  canAutoExecute: vi.fn((..._a: unknown[]) => false),
}));

/** A small Prisma WHERE evaluator: equality, null, in/notIn/not/gte, OR/AND/NOT. */
function matches(row: Row, where: Row): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (k === "OR") {
      if (!(v as Row[]).some((w) => matches(row, w))) return false;
      continue;
    }
    if (k === "AND") {
      if (!(v as Row[]).every((w) => matches(row, w))) return false;
      continue;
    }
    if (k === "NOT") {
      if ((Array.isArray(v) ? (v as Row[]) : [v as Row]).some((w) => matches(row, w))) return false;
      continue;
    }
    const val = row[k] ?? null;
    if (v === null) {
      if (val !== null) return false;
      continue;
    }
    if (typeof v !== "object" || v instanceof Date) {
      if (val !== v) return false;
      continue;
    }
    const f = v as Row;
    if ("in" in f && !(f.in as unknown[]).includes(val)) return false;
    if ("notIn" in f && (val === null || (f.notIn as unknown[]).includes(val))) return false;
    if ("not" in f && (val === null || val === f.not)) return false;
    if ("gte" in f && !(val instanceof Date && val >= (f.gte as Date))) return false;
  }
  return true;
}

vi.mock("@/lib/prisma", () => {
  const stub = () => ({
    findMany: vi.fn(async () => []),
    findFirst: vi.fn(async () => null),
    findUnique: vi.fn(async () => null),
    count: vi.fn(async () => 0),
  });
  let n = 0;
  const models: Record<string, unknown> = {
    autonomousAction: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      create: vi.fn(async (a: { data: Row }) => ({ id: `row-${++n}`, ...a.data })),
      update: vi.fn(async () => ({})),
      groupBy: vi.fn(async (a: { by: string[]; where: Row }) => {
        const counts = new Map<string, number>();
        for (const r of h.rows.filter((x) => matches(x, a.where))) {
          const key = String(r.approval);
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        return [...counts].map(([approval, id]) => ({ approval, _count: { id } }));
      }),
    },
    // One due replay: a send_telegram rule with no hour gate, so the defer
    // branch (and the tally) runs.
    decisionReplay: {
      findMany: vi.fn(async () => [
        { id: "r1", title: "hire a tech", choiceMade: "yes", createdAt: new Date("2026-09-01"), reviewAt: new Date() },
      ]),
    },
    // The operator chatted: the engagement rules stay quiet.
    chatMessage: { findFirst: vi.fn(async () => ({ id: "m1" })) },
  };
  const prisma = new Proxy(models, {
    get: (t, prop: string) => (t[prop] ??= stub()),
  });
  return { prisma };
});

vi.mock("@/lib/nickstire/query", async (orig) => ({
  readBridge: (await orig<typeof import("@/lib/nickstire/query")>()).readBridge,
  queryNick: vi.fn(async () => ({ error: "bridge off in tests" })),
  queryNickBatch: vi.fn(async () => ({})),
}));
vi.mock("@/lib/services/telegram", () => ({ sendTelegram: vi.fn() }));
vi.mock("@/lib/services/email", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/brain/memory-manager", () => ({ brainMemory: { remember: vi.fn() } }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { withSurface: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
vi.mock("@/lib/automation/policy", () => ({
  getPolicy: vi.fn(async () => null), // no policy -> defer, the tally runs
  logPolicyFire: vi.fn(async () => undefined),
}));
vi.mock("@/lib/ai/agent-trace", () => ({
  mintTraceId: () => "trace-test",
  recordTrace: vi.fn(async () => undefined),
}));
vi.mock("@/lib/ai/confidence-tier", () => ({ canAutoExecute: h.canAutoExecute }));
vi.mock("@/lib/db/brain-bus-emit", () => ({ emitAutonomousFired: vi.fn(async () => undefined) }));

import { runAutonomousActions } from "@/lib/brain/autonomous-engine";

const recent = new Date("2026-10-01T12:00:00Z");
const verdicts = (n: number, approval: string, approvedBy: string | null): Row[] =>
  Array.from({ length: n }, () => ({ actionType: "send_telegram", approval, approvedBy, createdAt: recent }));

beforeEach(() => {
  vi.useFakeTimers();
  // Saturday 10:00 EDT: outside every evening/weekday window.
  vi.setSystemTime(new Date("2026-10-10T14:00:00Z"));
  h.canAutoExecute.mockClear();
  h.rows = [
    ...verdicts(9, "approved", "operator"),
    ...verdicts(1, "approved", null), // legacy row, no approver stamped: still an operator verdict
    ...verdicts(1, "rejected", "operator"),
    ...verdicts(30, "rejected", "auto-purge"), // the nightly purge, not the operator
  ];
});
afterEach(() => {
  vi.useRealTimers();
});

describe("autonomous engine · confidence-tier tally", () => {
  it("counts auto-purge rejections and legacy NULL-approver rows (operator decision pending)", async () => {
    await runAutonomousActions();
    const calls = h.canAutoExecute.mock.calls.filter((c) => c[0] === "send_telegram");
    expect(calls.length, "the defer branch never consulted the tier").toBeGreaterThan(0);
    for (const [, rate, decided] of calls) {
      expect(decided).toBe(41);
      expect(rate).toBeCloseTo(10 / 41, 6);
    }
  });
});
