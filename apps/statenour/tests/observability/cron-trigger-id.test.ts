/**
 * cronHandler stamps a heal's trigger id on the run's own cron_job_logs row
 * (2026-10-11, Codex P2 on #2984).
 *
 * The healer fires a route with x-cron-trigger-id: heal:<attemptId>; the row the
 * route opens carries it, so resolveTimedOutHeals can settle the heal from that
 * exact row instead of "the job's next row by time". Only the heal shape is
 * accepted: any other value is ignored, never written.
 *
 * Drives the REAL cronHandler + logCronRun; only prisma and the switch are faked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  enabled: true,
  create: vi.fn(),
  update: vi.fn(),
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

const GET = cronHandler(async () => ({ ok: true }));

async function fire(trigger?: string): Promise<Response> {
  const headers: Record<string, string> = { authorization: "Bearer x" };
  if (trigger !== undefined) headers["x-cron-trigger-id"] = trigger;
  return (GET as unknown as (r: Request) => Promise<Response>)(
    new Request("http://localhost/api/cron/outbox-drain", { headers }),
  );
}

/** The data of every cron_job_logs create (the `started` row, or a fallback terminal row). */
const created = () => h.create.mock.calls.map(([a]) => (a as { data: Record<string, unknown> }).data);

beforeEach(() => {
  h.enabled = true;
  h.create.mockReset();
  h.update.mockReset();
  h.create.mockResolvedValue({ id: "row-1" });
  h.update.mockResolvedValue({ id: "row-1" });
});

describe("cronHandler: x-cron-trigger-id", () => {
  it("a valid heal trigger id is written on the run's started row", async () => {
    const res = await fire("heal:cmabc123def456ghi789jkl0");
    expect(res.status).toBe(200);
    expect(created()).toHaveLength(1);
    expect(created()[0]).toMatchObject({ jobName: "outbox-drain", status: "started", triggerId: "heal:cmabc123def456ghi789jkl0" });
  });

  it("the fallback terminal row carries it too when the started row could not be written", async () => {
    h.create.mockRejectedValueOnce(new Error("db blip")).mockResolvedValue({ id: "row-2" });
    await fire("heal:cmabc123def456ghi789jkl0");
    expect(created()).toHaveLength(2);
    expect(created()[1]).toMatchObject({ status: "success", triggerId: "heal:cmabc123def456ghi789jkl0" });
  });

  it("a kill-switched run's skip row carries it, so the heal still settles", async () => {
    h.enabled = false;
    await fire("heal:cmabc123def456ghi789jkl0");
    expect(created()[0]).toMatchObject({ status: "started", triggerId: "heal:cmabc123def456ghi789jkl0" });
  });

  it.each([
    ["not the heal prefix", "manual:cmabc123def456"],
    ["too short", "heal:abc"],
    ["bad characters", "heal:abc123def'; DROP"],
    ["too long", `heal:${"a".repeat(49)}`],
    ["empty", ""],
  ])("ignores a malformed trigger id (%s): no triggerId is written", async (_label, value) => {
    const res = await fire(value);
    expect(res.status).toBe(200);
    for (const row of created()) expect(row.triggerId).toBeUndefined();
  });

  it("CONTROL: a scheduled run (no header) writes no triggerId", async () => {
    await fire();
    expect(created()).toHaveLength(1);
    expect(created()[0].triggerId).toBeUndefined();
  });
});
