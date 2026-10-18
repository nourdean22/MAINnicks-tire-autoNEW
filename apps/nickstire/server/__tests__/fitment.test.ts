/**
 * fitment v1 · year > make > model > submodel -> OE tire sizes through D&K's b2b quicksearch API
 * (the shop's existing Gateway Tire login, server/services/gatewayClient.ts).
 *
 * Driven through the real tRPC router (createCaller) and the REAL gatewayClient: only global
 * fetch is stubbed, /token included, so the bearer + browser-shaped headers path is exercised.
 * D&K is never called. Each block pins one promise of the contract the client lane codes against:
 *   - no working D&K login: every read says "unconfigured" and makes ZERO data calls,
 *     and a failed login is retried at most once a minute, not on every status read
 *   - an upstream failure is never an empty list (a 200 with no items IS an empty list)
 *   - the credentials and the bearer token never reach a log line or a response
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";

const logLines = vi.hoisted(() => [] as string[]);
vi.mock("../lib/logger", () => ({
  createLogger: (module: string) => {
    const rec = (level: string) => (msg: string, ...args: unknown[]) => {
      logLines.push(`${level} ${module} ${msg} ${args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : JSON.stringify(a))).join(" ")}`);
    };
    return { debug: rec("debug"), info: rec("info"), warn: rec("warn"), error: rec("error") };
  },
}));

import { fitmentRouter } from "../routers/fitment";
import { __resetFitmentForTest } from "../services/fitment/dkFitment";
import { invalidateGatewaySession } from "../services/gatewayClient";

const dk = JSON.parse(readFileSync(new URL("./fixtures/fitment/dk.json", import.meta.url), "utf8"));

const USER = "shop-user-7c1";
const PASS = "shop-pass-9e4";
const TOKEN = "jwt-token-3b8d";
const ENV_KEYS = ["GATEWAY_TIRE_USERNAME", "GATEWAY_TIRE_PASSWORD"] as const;
const savedEnv: Record<string, string | undefined> = {};

const caller = () => fitmentRouter.createCaller({} as TrpcContext);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

type Handler = (url: URL, init?: RequestInit) => Response | Promise<Response>;

/** /token answers with TOKEN; every data path goes to `data` (default: the fixtures). */
function dkFetch(data: Handler = fixtureData) {
  return vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === "/token") return json({ access_token: TOKEN, token_type: "bearer" });
    return data(url, init);
  });
}

function fixtureData(url: URL): Response {
  const q = url.searchParams;
  switch (url.pathname) {
    case "/quicksearch/list-all-year": return json(dk.years);
    case "/quicksearch/get-make-by-year": return json(dk.makes);
    case "/quicksearch/get-model-by-year-make": return json(dk.models);
    case "/quicksearch/get-sub-model-by-year-make": return json(dk.submodels);
    case "/quicksearch/get-tire-size-by-year-make-model-submodel": {
      const sub = q.get("submodel");
      if (sub === "LX") return json(dk.sizesLX);
      if (sub === "Si") return json(dk.sizesSi);
      if (sub === "SR5 4WD") return json(dk.sizesTruck);
      return json(dk.invalidSubmodel, 400);
    }
    default: return json({ detail: "Not Found" }, 404);
  }
}

const dataCalls = (m: ReturnType<typeof vi.fn>) =>
  m.mock.calls.filter(([u]) => new URL(String(u)).pathname !== "/token");
const tokenCalls = (m: ReturnType<typeof vi.fn>) =>
  m.mock.calls.filter(([u]) => new URL(String(u)).pathname === "/token");

const VEHICLE = { year: 2018, make: "Honda", model: "Civic" };

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.GATEWAY_TIRE_USERNAME = USER;
  process.env.GATEWAY_TIRE_PASSWORD = PASS;
  invalidateGatewaySession();
  __resetFitmentForTest();
  logLines.length = 0;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.unstubAllGlobals();
  vi.useRealTimers();
  invalidateGatewaySession();
  __resetFitmentForTest();
});

describe("unconfigured: no working D&K login means no data call", () => {
  it("credentials unset -> available:false and every read says unconfigured, zero fetch calls", async () => {
    delete process.env.GATEWAY_TIRE_USERNAME;
    delete process.env.GATEWAY_TIRE_PASSWORD;
    const fetchMock = dkFetch();
    vi.stubGlobal("fetch", fetchMock);
    const c = caller();

    expect(await c.status()).toEqual({ available: false });
    const unconfigured = { ok: false, reason: "unconfigured" };
    expect(await c.years()).toEqual(unconfigured);
    expect(await c.makes({ year: 2018 })).toEqual(unconfigured);
    expect(await c.models({ year: 2018, make: "Honda" })).toEqual(unconfigured);
    expect(await c.trims(VEHICLE)).toEqual(unconfigured);
    expect(await c.sizes({ ...VEHICLE, trim: "LX" })).toEqual(unconfigured);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a rejected login is unconfigured, and is retried at most once a minute", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-18T15:00:00Z"));
    const fetchMock = vi.fn(async (input: string | URL) =>
      new URL(String(input)).pathname === "/token" ? json({ detail: "bad creds" }, 401) : fixtureData(new URL(String(input))));
    vi.stubGlobal("fetch", fetchMock);

    expect(await caller().status()).toEqual({ available: false });
    expect(await caller().status()).toEqual({ available: false });
    expect(await caller().years()).toEqual({ ok: false, reason: "unconfigured" });
    expect(tokenCalls(fetchMock)).toHaveLength(1);
    expect(dataCalls(fetchMock)).toHaveLength(0);

    vi.setSystemTime(new Date("2026-10-18T15:01:01Z"));
    expect(await caller().status()).toEqual({ available: false });
    expect(tokenCalls(fetchMock)).toHaveLength(2);
  });

  it("positive control: with a working login, status is available and reads reach D&K with the bearer", async () => {
    const fetchMock = dkFetch();
    vi.stubGlobal("fetch", fetchMock);
    expect(await caller().status()).toEqual({ available: true });
    expect(await caller().status()).toEqual({ available: true });
    expect((await caller().years()).ok).toBe(true);
    expect(tokenCalls(fetchMock)).toHaveLength(1);
    const [url, init] = dataCalls(fetchMock)[0] as [string, RequestInit];
    expect(url).toBe("https://api-b2b.dktire.com/quicksearch/list-all-year");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(headers.Origin).toBe("https://b2b.dktire.com");
    expect(headers.Timezone).toBe("America/New_York");
  });
});

describe("happy path through the router", () => {
  it("years: strings parsed, descending, only years the makes input accepts", async () => {
    vi.stubGlobal("fetch", dkFetch());
    expect(await caller().years()).toEqual({ ok: true, years: [2019, 2018, 2017] });
  });

  it("makes and models: value -> slug, label -> name; values the input would reject are dropped", async () => {
    const fetchMock = dkFetch();
    vi.stubGlobal("fetch", fetchMock);
    expect(await caller().makes({ year: 2018 })).toEqual({
      ok: true,
      makes: [
        { slug: "Alfa Romeo", name: "Alfa Romeo" },
        { slug: "Honda", name: "Honda" },
        { slug: "Mercedes-Benz", name: "Mercedes-Benz" },
      ],
    });
    expect(await caller().models({ year: 2018, make: "Alfa Romeo" })).toEqual({
      ok: true,
      models: [{ slug: "CR-V", name: "CR-V" }, { slug: "Civic", name: "Civic" }],
    });
    const url = new URL(String(dataCalls(fetchMock)[1][0]));
    expect(url.pathname).toBe("/quicksearch/get-model-by-year-make");
    expect(url.searchParams.get("year")).toBe("2018");
    expect(url.searchParams.get("make")).toBe("Alfa Romeo"); // round-trips URL-encoded
  });

  it("trims: { slug: value, label: label } straight from get-sub-model", async () => {
    const fetchMock = dkFetch();
    vi.stubGlobal("fetch", fetchMock);
    expect(await caller().trims(VEHICLE)).toEqual({
      ok: true,
      trims: [
        { slug: "LX", label: "LX" },
        { slug: "Si", label: "Si" },
        { slug: "Type R", label: "Type R" },
        { slug: "Sport Touring", label: "Sport Touring" },
      ],
    });
    const url = new URL(String(dataCalls(fetchMock)[0][0]));
    expect(Object.fromEntries(url.searchParams)).toEqual({ year: "2018", make: "Honda", model: "Civic" });
  });

  it("sizes: order as returned, rim diameter parsed, no stock flag invented, rearSize null", async () => {
    const fetchMock = dkFetch();
    vi.stubGlobal("fetch", fetchMock);
    const res = await caller().sizes({ ...VEHICLE, trim: "LX" });
    expect(res).toEqual({
      ok: true,
      sizes: [
        { size: "215/50R17", rimDiameter: 17, rearSize: null },
        { size: "215/55R16", rimDiameter: 16, rearSize: null },
        { size: "215/55R17", rimDiameter: 17, rearSize: null },
        { size: "235/40R18", rimDiameter: 18, rearSize: null },
      ],
    });
    const url = new URL(String(dataCalls(fetchMock)[0][0]));
    expect(url.pathname).toBe("/quicksearch/get-tire-size-by-year-make-model-submodel");
    expect(Object.fromEntries(url.searchParams)).toEqual({ year: "2018", make: "Honda", model: "Civic", submodel: "LX" });
  });

  it("sizes: P and LT prefixes folded so the size feeds publicSearch, duplicates dropped, non-metric passes through", async () => {
    vi.stubGlobal("fetch", dkFetch());
    expect(await caller().sizes({ year: 2018, make: "Toyota", model: "Tacoma", trim: "SR5 4WD" })).toEqual({
      ok: true,
      sizes: [
        { size: "245/75R16", rimDiameter: 16, rearSize: null },
        { size: "265/70R17", rimDiameter: 17, rearSize: null },
        { size: "31X10.50R15", rimDiameter: 15, rearSize: null },
      ],
    });
  });
});

describe("unknown is not empty", () => {
  it("a 500 is upstream_error, never an empty list", async () => {
    vi.stubGlobal("fetch", dkFetch(() => json({ detail: "boom" }, 500)));
    expect(await caller().makes({ year: 2018 })).toEqual({ ok: false, reason: "upstream_error" });
    expect(await caller().sizes({ ...VEHICLE, trim: "LX" })).toEqual({ ok: false, reason: "upstream_error" });
  });

  it("a 200 with zero items IS ok with an empty list", async () => {
    vi.stubGlobal("fetch", dkFetch(() => json([])));
    expect(await caller().makes({ year: 2018 })).toEqual({ ok: true, makes: [] });
    expect(await caller().sizes({ ...VEHICLE, trim: "LX" })).toEqual({ ok: true, sizes: [] });
  });

  it("bad JSON or a non-array body is upstream_error", async () => {
    vi.stubGlobal("fetch", dkFetch(() => new Response("<html>maintenance</html>", { status: 200 })));
    expect(await caller().years()).toEqual({ ok: false, reason: "upstream_error" });
    __resetFitmentForTest();
    vi.stubGlobal("fetch", dkFetch(() => json({ detail: "nope" })));
    expect(await caller().makes({ year: 2018 })).toEqual({ ok: false, reason: "upstream_error" });
  });

  it("an unknown submodel (D&K answers 400) is not_found", async () => {
    vi.stubGlobal("fetch", dkFetch());
    expect(await caller().sizes({ ...VEHICLE, trim: "Hovercraft" })).toEqual({ ok: false, reason: "not_found" });
  });

  it("a 401 drops the cached session so the next read logs in again", async () => {
    let first = true;
    const fetchMock = dkFetch((url) => {
      if (first) { first = false; return json({ detail: "expired" }, 401); }
      return fixtureData(url);
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await caller().years()).toEqual({ ok: false, reason: "upstream_error" });
    expect((await caller().years()).ok).toBe(true);
    expect(tokenCalls(fetchMock)).toHaveLength(2);
  });

  it("a thrown fetch is upstream_error and does not poison the cache", async () => {
    let first = true;
    const fetchMock = dkFetch((url) => {
      if (first) { first = false; throw new TypeError("fetch failed"); }
      return fixtureData(url);
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await caller().years()).toEqual({ ok: false, reason: "upstream_error" });
    expect(await caller().years()).toEqual({ ok: true, years: [2019, 2018, 2017] });
    expect(dataCalls(fetchMock)).toHaveLength(2);
  });

  it("a hung upstream times out at 6 s as upstream_error", async () => {
    // Log in first, with real timers, so the only pending timer below is the data call's.
    vi.stubGlobal("fetch", dkFetch());
    expect(await caller().status()).toEqual({ available: true });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.stubGlobal("fetch", dkFetch((_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })));
    let settled = false;
    const pending = caller().years().then((r) => { settled = true; return r; });
    await vi.advanceTimersByTimeAsync(5_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(await pending).toEqual({ ok: false, reason: "upstream_error" });
  });
});

describe("cache", () => {
  it("a repeat read is served from memory; a different vehicle is not", async () => {
    const fetchMock = dkFetch();
    vi.stubGlobal("fetch", fetchMock);
    await caller().trims(VEHICLE);
    expect((await caller().trims(VEHICLE)).ok).toBe(true);
    expect(dataCalls(fetchMock)).toHaveLength(1);
    await caller().trims({ ...VEHICLE, model: "CR-V" });
    expect(dataCalls(fetchMock)).toHaveLength(2);
  });

  it("failures are not cached", async () => {
    const fetchMock = dkFetch(() => json({}, 503));
    vi.stubGlobal("fetch", fetchMock);
    await caller().makes({ year: 2018 });
    await caller().makes({ year: 2018 });
    expect(dataCalls(fetchMock)).toHaveLength(2);
  });
});

describe("credentials and token never leave the server", () => {
  it("no log line and no response carries the password or the bearer token, on any failure shape", async () => {
    let n = 0;
    const fetchMock = dkFetch((url) => {
      n += 1;
      if (n === 1) throw new Error(`connect ECONNREFUSED ${url}`);
      if (n === 2) return json({ detail: `token ${TOKEN} rejected` }, 403);
      if (n === 3) return new Response(`bad ${TOKEN}`, { status: 200 });
      return json(dk.invalidSubmodel, 400);
    });
    vi.stubGlobal("fetch", fetchMock);
    const results = [
      await caller().years(),
      await caller().makes({ year: 2018 }),
      await caller().models({ year: 2018, make: "Honda" }),
      await caller().sizes({ ...VEHICLE, trim: "LX" }),
    ];
    expect(results.map((r) => r.ok)).toEqual([false, false, false, false]);
    // positive control: the failures WERE logged, so an empty log cannot pass this
    expect(logLines.some((l) => l.includes("get-make-by-year"))).toBe(true);
    const everything = logLines.join("\n") + JSON.stringify(results);
    expect(everything).not.toContain(TOKEN);
    expect(everything).not.toContain(PASS);
  });
});

describe("input validation", () => {
  it("rejects values outside the allowed shape before any network call", async () => {
    const fetchMock = dkFetch();
    vi.stubGlobal("fetch", fetchMock);
    await expect(caller().models({ year: 2018, make: "Honda<script>" })).rejects.toThrow();
    await expect(caller().trims({ year: 2018, make: "Honda", model: "Civic?x=1" })).rejects.toThrow();
    await expect(caller().trims({ year: 2018, make: "Honda", model: "x".repeat(41) })).rejects.toThrow();
    await expect(caller().makes({ year: 1979 })).rejects.toThrow();
    await expect(caller().sizes({ ...VEHICLE, trim: "   " })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
