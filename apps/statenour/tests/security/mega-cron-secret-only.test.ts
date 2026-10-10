/**
 * tests/security/mega-cron-secret-only.test.ts · audit 2026-10-10 SN-01 (4).
 *
 * /api/cron/mega fans out to every child cron with CRON_SECRET. It used to
 * accept STATENOUR_SYNC_KEY as well, so any holder of the bridge key (the
 * nickstire server, the unattended device agents) could fire every cron.
 * Every real caller sends CRON_SECRET (lib/services/cron-control.ts
 * triggerCronByPath, the manifest schedule); none sends the sync key.
 *
 * Positive control first: CRON_SECRET still fans out, so a 401 below is the
 * gate refusing, not a route that cannot run at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { withConcurrency, cronJobLogCreate } = vi.hoisted(() => ({
  withConcurrency: vi.fn(async () => []),
  cronJobLogCreate: vi.fn(async () => ({})),
}));

vi.mock("@/lib/prisma", () => ({ prisma: { cronJobLog: { create: cronJobLogCreate } } }));
vi.mock("@/lib/utils/concurrent", () => ({ withConcurrency }));

import { GET } from "@/app/api/cron/mega/route";

const CRON = "cron-secret-test-value";
const SYNC = "sync-key-test-value";

function call(authorization?: string) {
  const headers: Record<string, string> = authorization ? { authorization } : {};
  return GET(new NextRequest("http://test.invalid/api/cron/mega?slot=morning", { headers }));
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", CRON);
  vi.stubEnv("STATENOUR_SYNC_KEY", SYNC);
  vi.stubEnv("APP_BASE_URL", "http://fanout.invalid");
  vi.stubGlobal("fetch", vi.fn(async () => {
    throw new Error("no network in tests");
  }));
  withConcurrency.mockClear();
  cronJobLogCreate.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("/api/cron/mega accepts CRON_SECRET only", () => {
  it("positive control: Bearer CRON_SECRET fans out", async () => {
    const res = await call(`Bearer ${CRON}`);
    expect(res.status).toBe(200);
    expect(withConcurrency).toHaveBeenCalledTimes(1);
  });

  it("Bearer STATENOUR_SYNC_KEY is refused 401 and fans out nothing", async () => {
    const res = await call(`Bearer ${SYNC}`);
    expect(res.status).toBe(401);
    expect(withConcurrency).not.toHaveBeenCalled();
    expect(cronJobLogCreate).not.toHaveBeenCalled();
  });

  it("no header, a wrong secret, and a bare key without Bearer are all 401", async () => {
    for (const h of [undefined, "Bearer wrong", CRON, SYNC]) {
      const res = await call(h);
      expect(res.status, String(h)).toBe(401);
    }
    expect(withConcurrency).not.toHaveBeenCalled();
  });

  it("CRON_SECRET unset: the sync key still cannot fan out", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await call(`Bearer ${SYNC}`);
    expect(res.status).not.toBe(200);
    expect(withConcurrency).not.toHaveBeenCalled();
  });
});
