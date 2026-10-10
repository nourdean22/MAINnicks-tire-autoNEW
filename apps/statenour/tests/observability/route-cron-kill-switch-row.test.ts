/**
 * A kill-switched ROUTE cron writes a terminal skip row (2026-10-10).
 *
 * cronHandler returned `{ skipped: true }` BEFORE logging, so a disabled route
 * cron wrote no cron_job_logs row at all. The manifest-driven cron-heartbeat
 * silence check then read "not firing" and paged, and the deck could not tell
 * "disabled" from "dead". The Inngest middleware already settles a killed cron
 * as `success` with skipReason "disabled via settings"
 * (lib/inngest/cron-lifecycle.ts KILL_SWITCH_SKIP_REASON); route crons now match.
 *
 * Drives the REAL cronHandler + logCronRun; only prisma and the switch are faked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  enabled: true,
  create: vi.fn(),
  update: vi.fn(),
  handler: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    cronJobLog: { create: h.create, update: h.update },
    apiRequestLog: { create: () => Promise.resolve({}) },
    errorLog: { create: () => Promise.resolve({}) },
  },
  resetQueryCount: () => {},
  getQueryCount: () => 0,
}));
vi.mock("@/lib/services/cron-control", () => ({ isCronEnabled: async () => h.enabled }));
vi.mock("@/lib/automation/policy", () => ({ logPolicyFire: async () => undefined }));
vi.mock("@/lib/db/brain-bus-durable", () => ({ publishDurable: async () => undefined }));

import { cronHandler } from "@/lib/utils/http";

const GET = cronHandler(async () => h.handler());

/** Every row state logCronRun wrote: the `started` create overlaid with its settle. */
function rows(): Array<Record<string, unknown>> {
  const created = h.create.mock.calls.map(([a]) => (a as { data: Record<string, unknown> }).data);
  const settled = h.update.mock.calls.map(([a]) => (a as { data: Record<string, unknown> }).data);
  return created.map((c, i) => ({ ...c, ...(settled[i] ?? {}) }));
}

async function fire(): Promise<Response> {
  return (GET as unknown as (r: Request) => Promise<Response>)(
    new Request("http://localhost/api/cron/outbox-drain", { headers: { authorization: "Bearer x" } }),
  );
}

beforeEach(() => {
  h.enabled = true;
  h.create.mockReset();
  h.update.mockReset();
  h.handler.mockReset();
  h.create.mockResolvedValue({ id: "row-1" });
  h.update.mockResolvedValue({ id: "row-1" });
  h.handler.mockResolvedValue({ ok: true, drained: 2 });
});

describe("cronHandler · kill switch leaves a row", () => {
  it("BREAKS: a killed cron writes ONE terminal skip row and never runs the handler", async () => {
    h.enabled = false;
    const res = await fire();

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { skipped: boolean; reason: string } };
    expect(body.data).toMatchObject({ skipped: true, reason: "disabled via settings" });
    expect(h.handler).not.toHaveBeenCalled();
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({
      jobName: "outbox-drain",
      status: "success",
      skipReason: "disabled via settings",
    });
  });

  it("CONTROL: an enabled cron runs and writes its normal row (no skipReason)", async () => {
    const res = await fire();

    expect(res.status).toBe(200);
    expect(h.handler).toHaveBeenCalledTimes(1);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ jobName: "outbox-drain", status: "success", skipReason: null });
  });
});
