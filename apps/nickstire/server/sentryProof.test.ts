/**
 * Sentry is PROVEN, not "configured".
 *
 * The 2026-09-02 placeholder-DSN incident: keys set, a "started" log, zero
 * events. `/api/health` said `sentry: configured` from DSN presence alone, the
 * same false green. These pin the three halves:
 *   1. the release is the deployed COMMIT (not RAILWAY_DEPLOYMENT_ID);
 *   2. the probe plants a message tagged probe_id + commit, flushes, and is
 *      ok only when the transport acked it (a locally issued event id is not
 *      delivery);
 *   3. the health payload reads `dsn_set` + receipts, never "configured".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./db", () => ({ getDb: async () => null }));

import {
  __setSentryClientForTests,
  captureMessage,
  getSentryStatus,
  recordTransportResponse,
  resolveSentryRelease,
} from "./lib/sentry";
import { registerObservabilityRoutes } from "./routes/observabilityRoutes";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { healthHandler } from "./lib/health";

const SHA = "abcdef1234567890abcdef1234567890abcdef12";

/** Drive the REAL probe handler through the route table (the only export production uses). */
async function runProbe(targets: string[]): Promise<Record<string, any>> {
  const routes: Record<string, any[]> = {};
  const app = {
    get: (p: string, ...h: any[]) => (routes[`GET ${p}`] = h),
    post: (p: string, ...h: any[]) => (routes[`POST ${p}`] = h),
  };
  registerObservabilityRoutes(app as any, (() => undefined) as any);
  let body: Record<string, any> = {};
  const res = { json: (b: Record<string, any>) => { body = b; return res; } };
  await routes["POST /api/system/observability-probe"][1]({ body: { targets } }, res);
  return body;
}
const probeSentry = async () => (await runProbe(["sentry"])).sentry;

function fakeClient(opts: { ackStatus?: number; flushOk?: boolean; throwOnCapture?: boolean } = {}) {
  const calls: Array<{ msg: string; ctx?: Record<string, unknown> }> = [];
  return {
    calls,
    client: {
      captureException: () => "exc-id",
      captureMessage: (msg: string, ctx?: Record<string, unknown>) => {
        if (opts.throwOnCapture) throw new Error("transport exploded");
        calls.push({ msg, ctx });
        return "evt-123";
      },
      flush: async () => {
        // The real SDK emits afterSendEvent while draining; the fake does the same.
        if (opts.ackStatus !== undefined) recordTransportResponse(opts.ackStatus);
        return opts.flushOk ?? true;
      },
    },
  };
}

describe("Sentry release is the deployed commit", () => {
  it("prefers RAILWAY_GIT_COMMIT_SHA over the deployment id", () => {
    expect(resolveSentryRelease({ RAILWAY_GIT_COMMIT_SHA: SHA, RAILWAY_DEPLOYMENT_ID: "fce177bf-dep" })).toBe(SHA);
  });
  it("falls back to the deployment id only when no commit is known", () => {
    expect(resolveSentryRelease({ RAILWAY_DEPLOYMENT_ID: "fce177bf-dep" })).toBe("fce177bf-dep");
    expect(resolveSentryRelease({})).toBeUndefined();
  });
});

describe("observability probe plants a known positive in Sentry", () => {
  const saved = { dsn: process.env.SENTRY_DSN, sha: process.env.RAILWAY_GIT_COMMIT_SHA };
  beforeEach(() => {
    process.env.SENTRY_DSN = "https://key@o0.ingest.sentry.io/0";
    process.env.RAILWAY_GIT_COMMIT_SHA = SHA;
  });
  afterEach(() => {
    __setSentryClientForTests(null);
    if (saved.dsn === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = saved.dsn;
    if (saved.sha === undefined) delete process.env.RAILWAY_GIT_COMMIT_SHA;
    else process.env.RAILWAY_GIT_COMMIT_SHA = saved.sha;
  });

  it("sends one message tagged with the probe id and the commit SHA, and is ok on a 2xx ack", async () => {
    const fake = fakeClient({ ackStatus: 200 });
    __setSentryClientForTests(fake.client);
    const body = await runProbe(["sentry"]);
    const r = body.sentry;
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].msg).toContain(body.probeId);
    expect(fake.calls[0].ctx).toMatchObject({ tags: { probe_id: body.probeId, commit: SHA.slice(0, 9) } });
    expect(r).toMatchObject({ enabled: true, ok: true, eventId: "evt-123", flushed: true, acked: true });
    expect(getSentryStatus().eventsAckedSinceBoot).toBe(1);
  });

  it("is NOT ok when the event id was issued but the transport never acked", async () => {
    __setSentryClientForTests(fakeClient({}).client);
    const r = await probeSentry();
    expect(r.ok).toBe(false);
    expect(r.acked).toBe(false);
    expect(getSentryStatus().eventsCapturedSinceBoot).toBe(1);
    expect(getSentryStatus().eventsAckedSinceBoot).toBe(0);
  });

  it("is NOT ok on a non-2xx transport answer, and records the error", async () => {
    __setSentryClientForTests(fakeClient({ ackStatus: 429 }).client);
    const r = await probeSentry();
    expect(r.ok).toBe(false);
    expect(getSentryStatus().lastCaptureError).toContain("429");
  });

  it("a capture that throws never reaches the caller", () => {
    __setSentryClientForTests(fakeClient({ throwOnCapture: true }).client);
    expect(captureMessage("x")).toBeNull();
    expect(getSentryStatus().lastCaptureError).toContain("transport exploded");
  });

  it("reports disabled with a reason when the DSN is unset (never ok)", async () => {
    delete process.env.SENTRY_DSN;
    const r = await probeSentry();
    expect(r).toMatchObject({ enabled: false, ok: false });
    expect(r.reason).toMatch(/SENTRY_DSN unset/);
  });
});

describe("the probe route is reachable and gated", () => {
  it("index.ts registers it behind requireAdminApiKey", () => {
    const src = readFileSync(join(__dirname, "_core", "index.ts"), "utf8");
    expect(src).toMatch(/^\s*registerObservabilityRoutes\(app, requireAdminApiKey\);/m);
  });
  it("every observability route puts the auth middleware before its handler", () => {
    const routes: Array<{ method: string; path: string; handlers: unknown[] }> = [];
    const app = {
      get: (path: string, ...handlers: unknown[]) => routes.push({ method: "GET", path, handlers }),
      post: (path: string, ...handlers: unknown[]) => routes.push({ method: "POST", path, handlers }),
    };
    const auth = () => undefined;
    registerObservabilityRoutes(app as any, auth as any);
    expect(routes.map((r) => `${r.method} ${r.path}`)).toContain("POST /api/system/observability-probe");
    for (const r of routes) expect(r.handlers[0]).toBe(auth);
  });
});

describe("/api/health no longer calls a DSN 'configured'", () => {
  it("reports dsn_set plus delivery receipts", async () => {
    const saved = process.env.SENTRY_DSN;
    process.env.SENTRY_DSN = "https://key@o0.ingest.sentry.io/0";
    try {
      let body: Record<string, any> = {};
      const res = { status: () => res, json: (b: Record<string, any>) => { body = b; return res; } } as any;
      await healthHandler({} as any, res);
      const sentry = body.checks?.sentry;
      expect(sentry).toBeDefined();
      expect(sentry.status).toBe("dsn_set");
      expect(sentry.status).not.toBe("configured");
      expect(sentry).toHaveProperty("events_sent_since_boot");
      expect(sentry).toHaveProperty("last_event_id");
    } finally {
      if (saved === undefined) delete process.env.SENTRY_DSN;
      else process.env.SENTRY_DSN = saved;
    }
  }, 30_000);
});
