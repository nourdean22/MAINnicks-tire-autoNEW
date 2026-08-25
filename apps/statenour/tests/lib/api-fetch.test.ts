/**
 * The envelope must be unreachable, and three live panels prove why.
 *
 * THE DEFECT. `apiHandler` wraps every response as `{ ok, data, meta }`. A caller
 * writing `(await res.json()) as Thing[]` gets the ENVELOPE plus a cast that
 * says otherwise. `as` is an assertion, not a check, so TypeScript is satisfied,
 * the build is green, and the component renders the wrong thing on a 200.
 *
 * All three were live, all three were silent, none logged anything:
 *
 *   self-critique-card     `Array.isArray(envelope)` is false → [] → the panel
 *                          rendered NOTHING at all.
 *   location-ranking-card  `envelope.found` is undefined → permanently
 *                          "not found", on every successful response.
 *   OpportunityCard        the route returns `{status:"success"}` INSIDE `data`,
 *                          so `envelope.status` was undefined, the branch never
 *                          ran, and the POST succeeded while the UI sat still.
 *
 * MEASURED 2026-08-24: 238 of 381 routes envelope (62%). The remaining 143 do
 * not, which is why `rawFetch` exists — see the module header for why that is a
 * declaration rather than a loophole.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { unwrapApi, apiFetch, rawFetch, ApiError } from "@/lib/utils/api-fetch";

const envelope = (over: Record<string, unknown> = {}) => ({
  ok: true,
  data: { hello: "world" },
  meta: { duration_ms: 1, timestamp: "t", request_id: "r" },
  ...over,
});

function mockFetch(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const fn = vi.fn().mockResolvedValue({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("unwrapApi · the envelope comes off", () => {
  it("returns data, not the envelope", () => {
    expect(unwrapApi<{ hello: string }>(envelope())).toEqual({ hello: "world" });
  });

  it("THE ARTEFACT: an array payload survives as an array", () => {
    // self-critique-card's exact failure. Array.isArray(envelope) is false,
    // which is how a panel renders nothing on a 200.
    const body = envelope({ data: [{ id: 1 }, { id: 2 }] });
    expect(Array.isArray(body)).toBe(false); // the shape that broke it
    expect(Array.isArray(unwrapApi(body))).toBe(true);
  });

  it("throws on an envelope reporting failure — silence was the old behaviour", () => {
    expect(() => unwrapApi(envelope({ ok: false, error: "nope", data: undefined }))).toThrow(ApiError);
    try {
      unwrapApi(envelope({ ok: false, error: "nope" }), 422);
    } catch (e) {
      expect((e as ApiError).message).toBe("nope");
      expect((e as ApiError).status).toBe(422);
    }
  });

  it("a NON-enveloped body passes through untouched", () => {
    // 143 of 381 routes return a bare body. If this threw, the helper would be
    // unusable mid-migration and people would route around it — which is how a
    // helper reaches 62% adoption and stops.
    expect(unwrapApi<{ a: number }>({ a: 1 })).toEqual({ a: 1 });
    expect(unwrapApi<number[]>([1, 2, 3])).toEqual([1, 2, 3]);
  });
});

describe("apiFetch · returns T, never the envelope", () => {
  it("unwraps and sends credentials by default", async () => {
    // A missing `credentials: "include"` produces a 401 that reads like an empty
    // result — OpportunityCard was missing it entirely.
    const f = mockFetch(envelope());
    const out = await apiFetch<{ hello: string }>("/api/x");
    expect(out).toEqual({ hello: "world" });
    expect(f.mock.calls[0][1]).toMatchObject({ credentials: "include" });
  });

  it("an explicit init still overrides, and method survives", async () => {
    const f = mockFetch(envelope());
    await apiFetch("/api/x", { method: "POST", body: "{}" });
    expect(f.mock.calls[0][1]).toMatchObject({ method: "POST", credentials: "include" });
  });

  it("prefers the envelope's error message over the bare status", async () => {
    mockFetch(envelope({ ok: false, error: "quota exhausted" }), { ok: false, status: 429 });
    await expect(apiFetch("/api/x")).rejects.toThrow("quota exhausted");
  });

  it("throws on a non-JSON error body rather than returning undefined", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error("not json");
        },
      }),
    );
    await expect(apiFetch("/api/x")).rejects.toThrow(ApiError);
  });

  it("tolerateHttpError returns undefined instead of throwing, when asked", async () => {
    mockFetch({}, { ok: false, status: 404 });
    await expect(apiFetch("/api/x", { tolerateHttpError: true })).resolves.toBeUndefined();
  });

  it("POSITIVE CONTROL: a healthy call does NOT throw", async () => {
    // Without this, an implementation that threw on everything would satisfy
    // every rejection assertion above while breaking every screen.
    mockFetch(envelope());
    await expect(apiFetch("/api/x")).resolves.toBeDefined();
  });
});

describe("rawFetch · the declaration, not the loophole", () => {
  it("returns the body as-is for a non-enveloping route", async () => {
    mockFetch({ plain: true });
    expect(await rawFetch<{ plain: boolean }>("/api/y")).toEqual({ plain: true });
  });

  it("still throws on an HTTP error", async () => {
    mockFetch({}, { ok: false, status: 500 });
    await expect(rawFetch("/api/y")).rejects.toThrow(ApiError);
  });
});

describe("the three live panels are actually fixed", () => {
  const read = (p: string) => {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    return readFileSync(p, "utf8");
  };

  const CASES: Array<[string, string]> = [
    ["components/brain/self-critique-card.tsx", "CritiqueMemory[]"],
    ["components/financial/location-ranking-card.tsx", "LocationRanking"],
    ["components/intelligence/OpportunityCard.tsx", "status?: string"],
  ];

  for (const [file, typeArg] of CASES) {
    it(`${file} uses apiFetch with a real type argument`, () => {
      const src = read(file);
      expect(src).toContain("apiFetch<");
      expect(src, "the type argument must name the payload, not the envelope").toContain(typeArg);
      expect(src, "a bare res.json() cast is what broke it").not.toMatch(/await res\.json\(\)\)? as/);
    });
  }

  it("none of the three still casts a raw json() result", () => {
    for (const [file] of CASES) {
      expect(read(file), `${file} still holds a raw .json() cast`).not.toMatch(/\(await res\.json\(\)\) as/);
    }
  });
});
