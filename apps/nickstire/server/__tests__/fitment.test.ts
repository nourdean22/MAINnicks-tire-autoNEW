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

// Module state (the cache, the remembered login failure, gatewayClient's session) is reset by
// re-importing the router graph fresh for every test, so production code carries no test seam.
let fitmentRouter: typeof import("../routers/fitment").fitmentRouter;

const dk = JSON.parse(readFileSync(new URL("./fixtures/fitment/dk.json", import.meta.url), "utf8"));

const USER = "shop-user-7c1";
const PASS = "shop-pass-9e4";
const TOKEN = "jwt-token-3b8d";
const ENV_KEYS = ["GATEWAY_TIRE_USERNAME", "GATEWAY_TIRE_PASSWORD", "GATEWAY_TIRE_SHIP_TO"] as const;
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

beforeEach(async () => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.GATEWAY_TIRE_USERNAME = USER;
  process.env.GATEWAY_TIRE_PASSWORD = PASS;
  vi.resetModules();
  ({ fitmentRouter } = await import("../routers/fitment"));
  logLines.length = 0;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.unstubAllGlobals();
  vi.useRealTimers();
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
        { size: "215/50R17", label: "215/50R17", rimDiameter: 17, rearSize: null, searchable: true },
        { size: "215/55R16", label: "215/55R16", rimDiameter: 16, rearSize: null, searchable: true },
        { size: "215/55R17", label: "215/55R17", rimDiameter: 17, rearSize: null, searchable: true },
        { size: "235/40R18", label: "235/40R18", rimDiameter: 18, rearSize: null, searchable: true },
      ],
    });
    const url = new URL(String(dataCalls(fetchMock)[0][0]));
    expect(url.pathname).toBe("/quicksearch/get-tire-size-by-year-make-model-submodel");
    expect(Object.fromEntries(url.searchParams)).toEqual({ year: "2018", make: "Honda", model: "Civic", submodel: "LX" });
  });

  it("sizes: metric sizes searchable in WWW/AARDD form with the raw label kept; a flotation size is shown, not searchable", async () => {
    vi.stubGlobal("fetch", dkFetch());
    expect(await caller().sizes({ year: 2018, make: "Toyota", model: "Tacoma", trim: "SR5 4WD" })).toEqual({
      ok: true,
      sizes: [
        // LT construction: the size search cannot filter by service class, so a call-us row (Codex round 4)
        { size: "245/75R16", label: "LT245/75R16", rimDiameter: 16, rearSize: null, searchable: false },
        { size: "265/70R17", label: "P265/70R17", rimDiameter: 17, rearSize: null, searchable: true },
        { size: "31X10.50R15", label: "31X10.50R15", rimDiameter: 15, rearSize: null, searchable: false },
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
    vi.stubGlobal("fetch", dkFetch(() => json({ detail: "nope" })));
    expect(await caller().makes({ year: 2018 })).toEqual({ ok: false, reason: "upstream_error" });
  });

  it("an unknown submodel (D&K answers 400) is not_found; a stale model on trims is not_found too", async () => {
    vi.stubGlobal("fetch", dkFetch((url) => url.pathname.includes("get-sub-model") ? json({ detail: "Invalid model value" }, 400) : fixtureData(url)));
    expect(await caller().sizes({ ...VEHICLE, trim: "Hovercraft" })).toEqual({ ok: false, reason: "not_found" });
    expect(await caller().trims(VEHICLE)).toEqual({ ok: false, reason: "not_found" });
  });

  it("a 4xx on years, makes or models is a contract break: upstream_error (the client offers retry), never not_found", async () => {
    vi.stubGlobal("fetch", dkFetch(() => json({ detail: "Invalid year value" }, 400)));
    expect(await caller().years()).toEqual({ ok: false, reason: "upstream_error" });
    expect(await caller().makes({ year: 2018 })).toEqual({ ok: false, reason: "upstream_error" });
    expect(await caller().models({ year: 2018, make: "Honda" })).toEqual({ ok: false, reason: "upstream_error" });
    expect(logLines.filter((l) => l.startsWith("warn") && / -> 400/.test(l))).toHaveLength(3);
  });

  it("a 401 drops the cached session so the next read (after the 30 s negative cache) logs in again", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    let first = true;
    const fetchMock = dkFetch((url) => {
      if (first) { first = false; return json({ detail: "expired" }, 401); }
      return fixtureData(url);
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await caller().years()).toEqual({ ok: false, reason: "upstream_error" });
    vi.setSystemTime(Date.now() + 31_000);
    expect((await caller().years()).ok).toBe(true);
    expect(tokenCalls(fetchMock)).toHaveLength(2);
  });

  it("a thrown fetch is upstream_error and does not poison the cache past the 30 s negative cache", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    let first = true;
    const fetchMock = dkFetch((url) => {
      if (first) { first = false; throw new TypeError("fetch failed"); }
      return fixtureData(url);
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await caller().years()).toEqual({ ok: false, reason: "upstream_error" });
    vi.setSystemTime(Date.now() + 31_000);
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

  it("a failure is remembered for 30 s per key (no re-hit of D&K), then retried", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const fetchMock = dkFetch(() => json({}, 503));
    vi.stubGlobal("fetch", fetchMock);
    expect(await caller().makes({ year: 2018 })).toEqual({ ok: false, reason: "upstream_error" });
    expect(await caller().makes({ year: 2018 })).toEqual({ ok: false, reason: "upstream_error" });
    expect(dataCalls(fetchMock)).toHaveLength(1);
    vi.setSystemTime(Date.now() + 31_000);
    await caller().makes({ year: 2018 });
    expect(dataCalls(fetchMock)).toHaveLength(2);
  });

  it("a not_found is remembered for 30 s too", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const fetchMock = dkFetch();
    vi.stubGlobal("fetch", fetchMock);
    expect(await caller().sizes({ ...VEHICLE, trim: "Hovercraft" })).toEqual({ ok: false, reason: "not_found" });
    expect(await caller().sizes({ ...VEHICLE, trim: "Hovercraft" })).toEqual({ ok: false, reason: "not_found" });
    expect(dataCalls(fetchMock)).toHaveLength(1);
    vi.setSystemTime(Date.now() + 31_000);
    await caller().sizes({ ...VEHICLE, trim: "Hovercraft" });
    expect(dataCalls(fetchMock)).toHaveLength(2);
  });

  it("N identical concurrent reads make ONE D&K call (single flight)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const fetchMock = dkFetch(async (url) => { await gate; return fixtureData(url); });
    vi.stubGlobal("fetch", fetchMock);
    const pending = Array.from({ length: 8 }, () => caller().sizes({ ...VEHICLE, trim: "LX" }));
    await new Promise((r) => setTimeout(r, 20));
    release();
    const results = await Promise.all(pending);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(dataCalls(fetchMock)).toHaveLength(1);
  });
});

describe("D&K login: no token storm", () => {
  it("two concurrent token refreshes make ONE /token call", async () => {
    const { getGatewayToken } = await import("../services/gatewayClient");
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const fetchMock = vi.fn(async () => { await gate; return json({ access_token: TOKEN }); });
    vi.stubGlobal("fetch", fetchMock);
    const both = Promise.all([getGatewayToken(), getGatewayToken(), getGatewayToken()]);
    await new Promise((r) => setTimeout(r, 20));
    release();
    expect(await both).toEqual([TOKEN, TOKEN, TOKEN]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("after a failed /token, logins pause 15 s instead of retrying on every call", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { getGatewayToken } = await import("../services/gatewayClient");
    const fetchMock = vi.fn(async () => json({ detail: "bad creds" }, 401));
    vi.stubGlobal("fetch", fetchMock);
    expect(await getGatewayToken()).toBeNull();
    expect(await getGatewayToken()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 16_000);
    expect(await getGatewayToken()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("concurrent 401s on one expired token cause one re-login, not one per read", async () => {
    let issued = 0;
    // Each login mints a DIFFERENT token, as D&K does; D&K rejects only the first (expired) one.
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === "/token") return json({ access_token: `${TOKEN}-${++issued}` });
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
      return auth === `Bearer ${TOKEN}-1` ? json({ detail: "expired" }, 401) : fixtureData(url);
    });
    vi.stubGlobal("fetch", fetchMock);
    await Promise.all([caller().years(), caller().makes({ year: 2018 }), caller().models({ year: 2018, make: "Honda" })]);
    await Promise.all([caller().trims(VEHICLE), caller().sizes({ ...VEHICLE, trim: "LX" }), caller().sizes({ ...VEHICLE, trim: "Si" })]);
    expect(tokenCalls(fetchMock).length).toBeLessThanOrEqual(2);
  });
});

describe("a late 401 for an old token", () => {
  it("does not throw away the fresh token another read already logged in with", async () => {
    let issued = 0;
    let releaseLate!: () => void;
    const late = new Promise<void>((r) => { releaseLate = r; });
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === "/token") return json({ access_token: `${TOKEN}-${++issued}` });
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
      if (auth === `Bearer ${TOKEN}-1`) {
        if (url.pathname.includes("list-all-year")) await late; // this 401 arrives late
        return json({ detail: "expired" }, 401);
      }
      return fixtureData(url);
    });
    vi.stubGlobal("fetch", fetchMock);
    const slow = caller().years(); // holds token-1; its 401 is delayed
    await new Promise((r) => setTimeout(r, 20));
    expect(await caller().makes({ year: 2018 })).toEqual({ ok: false, reason: "upstream_error" }); // 401 now, drops token-1
    expect((await caller().models({ year: 2018, make: "Honda" })).ok).toBe(true); // logs in: token-2
    releaseLate();
    expect(await slow).toEqual({ ok: false, reason: "upstream_error" });
    expect((await caller().trims(VEHICLE)).ok).toBe(true); // still token-2
    expect(tokenCalls(fetchMock)).toHaveLength(2);
  });
});

describe("a late 401 on a tire SEARCH (Codex on #3148)", () => {
  it("does not wipe the fresh token a fitment read already logged in with", async () => {
    process.env.GATEWAY_TIRE_SHIP_TO = "SHIP-TO-UUID";
    const { searchTiresBySize } = await import("../services/gatewayClient");
    let issued = 0;
    let releaseLate!: () => void;
    const late = new Promise<void>((r) => { releaseLate = r; });
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === "/token") return json({ access_token: `${TOKEN}-${++issued}` });
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
      if (auth === `Bearer ${TOKEN}-1`) {
        if (url.pathname === "/quicksearch/cache") await late; // the search's 401 arrives late
        return json({ detail: "expired" }, 401);
      }
      return fixtureData(url);
    });
    vi.stubGlobal("fetch", fetchMock);
    const search = searchTiresBySize("215/55R16"); // holds token-1
    await new Promise((r) => setTimeout(r, 20));
    expect(await caller().makes({ year: 2018 })).toEqual({ ok: false, reason: "upstream_error" }); // 401 now, drops token-1
    expect((await caller().models({ year: 2018, make: "Honda" })).ok).toBe(true); // logs in: token-2
    releaseLate();
    expect(await search).toBeNull();
    expect((await caller().trims(VEHICLE)).ok).toBe(true); // still token-2
    expect(tokenCalls(fetchMock)).toHaveLength(2);
  });
});

describe("a nonempty D&K list with nothing usable is unknown, not empty (Codex on #3148)", () => {
  it("makes whose every entry is malformed or outside the value shape -> upstream_error, logged with the count", async () => {
    vi.stubGlobal("fetch", dkFetch(() => json([{ value: "Bad<Make>", label: "Bad" }, { value: 7, label: "x" }, { nope: true }])));
    expect(await caller().makes({ year: 2018 })).toEqual({ ok: false, reason: "upstream_error" });
    expect(logLines.some((l) => l.startsWith("warn") && /get-make-by-year.*3 rows, none usable/.test(l))).toBe(true);
  });

  it("the same for years, models, trims and sizes", async () => {
    vi.stubGlobal("fetch", dkFetch(() => json([{ label: "no value" }])));
    expect(await caller().years()).toEqual({ ok: false, reason: "upstream_error" });
    expect(await caller().models({ year: 2018, make: "Honda" })).toEqual({ ok: false, reason: "upstream_error" });
    expect(await caller().trims(VEHICLE)).toEqual({ ok: false, reason: "upstream_error" });
    expect(await caller().sizes({ ...VEHICLE, trim: "LX" })).toEqual({ ok: false, reason: "upstream_error" });
  });

  it("control: an EMPTY D&K list is still ok with an empty list; one usable entry is kept", async () => {
    vi.stubGlobal("fetch", dkFetch(() => json([])));
    expect(await caller().makes({ year: 2018 })).toEqual({ ok: true, makes: [] });
    vi.stubGlobal("fetch", dkFetch(() => json([{ value: "Bad<Make>", label: "Bad" }, { value: "Honda", label: "Honda" }])));
    expect(await caller().makes({ year: 2019 })).toEqual({ ok: true, makes: [{ slug: "Honda", name: "Honda" }] });
  });
});

describe("decimal rims (Codex on #3148)", () => {
  it("295/75R22.5 is shown with its rim but not searchable (the size search would read it as R225)", async () => {
    vi.stubGlobal("fetch", dkFetch(() => json([{ value: "295/75R22.5", label: "295/75R22.5" }, { value: "225/70R19.5", label: "225/70R19.5" }, { value: "245/75R16", label: "245/75R16" }])));
    expect(await caller().sizes({ year: 2018, make: "Ford", model: "F-650", trim: "Base" })).toEqual({
      ok: true,
      sizes: [
        { size: "295/75R22.5", label: "295/75R22.5", rimDiameter: 22.5, rearSize: null, searchable: false },
        { size: "225/70R19.5", label: "225/70R19.5", rimDiameter: 19.5, rearSize: null, searchable: false },
        { size: "245/75R16", label: "245/75R16", rimDiameter: 16, rearSize: null, searchable: true },
      ],
    });
  });
});

describe("service-class prefixes (Codex round 4 on #3148)", () => {
  it("LT and ST sizes keep the metric size and raw label but are not searchable; P-metric stays searchable", async () => {
    vi.stubGlobal("fetch", dkFetch(() => json([
      { value: "LT265/70R17", label: "LT265/70R17" },
      { value: "ST225/75R15", label: "ST225/75R15" },
      { value: "P215/55R16", label: "P215/55R16" },
      { value: "215/60R16", label: "215/60R16" },
    ])));
    expect(await caller().sizes({ year: 2018, make: "Ford", model: "F-250", trim: "XL" })).toEqual({
      ok: true,
      sizes: [
        { size: "265/70R17", label: "LT265/70R17", rimDiameter: 17, rearSize: null, searchable: false },
        { size: "225/75R15", label: "ST225/75R15", rimDiameter: 15, rearSize: null, searchable: false },
        { size: "215/55R16", label: "P215/55R16", rimDiameter: 16, rearSize: null, searchable: true },
        { size: "215/60R16", label: "215/60R16", rimDiameter: 16, rearSize: null, searchable: true },
      ],
    });
  });
});

describe("per-call rate limit (a batched HTTP request is N calls, not one)", () => {
  const ipCaller = (ip: string) =>
    fitmentRouter.createCaller({ req: { ip, headers: {} } } as unknown as TrpcContext);

  it("the 21st call in a minute from one IP is rate_limited with no D&K call; another IP is not", async () => {
    const fetchMock = dkFetch();
    vi.stubGlobal("fetch", fetchMock);
    const results = [];
    for (let i = 0; i < 20; i++) results.push(await ipCaller("203.0.113.9").makes({ year: 1990 + i }));
    expect(results.every((r) => r.ok)).toBe(true);
    const before = dataCalls(fetchMock).length;
    expect(await ipCaller("203.0.113.9").makes({ year: 2015 })).toEqual({ ok: false, reason: "rate_limited" });
    expect(dataCalls(fetchMock).length).toBe(before);
    expect((await ipCaller("198.51.100.7").makes({ year: 2015 })).ok).toBe(true);
  });

  it("the minute window slides; the 15-minute budget (120) still holds", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.stubGlobal("fetch", dkFetch());
    const c = ipCaller("203.0.113.10");
    let limited = 0;
    for (let minute = 0; minute < 7; minute++) {
      for (let i = 0; i < 20; i++) if (!(await c.years()).ok) limited++;
      vi.setSystemTime(Date.now() + 61_000);
    }
    // 7 minutes x 20 = 140 calls inside 15 minutes: the first 120 pass, the last 20 do not.
    expect(limited).toBe(20);
  });

  it("status is not limited: the page calls it on every mount", async () => {
    vi.stubGlobal("fetch", dkFetch());
    const c = ipCaller("203.0.113.11");
    for (let i = 0; i < 25; i++) expect(await c.status()).toEqual({ available: true });
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
