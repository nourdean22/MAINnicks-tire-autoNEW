/**
 * fitment v1 · year > make > model > trim -> OE tire sizes through the Wheel-Size API.
 *
 * Driven through the real tRPC router (createCaller), with fetch stubbed. The real API is
 * never called. Each block pins one promise of the contract the client lane codes against:
 *   - no key: every procedure says "unconfigured" and makes ZERO network calls
 *   - an upstream failure is never an empty list (a 200 with no items IS an empty list)
 *   - the paid quota is capped per shop day (America/New_York, not UTC)
 *   - the key never reaches a log line or a response
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";

const logLines = vi.hoisted(() => [] as string[]);
vi.mock("../lib/logger", () => {
  const make = (module: string) => {
    const rec = (level: string) => (msg: string, ...args: unknown[]) => {
      logLines.push(`${level} ${module} ${msg} ${JSON.stringify(args)}`);
    };
    return { debug: rec("debug"), info: rec("info"), warn: rec("warn"), error: rec("error") };
  };
  return { createLogger: make, logger: make("root") };
});

import { fitmentRouter } from "../routers/fitment";
import { __resetFitmentForTest } from "../services/fitment/wheelSize";

const catalog = JSON.parse(readFileSync(new URL("./fixtures/fitment/catalog.json", import.meta.url), "utf8"));
const search = JSON.parse(readFileSync(new URL("./fixtures/fitment/search.json", import.meta.url), "utf8"));

const KEY = "test-key-5f3a9c";
const ENV_KEYS = ["WHEEL_SIZE_API_KEY", "WHEEL_SIZE_DAILY_CAP"] as const;
const savedEnv: Record<string, string | undefined> = {};

const caller = () => fitmentRouter.createCaller({} as TrpcContext);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Routes by upstream path; `/search/by_model/` picks the fixture by the modification slug. */
function fixtureFetch() {
  return vi.fn(async (input: string | URL) => {
    const url = new URL(String(input));
    switch (url.pathname) {
      case "/v2/years/": return json(catalog.years);
      case "/v2/makes/": return json(catalog.makes);
      case "/v2/models/": return json(catalog.models);
      case "/v2/modifications/": return json(catalog.modifications);
      case "/v2/search/by_model/": {
        const mod = url.searchParams.get("modification");
        if (mod === "3f9c1a2b7d") return json(search.lx);
        if (mod === "9e8d7c6b5a") return json(search.si);
        if (mod === "5aa5c0ffee") return json(search.staggered);
        return json({ data: [], meta: { count: 0 } });
      }
      default: return json({ detail: "Not found." }, 404);
    }
  });
}

const VEHICLE = { year: 2018, make: "honda", model: "civic" };

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  delete process.env.WHEEL_SIZE_DAILY_CAP;
  process.env.WHEEL_SIZE_API_KEY = KEY;
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
  __resetFitmentForTest();
});

describe("unconfigured: no key means no network call", () => {
  for (const value of [undefined, "", "   "]) {
    it(`WHEEL_SIZE_API_KEY=${JSON.stringify(value)} -> available:false and every read says unconfigured`, async () => {
      if (value === undefined) delete process.env.WHEEL_SIZE_API_KEY;
      else process.env.WHEEL_SIZE_API_KEY = value;
      const fetchMock = fixtureFetch();
      vi.stubGlobal("fetch", fetchMock);
      const c = caller();

      expect(await c.status()).toEqual({ available: false });
      const unconfigured = { ok: false, reason: "unconfigured" };
      expect(await c.years()).toEqual(unconfigured);
      expect(await c.makes({ year: 2018 })).toEqual(unconfigured);
      expect(await c.models({ year: 2018, make: "honda" })).toEqual(unconfigured);
      expect(await c.trims(VEHICLE)).toEqual(unconfigured);
      expect(await c.sizes({ ...VEHICLE, trim: "3f9c1a2b7d" })).toEqual(unconfigured);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  }

  it("positive control: with a key, status is available and a read does reach fetch", async () => {
    const fetchMock = fixtureFetch();
    vi.stubGlobal("fetch", fetchMock);
    expect(await caller().status()).toEqual({ available: true });
    expect((await caller().years()).ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("happy path through the router", () => {
  it("years: usdm region, descending, only years the makes input accepts", async () => {
    const fetchMock = fixtureFetch();
    vi.stubGlobal("fetch", fetchMock);
    expect(await caller().years()).toEqual({ ok: true, years: [2019, 2018, 2017] });
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe("https://api.wheel-size.com/v2/years/");
    expect(url.searchParams.get("region")).toBe("usdm");
    expect(url.searchParams.get("user_key")).toBe(KEY);
  });

  it("makes and models map slug + name and drop slugs the client could never send back", async () => {
    const fetchMock = fixtureFetch();
    vi.stubGlobal("fetch", fetchMock);
    expect(await caller().makes({ year: 2018 })).toEqual({
      ok: true,
      makes: [{ slug: "honda", name: "Honda" }, { slug: "land-rover", name: "Land Rover" }],
    });
    expect(await caller().models({ year: 2018, make: "honda" })).toEqual({
      ok: true,
      models: [{ slug: "civic", name: "Civic" }, { slug: "cr-v", name: "CR-V" }],
    });
    const modelsUrl = new URL(String(fetchMock.mock.calls[1][0]));
    expect(modelsUrl.searchParams.get("make")).toBe("honda");
    expect(modelsUrl.searchParams.get("year")).toBe("2018");
  });

  it("trims: label from trim + body type, ASCII only, identical labels deduped", async () => {
    vi.stubGlobal("fetch", fixtureFetch());
    expect(await caller().trims(VEHICLE)).toEqual({
      ok: true,
      trims: [
        { slug: "3f9c1a2b7d", label: "LX - 4 Dr Sedan" },
        { slug: "9e8d7c6b5a", label: "Si - 2 Dr Coupe" },
      ],
    });
  });

  it("sizes: stock first, normalised, deduped on size + rear size", async () => {
    const fetchMock = fixtureFetch();
    vi.stubGlobal("fetch", fetchMock);
    expect(await caller().sizes({ ...VEHICLE, trim: "3f9c1a2b7d" })).toEqual({
      ok: true,
      sizes: [
        { size: "215/55R16", rimDiameter: 16, isStock: true, rearSize: null },
        { size: "215/50R17", rimDiameter: 17, isStock: true, rearSize: null },
        { size: "225/40R18", rimDiameter: 18, isStock: false, rearSize: null },
      ],
    });
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe("/v2/search/by_model/");
    expect(url.searchParams.get("modification")).toBe("3f9c1a2b7d");
    expect(url.searchParams.get("region")).toBe("usdm");
  });

  it("sizes: the Si coupe gets its own size", async () => {
    vi.stubGlobal("fetch", fixtureFetch());
    expect(await caller().sizes({ ...VEHICLE, trim: "9e8d7c6b5a" })).toEqual({
      ok: true,
      sizes: [{ size: "235/40R18", rimDiameter: 18, isStock: true, rearSize: null }],
    });
  });

  it("sizes: staggered fitment carries the rear size; LT is stripped; a non-metric size passes through", async () => {
    vi.stubGlobal("fetch", fixtureFetch());
    expect(await caller().sizes({ year: 2018, make: "bmw", model: "4-series", trim: "5aa5c0ffee" })).toEqual({
      ok: true,
      sizes: [
        { size: "245/40R19", rimDiameter: 19, isStock: true, rearSize: "275/35R19" },
        { size: "265/70R17", rimDiameter: 17, isStock: false, rearSize: null },
        { size: "31X10.50R15", rimDiameter: 15, isStock: false, rearSize: null },
      ],
    });
  });
});

describe("unknown is not empty", () => {
  it("a 500 is upstream_error, never an empty list", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ detail: "boom" }, 500)));
    expect(await caller().makes({ year: 2018 })).toEqual({ ok: false, reason: "upstream_error" });
    expect(await caller().sizes({ ...VEHICLE, trim: "3f9c1a2b7d" })).toEqual({ ok: false, reason: "upstream_error" });
  });

  it("a 200 with zero items IS ok with an empty list", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ data: [], meta: { count: 0 } })));
    expect(await caller().makes({ year: 2018 })).toEqual({ ok: true, makes: [] });
    expect(await caller().sizes({ ...VEHICLE, trim: "3f9c1a2b7d" })).toEqual({ ok: true, sizes: [] });
  });

  it("bad JSON or a body without a data array is upstream_error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>gateway</html>", { status: 200 })));
    expect(await caller().years()).toEqual({ ok: false, reason: "upstream_error" });
    vi.stubGlobal("fetch", vi.fn(async () => json({ detail: "nope" })));
    expect(await caller().makes({ year: 2018 })).toEqual({ ok: false, reason: "upstream_error" });
  });

  it("a 404 is not_found", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ detail: "Not found." }, 404)));
    expect(await caller().models({ year: 2018, make: "honda" })).toEqual({ ok: false, reason: "not_found" });
  });

  it("a thrown fetch is upstream_error and does not poison the cache", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockImplementation(fixtureFetch());
    vi.stubGlobal("fetch", fetchMock);
    expect(await caller().years()).toEqual({ ok: false, reason: "upstream_error" });
    expect(await caller().years()).toEqual({ ok: true, years: [2019, 2018, 2017] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a hung upstream times out at 6 s as upstream_error", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })));
    const pending = caller().years();
    await vi.advanceTimersByTimeAsync(5_999);
    let settled = false;
    void pending.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(await pending).toEqual({ ok: false, reason: "upstream_error" });
  });
});

describe("cache", () => {
  it("a repeat read is served from memory; the cache key does not include the API key", async () => {
    const fetchMock = fixtureFetch();
    vi.stubGlobal("fetch", fetchMock);
    await caller().trims(VEHICLE);
    process.env.WHEEL_SIZE_API_KEY = "rotated-key-000";
    expect((await caller().trims(VEHICLE)).ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await caller().trims({ ...VEHICLE, model: "cr-v" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("failures are not cached", async () => {
    const fetchMock = vi.fn(async () => json({}, 503));
    vi.stubGlobal("fetch", fetchMock);
    await caller().makes({ year: 2018 });
    await caller().makes({ year: 2018 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("daily cost cap", () => {
  it("stops calling upstream at the cap and says daily_cap", async () => {
    process.env.WHEEL_SIZE_DAILY_CAP = "2";
    const fetchMock = fixtureFetch();
    vi.stubGlobal("fetch", fetchMock);
    expect((await caller().makes({ year: 2017 })).ok).toBe(true);
    expect((await caller().makes({ year: 2018 })).ok).toBe(true);
    expect(await caller().makes({ year: 2019 })).toEqual({ ok: false, reason: "daily_cap" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // cached answers are still served at the cap: they cost nothing
    expect((await caller().makes({ year: 2018 })).ok).toBe(true);
  });

  it("failed upstream calls still count against the cap", async () => {
    process.env.WHEEL_SIZE_DAILY_CAP = "1";
    vi.stubGlobal("fetch", vi.fn(async () => json({}, 500)));
    expect(await caller().years()).toEqual({ ok: false, reason: "upstream_error" });
    expect(await caller().years()).toEqual({ ok: false, reason: "daily_cap" });
  });

  it("the cap day rolls over at midnight in Cleveland, not at midnight UTC", async () => {
    process.env.WHEEL_SIZE_DAILY_CAP = "1";
    vi.useFakeTimers({ toFake: ["Date"] });
    const fetchMock = fixtureFetch();
    vi.stubGlobal("fetch", fetchMock);

    vi.setSystemTime(new Date("2026-10-18T23:30:00Z")); // 19:30 ET, Oct 18
    expect((await caller().makes({ year: 2017 })).ok).toBe(true);
    vi.setSystemTime(new Date("2026-10-19T01:00:00Z")); // 21:00 ET, still Oct 18; already Oct 19 in UTC
    expect(await caller().makes({ year: 2018 })).toEqual({ ok: false, reason: "daily_cap" });
    vi.setSystemTime(new Date("2026-10-19T04:30:00Z")); // 00:30 ET, Oct 19
    expect((await caller().makes({ year: 2018 })).ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("an unusable WHEEL_SIZE_DAILY_CAP falls back to the default instead of opening or closing the tap", async () => {
    process.env.WHEEL_SIZE_DAILY_CAP = "lots";
    vi.stubGlobal("fetch", fixtureFetch());
    expect((await caller().makes({ year: 2018 })).ok).toBe(true);
    process.env.WHEEL_SIZE_DAILY_CAP = "0";
    expect((await caller().makes({ year: 2019 })).ok).toBe(true);
  });
});

describe("the key never leaves the server", () => {
  it("no log line and no response carries the key, on any failure shape", async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(async (url: string) => { throw new Error(`connect ECONNREFUSED ${url}`); })
      .mockImplementationOnce(async () => json({ detail: `Invalid user_key ${KEY}` }, 401))
      .mockImplementationOnce(async () => new Response(`bad ${KEY}`, { status: 200 }))
      .mockImplementationOnce(async () => json({ detail: "Not found." }, 404));
    vi.stubGlobal("fetch", fetchMock);
    const results = [
      await caller().years(),
      await caller().makes({ year: 2018 }),
      await caller().models({ year: 2018, make: "honda" }),
      await caller().trims(VEHICLE),
    ];
    expect(results.map((r) => r.ok)).toEqual([false, false, false, false]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    // positive control: the failures WERE logged, so an empty log cannot pass this
    expect(logLines.some((l) => l.includes("/makes/"))).toBe(true);
    expect(logLines.join("\n")).not.toContain(KEY);
    expect(JSON.stringify(results)).not.toContain(KEY);
  });
});

describe("input validation", () => {
  it("rejects slugs outside the lowercase slug shape before any network call", async () => {
    const fetchMock = fixtureFetch();
    vi.stubGlobal("fetch", fetchMock);
    await expect(caller().models({ year: 2018, make: "Honda" })).rejects.toThrow();
    await expect(caller().trims({ year: 2018, make: "honda", model: "civic&user_key=x" })).rejects.toThrow();
    await expect(caller().makes({ year: 1979 })).rejects.toThrow();
    await expect(caller().sizes({ ...VEHICLE, trim: "" })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
