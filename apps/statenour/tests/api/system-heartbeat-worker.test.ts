/**
 * /api/system/heartbeat must not say "ok" while the worker is dead
 * (audit 08-F7, 2026-10-10).
 *
 * It answered `status: "ok"` whatever the worker state, with worker freshness
 * only nested in the body, so a dead worker paged nobody. The HTTP code stays
 * 200 for a worker problem on purpose: this path is Railway's deploy
 * healthcheck (.railway/railway.ts) and the CI dev-server probe, and a 503
 * there would block deploying the very fix a dead worker needs. Only a dead DB
 * is a 503.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  db: vi.fn(),
  worker: vi.fn(),
}));

// Identity wrapper: a returned plain object is what apiHandler wraps as HTTP 200.
vi.mock("@/lib/utils/http", () => ({
  apiHandler: (fn: (req: Request, ctx: unknown) => Promise<unknown>) => fn,
}));
vi.mock("@/lib/prisma", () => ({ checkDbConnection: () => h.db() }));
vi.mock("@/lib/observability/worker-freshness", () => ({ getWorkerFreshness: () => h.worker() }));

import { GET } from "@/app/api/system/heartbeat/route";

type Beat = { status: string; worker?: { status: string; age_minutes: number | null } };

async function beat(): Promise<unknown> {
  return GET(new Request("http://x/api/system/heartbeat"), {} as never);
}

beforeEach(() => {
  h.db.mockReset();
  h.worker.mockReset();
  h.db.mockResolvedValue({ connected: true, latency_ms: 4 });
});

describe("/api/system/heartbeat · worker freshness drives the headline", () => {
  it("CONTROL: db up + worker fresh reads ok", async () => {
    h.worker.mockResolvedValue({ status: "fresh", ageMinutes: 8, lastSuccessAt: new Date() });
    const out = (await beat()) as Beat;
    expect(out).not.toBeInstanceOf(Response);
    expect(out.status).toBe("ok");
  });

  it("BREAKS: a STALE worker reads degraded (still a 200 body, not a 503)", async () => {
    h.worker.mockResolvedValue({ status: "stale", ageMinutes: 180, lastSuccessAt: new Date() });
    const out = (await beat()) as Beat;
    expect(out).not.toBeInstanceOf(Response);
    expect(out.status).toBe("degraded");
    expect(out.worker).toEqual({ status: "stale", age_minutes: 180 });
  });

  it("BREAKS: an UNKNOWN worker (no receipt, or the read failed) is not ok either", async () => {
    h.worker.mockResolvedValue({ status: "unknown", ageMinutes: null, lastSuccessAt: null });
    const out = (await beat()) as Beat;
    expect(out.status).toBe("degraded");
  });

  it("a dead DB is still the only 503", async () => {
    h.db.mockResolvedValue({ connected: false, latency_ms: 0 });
    const out = await beat();
    expect(out).toBeInstanceOf(Response);
    expect((out as Response).status).toBe(503);
  });
});
