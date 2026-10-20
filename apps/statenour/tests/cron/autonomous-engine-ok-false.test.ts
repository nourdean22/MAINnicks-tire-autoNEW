/**
 * The autonomous-engine cron row says FAILED, and names the rules, when a rule errors.
 *
 * Prod 2026-10-10 03:00:34Z: three rules threw `trigger_failed` on every run
 * while the route returned `{ ok: true, errors: 3 }`. logCronRun files a row
 * from the handler's own claim, so the row read `success` and /system/crons
 * showed a healthy engine. The errors lived only in a console log line.
 *
 * Driven through the real consumer (logCronRun), so the assertion is on the row
 * that lands, not on a field nobody reads.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  run: vi.fn(),
  create: vi.fn(async () => ({ id: "row" })),
  update: vi.fn(async () => ({ id: "row" })),
}));

vi.mock("@/lib/brain/autonomous-engine", () => ({
  runAutonomousActions: h.run,
  OUTWARD_RULES: ["daily_score_reminder", "midweek_target_check"],
}));
vi.mock("@/lib/feature-flags", () => ({ getFlag: () => ({ isOn: true, rawValue: "true" }) }));
vi.mock("@/lib/utils/http", () => ({
  cronHandler: (fn: (req: Request, ctx: unknown) => Promise<unknown>) => fn,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    cronJobLog: { create: h.create, update: h.update },
    automationPolicy: { findMany: vi.fn(async () => []) },
  },
}));
vi.mock("@/lib/db/brain-bus-durable", () => ({ publishDurable: vi.fn(async () => undefined) }));
vi.mock("@/lib/logger", () => ({
  logger: { withSurface: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { GET } from "@/app/api/cron/autonomous-engine/route";
import { logCronRun } from "@/lib/services/cron-manager";

const call = () => GET(new Request("http://x/api/cron/autonomous-engine"), {} as never) as Promise<Record<string, unknown>>;

/** The row's terminal state, however logCronRun lands it (settle a started row, or create). */
function terminalRow(): Record<string, unknown> | undefined {
  const writes = [
    ...h.create.mock.calls.map(([a]) => (a as { data: Record<string, unknown> }).data),
    ...h.update.mock.calls.map(([a]) => (a as { data: Record<string, unknown> }).data),
  ].filter((d) => d.status !== "started");
  return writes.at(-1);
}

beforeEach(() => {
  h.run.mockReset();
  h.create.mockClear();
  h.update.mockClear();
});

describe("autonomous-engine cron · honest row", () => {
  it("returns ok:false naming the failed rules when any rule errors", async () => {
    h.run.mockResolvedValue({
      executed: 1,
      errors: 2,
      failedRules: ["daily_score_reminder", "midweek_target_check"],
    });
    const out = await call();
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/daily_score_reminder/);
    expect(out.reason).toMatch(/midweek_target_check/);
  });

  it("files a FAILED cron row carrying the rule names", async () => {
    h.run.mockResolvedValue({ executed: 0, errors: 1, failedRules: ["daily_score_reminder"] });
    await logCronRun("autonomous-engine", call);
    expect(terminalRow()).toEqual(
      expect.objectContaining({ status: "failed", error: expect.stringContaining("daily_score_reminder") }),
    );
  });

  it("NEGATIVE CONTROL: a clean run stays ok:true and files success", async () => {
    h.run.mockResolvedValue({ executed: 3, errors: 0, failedRules: [] });
    const out = await call();
    expect(out.ok).toBe(true);
    await logCronRun("autonomous-engine", call);
    expect(terminalRow()).toEqual(expect.objectContaining({ status: "success" }));
  });
});
