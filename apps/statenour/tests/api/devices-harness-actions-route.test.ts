/**
 * The three harness control doors, through the real route handlers and the real key check
 * (guard-red-team probes: no key, snapshot key, wrong header, unknown action, oversized body, replay).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const store = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>>, audits: [] as string[] }));
vi.mock("@/lib/prisma", () => {
  const matches = (r: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) =>
      v && typeof v === "object" && "gt" in (v as object) ? (r[k] as Date) > (v as { gt: Date }).gt : r[k] === v,
    );
  const harnessAction = {
    async create({ data }: { data: Record<string, unknown> }) {
      if (store.rows.some((r) => r.requestKey === data.requestKey)) throw Object.assign(new Error("unique"), { code: "P2002" });
      const row = { id: `ha_${store.rows.length + 1}`, claimedAt: null, startedAt: null, finishedAt: null, exitCode: null, output: null, error: null, createdAt: new Date(), ...data };
      store.rows.push(row);
      return row;
    },
    async findUnique({ where }: { where: { id?: string; requestKey?: string } }) {
      return store.rows.find((r) => (where.id ? r.id === where.id : r.requestKey === where.requestKey)) ?? null;
    },
    async findFirst({ where }: { where: Record<string, unknown> }) {
      return store.rows.find((r) => matches(r, where)) ?? null;
    },
    async findMany() {
      return store.rows;
    },
    async updateMany({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) {
      const hit = store.rows.filter((r) => matches(r, where));
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    },
  };
  return {
    prisma: {
      harnessAction,
      auditEvent: { create: async ({ data }: { data: { eventType: string } }) => store.audits.push(data.eventType) },
      apiRequestLog: { create: async () => ({}) },
    },
    resetQueryCount: () => {},
    getQueryCount: () => 0,
  };
});

import { POST as enqueue, GET as read } from "@/app/api/devices/harness/actions/route";
import { POST as claim } from "@/app/api/devices/harness/actions/claim/route";
import { POST as result } from "@/app/api/devices/harness/actions/result/route";
import { resetHarnessHints } from "@/lib/services/harness-control";

const CONTROL = "control-key-for-tests-0123456789abcdef";
const SNAPSHOT = "device-key-for-tests-0123456789abcdef";
let ip = 0;
const req = (url: string, init: { method?: string; key?: string; header?: string; body?: unknown; raw?: string } = {}) =>
  new Request(`http://local.test${url}`, {
    method: init.method ?? "POST",
    headers: {
      "content-type": "application/json",
      // A fresh client address per call: the per-IP limiter is not what these tests probe.
      "x-forwarded-for": `10.0.0.${(ip += 1) % 250}`,
      ...(init.key ? { [init.header ?? "x-harness-control-key"]: init.key } : {}),
    },
    body: init.method === "GET" ? undefined : (init.raw ?? JSON.stringify(init.body ?? {})),
  }) as never;
const ok = { pc: "nattynour", action: "pc-status", requestKey: "rk_route_0001", from: "nattynour" };

describe("harness control doors", () => {
  beforeEach(() => {
    store.rows.length = 0;
    store.audits.length = 0;
    resetHarnessHints();
    vi.stubEnv("HARNESS_CONTROL_KEY", CONTROL);
    vi.stubEnv("DEVICE_AGENT_KEY", SNAPSHOT);
    vi.stubEnv("STATENOUR_SYNC_KEY", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("POSITIVE CONTROL: the control key queues, the PC claims, posts, and the result reads back", async () => {
    const q = await enqueue(req("/api/devices/harness/actions", { key: CONTROL, body: ok }), {} as never);
    expect(q.status).toBe(200);
    const id = (await q.json()).data.action.id as string;
    const c = await (await claim(req("/api/devices/harness/actions/claim", { key: CONTROL, body: { pc: "nattynour" } }), {} as never)).json();
    expect(c.data.action).toMatchObject({ id, action: "pc-status" });
    const now = new Date().toISOString();
    const r = await result(
      req("/api/devices/harness/actions/result", { key: CONTROL, body: { id, pc: "nattynour", exitCode: 0, output: "ok", error: null, startedAt: now, finishedAt: now } }),
      {} as never,
    );
    expect(r.status).toBe(200);
    const back = await (await read(req(`/api/devices/harness/actions?id=${id}`, { method: "GET", key: CONTROL }), {} as never)).json();
    expect(back.data.action).toMatchObject({ state: "DONE", exitCode: 0, output: "ok", requestedBy: "cli:nattynour" });
  });

  it.each([
    ["no key", undefined, undefined],
    ["a wrong key", "wrong-key-0123456789abcdef0123456789", undefined],
    ["the snapshot key", SNAPSHOT, undefined],
    ["the control key on the snapshot header", CONTROL, "x-sync-key"],
  ])("refuses %s on every door and stores nothing", async (_label, key, header) => {
    for (const [handler, url, body] of [
      [enqueue, "/api/devices/harness/actions", ok],
      [claim, "/api/devices/harness/actions/claim", { pc: "nattynour" }],
      [result, "/api/devices/harness/actions/result", { id: "x" }],
    ] as const) {
      const res = await handler(req(url, { key, header, body }), {} as never);
      expect(res.status, url).toBe(401);
    }
    expect(store.rows).toHaveLength(0);
  });

  it("refuses an unknown action with 400 and audits the refusal", async () => {
    const res = await enqueue(req("/api/devices/harness/actions", { key: CONTROL, body: { ...ok, action: "cmd.exe" } }), {} as never);
    expect(res.status).toBe(400);
    expect(store.rows).toHaveLength(0);
    expect(store.audits).toEqual(["harness.action.refused"]);
  });

  it("refuses a request that tries to carry a command", async () => {
    const res = await enqueue(req("/api/devices/harness/actions", { key: CONTROL, body: { ...ok, argv: ["calc.exe"] } }), {} as never);
    expect(res.status).toBe(400);
    expect(store.rows).toHaveLength(0);
  });

  it("refuses an oversized body before parsing it", async () => {
    const huge = JSON.stringify({ ...ok, reason: "x".repeat(40_000) });
    const res = await enqueue(req("/api/devices/harness/actions", { key: CONTROL, raw: huge }), {} as never);
    expect(res.status).toBe(413);
    expect(store.rows).toHaveLength(0);
  });

  it("a replayed request id returns the same action and queues no second run", async () => {
    const a = await (await enqueue(req("/api/devices/harness/actions", { key: CONTROL, body: ok }), {} as never)).json();
    const b = await (await enqueue(req("/api/devices/harness/actions", { key: CONTROL, body: ok }), {} as never)).json();
    expect(b.data).toMatchObject({ replayed: true, action: { id: a.data.action.id } });
    expect(store.rows).toHaveLength(1);
  });

  it("a replayed result is refused (409)", async () => {
    const id = (await (await enqueue(req("/api/devices/harness/actions", { key: CONTROL, body: ok }), {} as never)).json()).data.action.id;
    await claim(req("/api/devices/harness/actions/claim", { key: CONTROL, body: { pc: "nattynour" } }), {} as never);
    const now = new Date().toISOString();
    const body = { id, pc: "nattynour", exitCode: 0, output: "ok", error: null, startedAt: now, finishedAt: now };
    expect((await result(req("/api/devices/harness/actions/result", { key: CONTROL, body }), {} as never)).status).toBe(200);
    expect((await result(req("/api/devices/harness/actions/result", { key: CONTROL, body }), {} as never)).status).toBe(409);
  });
});
