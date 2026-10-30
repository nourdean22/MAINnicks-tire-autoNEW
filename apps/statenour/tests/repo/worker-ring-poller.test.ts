/**
 * Ring W1a: the worker's read-only Ring poller (2026-10-30).
 *
 * Lives here because the worker has no test suite of its own (same as
 * worker-forward-outcome.test.ts). Ring's API is faked: shapes come from
 * fixtures/ring-devices-synthetic.json, which is SYNTHETIC (CLAIM until a real
 * call). What is pinned, each from the manager's research
 * (scratchpad ring-perplexity-2026-10-30.md):
 *   - the WHOLE token config (rt + hid) is persisted with compare-and-swap
 *     BEFORE the new access token is used;
 *   - two pollers racing one rotation leave ONE usable token and refresh once;
 *   - hid is stable across ticks;
 *   - a failed refresh keeps the stored token, writes nothing and backs off
 *     (never re-auth, never discard);
 *   - alerts.connection is the only connection signal, with a third UNKNOWN;
 *   - a failed Ring read writes NO camera status (poller health is separate);
 *   - an unknown Ring device is never created.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fixture from "./fixtures/ring-devices-synthetic.json";
import {
  connectionStatus,
  createRingPoller,
  encodeAuthConfig,
  parseAuthConfig,
  ringPollEnabled,
  type TokenVault,
} from "../../../worker/src/ring-poller";

const KNOWN = new Set(["ring-1001", "ring-2001", "ring-2002", "ring-2003", "ring-2004"]);
const ENV = { seed: "", userAgent: "android:com.ringapp", webUrl: "http://web.internal", deviceKey: "dev-key" };

/** In-memory vault with the same contract as the Redis one: CAS swap + NX lock. */
function memoryVault(initial: string | null = null) {
  const state = { value: initial, lockOwner: null as string | null, swaps: 0 };
  const vault: TokenVault = {
    async read() {
      return state.value;
    },
    async swap(expected, next) {
      if (state.value !== expected) return false;
      state.value = next;
      state.swaps++;
      return true;
    },
    async lock(owner) {
      if (state.lockOwner) return false;
      state.lockOwner = owner;
      return true;
    },
    async unlock(owner) {
      if (state.lockOwner === owner) state.lockOwner = null;
    },
  };
  return { vault, state };
}

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

/** Fake Ring cloud + bdnick. Each token grant rotates the refresh token. */
function fakeNet(opts: { tokenStatus?: number; devicesStatus?: number; unknownIds?: string[]; onToken?: () => Promise<void> } = {}) {
  const calls: Call[] = [];
  let rotation = 0;
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method: init?.method ?? "GET", headers, body });
    if (url === "https://oauth.ring.com/oauth/token") {
      await opts.onToken?.();
      if (opts.tokenStatus && opts.tokenStatus !== 200) return new Response("{}", { status: opts.tokenStatus });
      rotation++;
      return Response.json({ access_token: `at-${rotation}`, expires_in: 3600, refresh_token: `rt-${rotation + 1}` });
    }
    if (url === "https://api.ring.com/clients_api/session") return Response.json({ profile: {} });
    if (url === "https://api.ring.com/clients_api/ring_devices") {
      if (opts.devicesStatus && opts.devicesStatus !== 200) return new Response("{}", { status: opts.devicesStatus });
      return Response.json(fixture);
    }
    if (url.startsWith("http://web.internal/api/devices/")) {
      const id = url.split("/").pop()!;
      if (opts.unknownIds?.includes(id) || !KNOWN.has(id)) return new Response("{}", { status: 404 });
      return Response.json({ ok: true });
    }
    return new Response("unexpected", { status: 500 });
  });
  return { fetchImpl, calls, tokenCalls: () => calls.filter((c) => c.url.includes("oauth/token")) };
}

const seedFor = (rt: string, hid?: string) => encodeAuthConfig(hid ? { rt, hid } : { rt });
let clock = 1_700_000_000_000;
const now = () => clock;

beforeEach(() => {
  clock = 1_700_000_000_000;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("token config", () => {
  it("round-trips rt + hid + pnc as one base64 value", () => {
    const c = { rt: "r1", hid: "h1", pnc: { a: 1 } };
    expect(parseAuthConfig(encodeAuthConfig(c))).toEqual(c);
  });
  it("a raw (non-base64-JSON) refresh token parses as { rt } only", () => {
    expect(parseAuthConfig("plain-refresh-token")).toEqual({ rt: "plain-refresh-token" });
  });
});

describe("connectionStatus: alerts.connection is the only signal", () => {
  it("online -> ONLINE, offline -> OFFLINE, missing or other -> UNKNOWN", () => {
    expect(connectionStatus({ alerts: { connection: "online" } })).toBe("ONLINE");
    expect(connectionStatus({ alerts: { connection: "offline" } })).toBe("OFFLINE");
    expect(connectionStatus({ alerts: {} })).toBe("UNKNOWN");
    expect(connectionStatus({})).toBe("UNKNOWN");
    expect(connectionStatus({ alerts: { connection: "weird" } })).toBe("UNKNOWN");
  });
  it("battery and firmware never imply online", () => {
    expect(connectionStatus({ battery_life: "100", firmware_version: "Up to Date" } as never)).toBe("UNKNOWN");
  });
});

describe("pollOnce", () => {
  it("persists the rotated whole token BEFORE using it, then patches each camera's status", async () => {
    const { vault, state } = memoryVault();
    const net = fakeNet();
    const order: string[] = [];
    const tracked: TokenVault = {
      ...vault,
      swap: async (e, n) => {
        order.push("swap");
        return vault.swap(e, n);
      },
    };
    const fetchImpl = vi.fn(async (u: string | URL | Request, i?: RequestInit) => {
      order.push(String(u).includes("ring_devices") ? "devices" : String(u).includes("oauth") ? "token" : "other");
      return net.fetchImpl(u, i);
    });
    const poller = createRingPoller({ vault: tracked, env: { ...ENV, seed: seedFor("rt-1", "hid-A") }, fetchImpl, now });
    const out = await poller.pollOnce();

    expect(out.ok).toBe(true);
    expect(order.indexOf("swap")).toBeGreaterThan(order.indexOf("token"));
    expect(order.indexOf("swap")).toBeLessThan(order.indexOf("devices"));
    expect(parseAuthConfig(state.value!)).toEqual({ rt: "rt-2", hid: "hid-A" });

    const patches = net.calls.filter((c) => c.method === "PATCH");
    const byId = Object.fromEntries(patches.map((p) => [p.url.split("/").pop(), (p.body as { status: string }).status]));
    expect(byId).toEqual({ "ring-1001": "ONLINE", "ring-2001": "ONLINE", "ring-2002": "OFFLINE", "ring-2003": "UNKNOWN", "ring-2004": "ONLINE" });
    expect(patches.every((p) => p.headers["x-sync-key"] === "dev-key")).toBe(true);
    const tokenReq = net.tokenCalls()[0];
    expect(tokenReq.body).toMatchObject({ client_id: "ring_official_android", grant_type: "refresh_token", refresh_token: "rt-1", scope: "client" });
    expect(tokenReq.headers["hardware_id"]).toBe("hid-A");
    expect(tokenReq.headers["user-agent"]).toBe("android:com.ringapp");
  });

  it("a seed without hid gets ONE generated hid that is persisted and reused on the next tick", async () => {
    const { vault, state } = memoryVault();
    const net = fakeNet();
    let n = 0;
    const poller = createRingPoller({ vault, env: { ...ENV, seed: seedFor("rt-1") }, fetchImpl: net.fetchImpl, now, newId: () => `gen-${++n}` });
    await poller.pollOnce();
    clock += 2 * 3600_000; // access token expired -> second refresh
    await poller.pollOnce();
    expect(parseAuthConfig(state.value!).hid).toBe("gen-1");
    expect(net.tokenCalls().map((c) => c.headers["hardware_id"])).toEqual(["gen-1", "gen-1"]);
    expect(n).toBe(1);
  });

  it("two pollers racing one rotation: one refresh, one stored token, and that token works next tick", async () => {
    const { vault, state } = memoryVault(seedFor("rt-1", "hid-A"));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const net = fakeNet({ onToken: () => gate });
    const a = createRingPoller({ vault, env: ENV, fetchImpl: net.fetchImpl, now });
    const b = createRingPoller({ vault, env: ENV, fetchImpl: net.fetchImpl, now });
    const pa = a.pollOnce();
    const pb = b.pollOnce();
    release();
    const [ra, rb] = await Promise.all([pa, pb]);

    expect(net.tokenCalls()).toHaveLength(1);
    expect([ra.skipped, rb.skipped].filter(Boolean)).toEqual(["locked"]);
    expect(state.swaps).toBe(1);
    const stored = parseAuthConfig(state.value!);
    expect(stored.rt).toBe("rt-2");

    clock += 2 * 3600_000;
    const next = await b.pollOnce();
    expect(next.ok).toBe(true);
    expect(net.tokenCalls().at(-1)!.body).toMatchObject({ refresh_token: "rt-2" });
  });

  it("a lost compare-and-swap uses nothing and writes no camera status", async () => {
    const { vault } = memoryVault(seedFor("rt-1", "hid-A"));
    const net = fakeNet();
    const losing: TokenVault = { ...vault, swap: async () => false };
    const out = await createRingPoller({ vault: losing, env: ENV, fetchImpl: net.fetchImpl, now }).pollOnce();
    expect(out.ok).toBe(false);
    expect(net.calls.some((c) => c.url.includes("ring_devices"))).toBe(false);
    expect(net.calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  it("a failed refresh (406) keeps the stored token, writes nothing, and backs off instead of retrying next tick", async () => {
    const { vault, state } = memoryVault(seedFor("rt-1", "hid-A"));
    const net = fakeNet({ tokenStatus: 406 });
    const poller = createRingPoller({ vault, env: ENV, fetchImpl: net.fetchImpl, now });
    const out = await poller.pollOnce();
    expect(out.ok).toBe(false);
    expect(state.value).toBe(seedFor("rt-1", "hid-A"));
    expect(net.calls.some((c) => c.method === "PATCH")).toBe(false);
    expect(poller.health().consecutiveFailures).toBe(1);

    clock += 60_000;
    const again = await poller.pollOnce();
    expect(again.skipped).toBe("backoff");
    expect(net.tokenCalls()).toHaveLength(1);
  });

  it("a failed Ring device read writes NO camera status; poller health carries the error", async () => {
    const { vault } = memoryVault(seedFor("rt-1", "hid-A"));
    const net = fakeNet({ devicesStatus: 503 });
    const poller = createRingPoller({ vault, env: ENV, fetchImpl: net.fetchImpl, now });
    const out = await poller.pollOnce();
    expect(out.ok).toBe(false);
    expect(net.calls.some((c) => c.method === "PATCH")).toBe(false);
    expect(poller.health().lastError).toMatch(/503/);
    expect(poller.health().lastOkAt).toBeNull();
  });

  it("an unknown Ring device is reported, never created; the known ones still patch", async () => {
    const { vault } = memoryVault(seedFor("rt-1", "hid-A"));
    const net = fakeNet({ unknownIds: ["ring-2004"] });
    const out = await createRingPoller({ vault, env: ENV, fetchImpl: net.fetchImpl, now }).pollOnce();
    expect(out.ok).toBe(true);
    expect(out.unknown).toEqual(["ring-2004"]);
    expect(out.patched).toBe(4);
    expect(net.calls.some((c) => c.method === "POST" && c.url.includes("web.internal"))).toBe(false);
  });

  it("Redis down (the lease call throws): pollOnce resolves a failure, never rejects into the worker", async () => {
    const { vault } = memoryVault(seedFor("rt-1", "hid-A"));
    const net = fakeNet();
    const down: TokenVault = { ...vault, lock: async () => { throw new Error("connect ECONNREFUSED"); } };
    const poller = createRingPoller({ vault: down, env: ENV, fetchImpl: net.fetchImpl, now });
    const out = await poller.pollOnce();
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/ECONNREFUSED/);
    expect(net.calls).toHaveLength(0);
    expect(poller.health().consecutiveFailures).toBe(1);
  });

  it("no stored token and no seed: nothing is called", async () => {
    const { vault } = memoryVault();
    const net = fakeNet();
    const out = await createRingPoller({ vault, env: ENV, fetchImpl: net.fetchImpl, now }).pollOnce();
    expect(out.ok).toBe(false);
    expect(net.calls).toHaveLength(0);
  });
});

describe("ringPollEnabled: off by default", () => {
  const full = { RING_POLL_ENABLED: "1", REDIS_URL: "redis://x", RING_TOKEN_KEY: "k", DEVICE_AGENT_KEY: "d", STATENOUR_WEB_URL: "http://w" };
  it("is off when RING_POLL_ENABLED is unset or not '1'", () => {
    expect(ringPollEnabled({ ...full, RING_POLL_ENABLED: undefined })).toBe(false);
    expect(ringPollEnabled({ ...full, RING_POLL_ENABLED: "true" })).toBe(false);
  });
  it("is off when any required variable is missing", () => {
    for (const k of ["REDIS_URL", "RING_TOKEN_KEY", "DEVICE_AGENT_KEY", "STATENOUR_WEB_URL"]) {
      expect(ringPollEnabled({ ...full, [k]: "" }), k).toBe(false);
    }
  });
  it("positive control: on with the flag and every variable set", () => {
    expect(ringPollEnabled(full)).toBe(true);
  });
});
