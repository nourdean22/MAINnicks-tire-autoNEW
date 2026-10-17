/**
 * GET /api/system/observability-status: HEALTHY / DEGRADED / UNKNOWN per
 * instrument from the server's own counters. Missing telemetry is never
 * HEALTHY (skill empty-vs-error). Every state is pinned, plus the
 * planted-positive path: the probe's own event is what turns UNKNOWN into
 * HEALTHY, and a sink that rejects it turns it DEGRADED.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resolveObservabilityStatus } from "./lib/observabilityStatus";
import type { SentryStatus } from "./lib/sentry";
import { __setSentryClientForTests, getSentryStatus, recordTransportResponse } from "./lib/sentry";
import {
  __resetLangfuseForTests,
  flushLangfuse,
  getLangfuseStatus,
  traceGeneration,
  type LangfuseIngestStatus,
} from "./lib/langfuse-ingest";
import { registerObservabilityRoutes } from "./routes/observabilityRoutes";

const BOOT = "2026-10-16T00:00:00.000Z";
const NOW = Date.parse("2026-10-16T12:00:00.000Z");
const LANGFUSE_FRESH_MS = 12 * 60 * 60 * 1000;

// Through the module's one production export, so the pure resolvers are tested as the route uses them.
const resolveSentryInstrument = (s: SentryStatus, bootAt: string) =>
  resolveObservabilityStatus({ sentry: s, langfuse: langfuse({ configured: false }), nowMs: NOW, bootAt }).instruments.sentry;
const resolveLangfuseInstrument = (s: LangfuseIngestStatus, nowMs: number, bootAt: string) =>
  resolveObservabilityStatus({ sentry: sentry({ dsnSet: false }), langfuse: s, nowMs, bootAt }).instruments.langfuse;

/** Drive the REAL probe handler through the route table. */
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
async function probeLangfuse(fakeFetch?: typeof fetch) {
  if (fakeFetch) vi.stubGlobal("fetch", fakeFetch);
  const body = await runProbe(["langfuse"]);
  return { ...body.langfuse, probeId: body.probeId };
}

function sentry(over: Partial<SentryStatus> = {}): SentryStatus {
  return {
    dsnSet: true,
    initialized: true,
    release: "abc",
    initError: null,
    eventsCapturedSinceBoot: 0,
    eventsAckedSinceBoot: 0,
    lastAckAt: null,
    lastAckStatus: null,
    lastEventId: null,
    lastEventAt: null,
    lastCaptureError: null,
    lastCaptureErrorAt: null,
    lastFlushOk: null,
    lastFlushAt: null,
    ...over,
  };
}

function langfuse(over: Partial<LangfuseIngestStatus> = {}): LangfuseIngestStatus {
  return {
    configured: true,
    baseUrl: "https://us.cloud.langfuse.com",
    queued: 0,
    batchesSent: 0,
    batchesFailed: 0,
    eventsTraced: 0,
    eventsDropped: 0,
    skipped: { private: 0 },
    lastIngestAt: null,
    lastIngestOk: null,
    lastHttpStatus: null,
    lastError: null,
    ...over,
  };
}

describe("Sentry instrument state", () => {
  it("DSN unset is UNKNOWN, never HEALTHY", () => {
    expect(resolveSentryInstrument(sentry({ dsnSet: false, initialized: false }), BOOT).state).toBe("UNKNOWN");
  });
  it("DSN set but init failed is DEGRADED", () => {
    expect(resolveSentryInstrument(sentry({ initialized: false, initError: "boom" }), BOOT).state).toBe("DEGRADED");
  });
  it("DSN set and zero acks is UNKNOWN, even with locally captured events", () => {
    expect(resolveSentryInstrument(sentry(), BOOT).state).toBe("UNKNOWN");
    expect(resolveSentryInstrument(sentry({ eventsCapturedSinceBoot: 3, lastEventAt: BOOT }), BOOT).state).toBe("UNKNOWN");
  });
  it("one ack since boot is HEALTHY", () => {
    const s = resolveSentryInstrument(sentry({ eventsAckedSinceBoot: 1, lastAckAt: "2026-10-16T01:00:00.000Z" }), BOOT);
    expect(s.state).toBe("HEALTHY");
    expect(s.since).toBe("2026-10-16T01:00:00.000Z");
  });
  it("a capture error after the last ack is DEGRADED", () => {
    const s = resolveSentryInstrument(
      sentry({ eventsAckedSinceBoot: 1, lastAckAt: "2026-10-16T01:00:00.000Z", lastCaptureError: "429", lastCaptureErrorAt: "2026-10-16T02:00:00.000Z" }),
      BOOT,
    );
    expect(s.state).toBe("DEGRADED");
  });
  it("an ack older than 12 h is UNKNOWN (stale proof), not HEALTHY", () => {
    const old = new Date(NOW - LANGFUSE_FRESH_MS - 60_000).toISOString();
    expect(resolveSentryInstrument(sentry({ eventsAckedSinceBoot: 4, lastAckAt: old }), BOOT).state).toBe("UNKNOWN");
  });
  it("a flush that did not drain is DEGRADED", () => {
    expect(resolveSentryInstrument(sentry({ lastFlushOk: false, lastFlushAt: BOOT }), BOOT).state).toBe("DEGRADED");
  });
});

describe("Langfuse instrument state", () => {
  it("keys unset is UNKNOWN, never HEALTHY", () => {
    expect(resolveLangfuseInstrument(langfuse({ configured: false }), NOW, BOOT).state).toBe("UNKNOWN");
  });
  it("keys set and no ingestion yet is UNKNOWN", () => {
    expect(resolveLangfuseInstrument(langfuse({ queued: 4 }), NOW, BOOT).state).toBe("UNKNOWN");
  });
  it("a 2xx ingestion within 12 h is HEALTHY", () => {
    const at = new Date(NOW - 60_000).toISOString();
    expect(resolveLangfuseInstrument(langfuse({ lastIngestOk: true, lastIngestAt: at, batchesSent: 1 }), NOW, BOOT).state).toBe("HEALTHY");
  });
  it("a 2xx ingestion older than 12 h is UNKNOWN (stale proof)", () => {
    const at = new Date(NOW - LANGFUSE_FRESH_MS - 1).toISOString();
    expect(resolveLangfuseInstrument(langfuse({ lastIngestOk: true, lastIngestAt: at }), NOW, BOOT).state).toBe("UNKNOWN");
  });
  it("dropped traces (queue overflow) are DEGRADED even after a 2xx", () => {
    const at = new Date(NOW - 60_000).toISOString();
    expect(resolveLangfuseInstrument(langfuse({ lastIngestOk: true, lastIngestAt: at, eventsDropped: 3 }), NOW, BOOT).state).toBe("DEGRADED");
  });
  it("a failed last ingestion is DEGRADED", () => {
    expect(
      resolveLangfuseInstrument(langfuse({ lastIngestOk: false, lastIngestAt: BOOT, lastHttpStatus: 401, lastError: "bad key" }), NOW, BOOT).state,
    ).toBe("DEGRADED");
  });
});

describe("planted positives move the state", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    __resetLangfuseForTests();
    __setSentryClientForTests(null);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    __resetLangfuseForTests();
    __setSentryClientForTests(null);
    process.env = { ...saved };
  });

  it("Sentry: UNKNOWN before the probe, HEALTHY after its event is acked", async () => {
    process.env.SENTRY_DSN = "https://key@o0.ingest.sentry.io/0";
    __setSentryClientForTests({
      captureException: () => "e",
      captureMessage: () => "evt-1",
      flush: async () => {
        recordTransportResponse(200, "evt-1");
        return true;
      },
    });
    expect(resolveSentryInstrument(getSentryStatus(), BOOT).state).toBe("UNKNOWN");
    const r = await probeSentry();
    expect(r.ok).toBe(true);
    expect(resolveSentryInstrument(getSentryStatus(), BOOT).state).toBe("HEALTHY");
  });

  it("Sentry: another event's ack does not make the probe ok (it checks its own event id)", async () => {
    process.env.SENTRY_DSN = "https://key@o0.ingest.sentry.io/0";
    __setSentryClientForTests({
      captureException: () => "e",
      captureMessage: () => "evt-probe",
      flush: async () => {
        recordTransportResponse(200, "evt-someone-else");
        return true;
      },
    });
    const r = await probeSentry();
    expect(r).toMatchObject({ ok: false, acked: false });
  });

  it("the probe handler answers 500 instead of an unhandled rejection", async () => {
    const routes: Record<string, any[]> = {};
    const app = {
      get: (p: string, ...h: any[]) => (routes[`GET ${p}`] = h),
      post: (p: string, ...h: any[]) => (routes[`POST ${p}`] = h),
    };
    registerObservabilityRoutes(app as any, (() => undefined) as any);
    let status = 200;
    let body: Record<string, any> = {};
    const res = {
      status: (c: number) => { status = c; return res; },
      json: (b: Record<string, any>) => { body = b; return res; },
    };
    const req = { get body(): unknown { throw new Error("boom"); } };
    await routes["POST /api/system/observability-probe"][1](req, res);
    expect(status).toBe(500);
    expect(body).toMatchObject({ ok: false, error: "boom" });
  });

  it("Langfuse: UNKNOWN before the probe, HEALTHY after a 2xx ingestion of it", async () => {
    process.env.LANGFUSE_PUBLIC_KEY = "pk-lf-test";
    process.env.LANGFUSE_SECRET_KEY = "sk-lf-test";
    const sent: Array<{ url: string; body: { batch: Array<{ type: string; body: Record<string, any> }> }; auth: string }> = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      sent.push({ url, body: JSON.parse(String(init.body)), auth: String((init.headers as Record<string, string>).authorization) });
      return new Response(JSON.stringify({ successes: [], errors: [] }), { status: 207 });
    }) as unknown as typeof fetch;
    expect(resolveLangfuseInstrument(getLangfuseStatus(), Date.now(), BOOT).state).toBe("UNKNOWN");
    const r = await probeLangfuse(fakeFetch);
    expect(r.ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe("https://us.cloud.langfuse.com/api/public/ingestion");
    expect(sent[0].auth).toBe(`Basic ${Buffer.from("pk-lf-test:sk-lf-test").toString("base64")}`);
    expect(sent[0].body.batch.map((e) => e.type)).toEqual(["trace-create", "generation-create"]);
    expect(sent[0].body.batch[1].body.metadata.probeId).toBe(r.probeId);
    expect(resolveLangfuseInstrument(getLangfuseStatus(), Date.now(), BOOT).state).toBe("HEALTHY");
  });

  it("Langfuse: a 207 with per-event errors is DEGRADED, not HEALTHY", async () => {
    process.env.LANGFUSE_PUBLIC_KEY = "pk-lf-test";
    process.env.LANGFUSE_SECRET_KEY = "sk-lf-test";
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ successes: [], errors: [{ id: "x", status: 400 }] }), { status: 207 })) as unknown as typeof fetch;
    const r = await probeLangfuse(fakeFetch);
    expect(r.ok).toBe(false);
    expect(resolveLangfuseInstrument(getLangfuseStatus(), Date.now(), BOOT).state).toBe("DEGRADED");
  });

  it("Langfuse: a 401 is DEGRADED and the probe says why", async () => {
    process.env.LANGFUSE_PUBLIC_KEY = "pk-lf-test";
    process.env.LANGFUSE_SECRET_KEY = "sk-lf-test";
    const fakeFetch = (async () => new Response("bad key", { status: 401 })) as unknown as typeof fetch;
    const r = await probeLangfuse(fakeFetch);
    expect(r).toMatchObject({ enabled: true, ok: false, httpStatus: 401 });
    expect(resolveLangfuseInstrument(getLangfuseStatus(), Date.now(), BOOT).state).toBe("DEGRADED");
  });

  it("Langfuse: keys unset means nothing is queued and the probe is not ok", async () => {
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
    expect(traceGeneration({ name: "x", site: "s", model: "m", promptText: "p", latencyMs: 1, ok: true })).toBe("off");
    const r = await probeLangfuse();
    expect(r).toMatchObject({ enabled: false, ok: false });
    expect(getLangfuseStatus().queued).toBe(0);
  });
});

describe("Langfuse payloads are masked and private calls are skipped", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    __resetLangfuseForTests();
    process.env.LANGFUSE_PUBLIC_KEY = "pk-lf-test";
    process.env.LANGFUSE_SECRET_KEY = "sk-lf-test";
  });
  afterEach(() => {
    __resetLangfuseForTests();
    process.env = { ...saved };
  });

  it("a phone number and an email never reach the wire; the prompt goes as a hash", async () => {
    const bodies: string[] = [];
    const fakeFetch = (async (_u: string, init: RequestInit) => {
      bodies.push(String(init.body));
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    traceGeneration({
      name: "receptionist:test",
      site: "test",
      model: "m",
      promptText: "SYSTEM secret prompt text",
      input: "hi this is me, call 216-555-0142 or jo.smith@example.com",
      output: "Sure, we will call 216 555 0142",
      latencyMs: 12,
      ok: true,
    });
    await flushLangfuse(fakeFetch);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).not.toMatch(/555[-\s]?0142/);
    expect(bodies[0]).not.toContain("jo.smith@example.com");
    expect(bodies[0]).not.toContain("SYSTEM secret prompt text");
    expect(bodies[0]).toMatch(/"promptSha256":"[0-9a-f]{64}"/);
  });

  it("a private call is counted and never queued", () => {
    expect(
      traceGeneration({ name: "r", site: "s", model: "m", promptText: "p", input: "x", latencyMs: 1, ok: true, private: true }),
    ).toBe("skipped_private");
    expect(getLangfuseStatus()).toMatchObject({ queued: 0, skipped: { private: 1 } });
  });
});

describe("the status route is registered behind the same gate", () => {
  it("GET /api/system/observability-status has auth first", () => {
    const routes: Array<{ key: string; first: unknown }> = [];
    const app = {
      get: (p: string, ...h: unknown[]) => routes.push({ key: `GET ${p}`, first: h[0] }),
      post: (p: string, ...h: unknown[]) => routes.push({ key: `POST ${p}`, first: h[0] }),
    };
    const auth = () => undefined;
    registerObservabilityRoutes(app as any, auth as any);
    const status = routes.find((r) => r.key === "GET /api/system/observability-status");
    expect(status?.first).toBe(auth);
  });
});
