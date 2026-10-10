/**
 * The outbox-drain artifact probe must read the drain's last SUCCESSFUL run
 * (2026-10-10).
 *
 * It read the newest cron_job_logs row of ANY status, so an in-flight
 * `started` row (route crons now open one first), a `failed` run, or a
 * kill-switch skip row (`success` + skipReason) all read as fresh output while
 * the drain had not actually drained anything for days.
 *
 * The fake prisma answers findFirst from a row fixture, honouring the where
 * clause the probe sends, so the test checks the query's behaviour, not its text.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = { jobName: string; status: string; skipReason: string | null; createdAt: Date };
const h = vi.hoisted(() => ({ rows: [] as Row[] }));

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) =>
    v !== null && typeof v === "object" && "in" in (v as object)
      ? ((v as { in: unknown[] }).in).includes(row[k])
      : row[k] === v,
  );
}

vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy(
    {},
    {
      get: (_t, model: string) => ({
        findFirst: async ({ where }: { where: Record<string, unknown> }) => {
          if (model !== "cronJobLog") return null;
          const hits = h.rows
            .filter((r) => matches(r as unknown as Record<string, unknown>, where))
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          return hits[0] ?? null;
        },
      }),
    },
  ),
}));

import { statenourArtifacts } from "@/lib/observability/fleet-truth";

const HOUR = 3_600_000;
const ago = (ms: number) => new Date(Date.now() - ms);
const drain = (status: string, at: Date, skipReason: string | null = null): Row => ({
  jobName: "outbox-drain",
  status,
  skipReason,
  createdAt: at,
});

async function outbox() {
  const all = await statenourArtifacts();
  return all.find((a) => a.capability === "outbox-drain")!;
}

beforeEach(() => {
  h.rows = [];
});

describe("fleet-truth · outbox-drain probe reads the last successful drain", () => {
  it("CONTROL: a success row 1h old reads fresh", async () => {
    h.rows = [drain("success", ago(HOUR))];
    expect((await outbox()).state).toBe("fresh");
  });

  it("BREAKS: a recent `started` row does not hide a 40h-old last success", async () => {
    h.rows = [drain("success", ago(40 * HOUR)), drain("started", ago(10 * 60_000))];
    expect((await outbox()).state).toBe("stale");
  });

  it("BREAKS: a recent `failed` row does not count as output", async () => {
    h.rows = [drain("success", ago(40 * HOUR)), drain("failed", ago(10 * 60_000))];
    expect((await outbox()).state).toBe("stale");
  });

  it("BREAKS: a kill-switch skip row (success + skipReason) does not count as output", async () => {
    h.rows = [drain("success", ago(40 * HOUR)), drain("success", ago(10 * 60_000), "disabled via settings")];
    expect((await outbox()).state).toBe("stale");
  });

  it("a started or failed row ALONE is never fresh (no successful drain exists)", async () => {
    h.rows = [drain("started", ago(5 * 60_000)), drain("failed", ago(20 * 60_000))];
    expect((await outbox()).state).toBe("never_produced");
  });
});
