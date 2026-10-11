/**
 * An approval's own ledger attempt (`approval:<id>`) never reaches the Owner
 * Panel on its own (audit 2026-10-10, hostile review of wave 1).
 *
 * THE DEFECT: the composer hid an `approval:<id>` attempt only while its
 * approval row was listed (needs_review 7 d, failed 24 h). Dismissing the
 * approval on /system/actions (it becomes `rejected`), or waiting out the
 * window, brought the same incident back as a permanent rose "outcome unknown"
 * that no surface could clear, and a dismissed incident never left the panel.
 *
 * Pinned: the approval_requests row is the one surface for an approval's
 * outcome (windowed, dismissable), so the attempts read leaves out
 * `approval:` keys. Other tools' UNKNOWN rows still stay until reconciled.
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

function attempt(id: string, operationKey: string, tool: string, state: string, ageMs: number) {
  const startedAt = new Date(NOW.getTime() - ageMs);
  return { id, operationKey, tool, effectClass: "write", state, reason: "socket hang up", startedAt, settledAt: startedAt, updatedAt: startedAt };
}

const onPanel = async () =>
  (await buildOwnerPanel(NOW)).exceptions.map((e) => e.evidence).filter((e) => e.startsWith("action_attempts"));

describe("owner panel · an approval's ledger attempt is surfaced by its approval row only", () => {
  it("a dismissed approval's UNKNOWN attempt is not on the panel", async () => {
    h.attempts = [attempt("att_ar3", "approval:ar3", "gmail.sendDraft", "UNKNOWN", 30 * HOUR)];

    expect(await onPanel()).toEqual([]);
  });

  it("a stalled EXECUTING approval attempt is not listed twice beside its needs_review row", async () => {
    h.attempts = [attempt("att_ar4", "approval:ar4", "gmail.sendDraft", "EXECUTING", 2 * HOUR)];

    expect(await onPanel()).toEqual([]);
  });

  it("CONTROL: another tool's UNKNOWN attempt still stays until it is reconciled", async () => {
    h.attempts = [attempt("att_tg", "telegram:abc", "telegram.send", "UNKNOWN", 72 * HOUR)];

    expect(await onPanel()).toEqual(["action_attempts att_tg"]);
  });

  it("CONTROL: an autonomous decision recorded UNKNOWN by the approval sweeper is on the panel", async () => {
    h.attempts = [attempt("att_auto", "autonomous-action:aa1", "autonomous.auto_followup_expired_quote", "UNKNOWN", 1 * HOUR)];

    expect(await onPanel()).toEqual(["action_attempts att_auto"]);
  });
});
