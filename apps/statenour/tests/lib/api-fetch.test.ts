/**
 * The envelope must be unreachable, and three live panels proved why.
 *
 * THE DEFECT. `apiHandler` wraps every response as `{ ok, data, meta }`. A caller
 * writing `(await res.json()) as Thing[]` gets the ENVELOPE plus a cast that
 * says otherwise. `as` is an assertion, not a check, so TypeScript is satisfied,
 * the build is green, and the component renders the wrong thing on a 200.
 *
 * All three were live, all three were silent, none logged anything:
 *
 *   self-critique-card     `Array.isArray(envelope)` is false -> [] -> the panel
 *                          rendered NOTHING at all.
 *   location-ranking-card  `envelope.found` is undefined -> permanently
 *                          "not found", on every successful response.
 *   OpportunityCard        the route returns `{status:"success"}` INSIDE `data`,
 *                          so `envelope.status` was undefined, the branch never
 *                          ran, and the POST succeeded while the UI sat still.
 *
 * MEASURED 2026-08-24: 238 of 381 routes envelope (62%). The remaining 143 do
 * not, which is why `rawFetch` exists -- see the module header for why that is a
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

describe("rawFetch · the declaration, and the check that makes it worth calling", () => {
  it("returns the body as-is for a non-enveloping route", async () => {
    mockFetch({ plain: true });
    expect(await rawFetch<{ plain: boolean }>("/api/y")).toEqual({ plain: true });
  });

  it("still throws on an HTTP error", async () => {
    mockFetch({}, { ok: false, status: 500 });
    await expect(rawFetch("/api/y")).rejects.toThrow(ApiError);
  });

  it("THE POINT: throws the moment that route starts enveloping", async () => {
    // MEASURED: zero of the 18 remaining casts are live defects, so the whole
    // value of converting them is this one behaviour. Someone wraps the route in
    // `apiHandler` — a one-line, obviously-correct change — and without this the
    // component renders an empty panel on a 200, silently, for weeks.
    mockFetch(envelope());
    await expect(rawFetch("/api/y")).rejects.toThrow(ApiError);
  });

  it("names the route and the fix, not just 'error'", async () => {
    // An alert nobody can act on is barely better than silence. The message has
    // to say which call to change and what to change it to.
    mockFetch(envelope());
    await expect(rawFetch("/api/ai/goals-brief")).rejects.toThrow(/goals-brief.*apiFetch/);
  });

  it("POSITIVE CONTROL: it DISCRIMINATES, it does not just throw", async () => {
    // Without this, a rawFetch that threw on every body would satisfy both
    // assertions above while breaking all 18 call sites it was built to protect.
    // The bodies below are the real shapes those routes return today.
    mockFetch({ brief: "text" });
    await expect(rawFetch("/api/ai/goals-brief")).resolves.toEqual({ brief: "text" });
    mockFetch({ items: [] });
    await expect(rawFetch("/api/relationships/watchlist")).resolves.toEqual({ items: [] });
  });

  it("a bare body that merely HAS an `ok` field is not an envelope", async () => {
    // mission-retro-modal's route returns `{ ok, warning }`. The discriminator
    // needs both `ok` AND `meta`, so that body is not rejected — otherwise the
    // strictness would break a live surface and get reverted.
    mockFetch({ ok: true, warning: "retro_write_failed" });
    await expect(rawFetch("/api/y")).resolves.toEqual({ ok: true, warning: "retro_write_failed" });
  });
});

describe("the repo-wide rule, not three named files", () => {
  // REWRITTEN 2026-08-24, twice, and the second rewrite is the interesting one.
  //
  // FIRST it asserted that three NAMED components contain `apiFetch<` — a
  // permanent control hard-coded to a temporary datum. Any of the three could be
  // renamed or deleted and the test would block a correct change rather than
  // catch a defect.
  //
  // THEN it banned every `(await x.json()) as` under components/. That fired,
  // but measuring the whole repo showed the rule was both too narrow and too
  // broad: 124 such casts exist, and most are not this bug.
  //
  //     33   `(await req.json()) as` — a route parsing its own REQUEST body.
  //     ~45  a VENDOR response (gmail, exa, tavily, replicate, cohere), where
  //          our envelope contract does not apply and unwrapping would be wrong.
  //     18   a response from our OWN /api/ route. Only these can carry it.
  //
  // A ban on all 124 is unshippable, so it would grow an exemption list, and an
  // exemption list is how a gate becomes decoration. The rule below is exactly
  // as wide as the contract: a response from our own `/api/` route must not be
  // cast. It needs no exemptions because it describes precisely the population
  // where the envelope can bite.
  const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
  const { readFileSync } = require("node:fs") as typeof import("node:fs");

  /**
   * Find casts applied to a response from our own API.
   *
   * Variable-aware on purpose. A single file may legitimately cast a vendor
   * response AND call our API; a file-level grep would have to flag both or
   * neither, and either answer trains people to ignore it.
   */
  function uncheckedOwnApiCasts(src: string): string[] {
    const hits: string[] = [];
    const FETCH = /(?:const|let)\s+(\w+)\s*=\s*await\s+fetch\(\s*[`"']\/api\//g;
    for (let m = FETCH.exec(src); m; m = FETCH.exec(src)) {
      const v = m[1];
      const window = src.slice(m.index, m.index + 1200);
      if (new RegExp(String.raw`\(await\s+${v}\.json\(\)\)\s+as\s`).test(window)) {
        hits.push(`${v} @ offset ${m.index}`);
      }
    }
    return hits;
  }

  function firstPartyFiles(): string[] {
    return execFileSync("git", ["ls-files", "--", "app", "components", "hooks", "features"], {
      encoding: "utf8",
      maxBuffer: 32e6,
    })
      .split("\n")
      .map((l) => l.trim())
      .filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"));
  }

  it("POSITIVE CONTROL: it catches the exact bug shape", () => {
    // Synthetic, owned by this test. Without it, a detector that matched nothing
    // would make the sweep below vacuous and green forever — the failure mode of
    // every gate in this repo that ever shipped broken.
    expect(
      uncheckedOwnApiCasts('const res = await fetch("/api/x");\nconst d = (await res.json()) as Thing[];'),
    ).toHaveLength(1);
    expect(
      uncheckedOwnApiCasts("const r = await fetch(`/api/y/${id}`);\nconst d = (await r.json()) as T;"),
    ).toHaveLength(1);
  });

  it("NEGATIVE CONTROL: it does not flag the three things that are not the bug", () => {
    // A route parsing its own request body — 33 of these exist, none is a defect.
    expect(uncheckedOwnApiCasts("const body = (await req.json()) as Payload;")).toEqual([]);
    // A vendor response — our envelope contract does not reach Gmail.
    expect(
      uncheckedOwnApiCasts(
        'const res = await fetch("https://gmail.googleapis.com/v1/x");\nconst d = (await res.json()) as G;',
      ),
    ).toEqual([]);
    // A correct call through either helper.
    expect(uncheckedOwnApiCasts('const d = await rawFetch<T>("/api/x");')).toEqual([]);
    expect(uncheckedOwnApiCasts('const d = await apiFetch<T>("/api/x");')).toEqual([]);
  });

  it("DISCRIMINATION CONTROL: two fetches in one file, only ours is flagged", () => {
    const src = [
      'const vendor = await fetch("https://api.exa.ai/search");',
      "const a = (await vendor.json()) as ExaResult;",
      'const mine = await fetch("/api/brain/search-hybrid");',
      "const b = (await mine.json()) as Hits;",
    ].join("\n");
    const hits = uncheckedOwnApiCasts(src);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain("mine");
  });

  /**
   * Three files this session may not edit, because a concurrent session owns
   * the chat / media layer. NOT an exemption on the merits — every one of these
   * is the same shape as the thirteen converted alongside it, and each should
   * go the same way.
   *
   * An exemption list with no expiry is how a gate rots: entries accumulate and
   * nobody removes a stale one, because nothing complains. The test below makes
   * staleness the LOUD case — it asserts each deferral is still NEEDED. The day
   * the owning session converts one of these, that test fails and names the line
   * to delete. The carve-out cannot outlive its reason.
   */
  const DEFERRED = [
    "features/chat-v2/components/chat-island.tsx",
    "hooks/chat/use-audio-transcribe.ts",
    "hooks/use-realtime-voice.ts",
  ];

  it("no first-party file casts a response from our own /api/ route", () => {
    const files = firstPartyFiles();
    expect(files.length, "git ls-files returned nothing — the sweep had no subject").toBeGreaterThan(100);
    const offenders = files
      .filter((f) => !DEFERRED.includes(f))
      .flatMap((f) => {
        const hits = uncheckedOwnApiCasts(readFileSync(f, "utf8"));
        return hits.length ? [`${f} (${hits.length})`] : [];
      });
    expect(
      offenders,
      "these cast a response from our own API. Use apiFetch<T> for an apiHandler-wrapped " +
        "route, or rawFetch<T> for one returning a bare body — rawFetch throws if that " +
        "route ever starts enveloping:\n  " +
        offenders.join("\n  "),
    ).toEqual([]);
  });

  it("REVERSE CANARY: every deferred file is still actually deferred", () => {
    // Fails when a deferral becomes unnecessary — either the file was converted
    // (delete the entry) or it was renamed/removed (delete the entry). Either
    // way the list is wrong and the failure says which entry to remove. Without
    // this, the three below outlive the concurrency that caused them and quietly
    // become three permanently-unchecked files.
    const stale = DEFERRED.filter((f) => {
      try {
        return uncheckedOwnApiCasts(readFileSync(f, "utf8")).length === 0;
      } catch {
        return true; // gone or renamed — the entry is stale either way
      }
    });
    expect(
      stale,
      "these no longer need deferring — remove them from DEFERRED above:\n  " + stale.join("\n  "),
    ).toEqual([]);
  });
});
