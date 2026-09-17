/**
 * Canaries for the Ollama account census.
 *
 * WHY THIS FILE EXISTS. The probe shipped with only a RUNTIME control — the
 * incumbent check. Review's point stands: a runtime control cannot catch a
 * regression in parsing, status classification or exit behaviour BEFORE an
 * operator acts on the census. It only fires on the day it is already wrong.
 *
 * Two classes of lie this guards:
 *   · a DEAD/ALIVE misclassification, which would retire a live model or
 *     bless a dead one;
 *   · a hang. The provider failure this diagnostic exists to investigate is
 *     precisely "accepts the connection, never responds" — without a bound the
 *     loop never reaches the verdict and a Railway invocation never exits.
 */
import { describe, it, expect, vi } from "vitest";
import {
  runCensus,
  listModels,
  probeLiveness,
  DEFAULT_TIMEOUT_MS,
} from "../../scripts/lib/ollama-census.mjs";
import { formatCensus } from "../../scripts/probe-ollama-account-models.mjs";

const BASE = "https://ollama.test";
const KEY = "unit-test-key";

/** A fetch that answers from a map of url-substring -> {ok,status,json}. */
function fakeFetch(routes: Array<{ match: string; ok: boolean; status: number; body?: unknown }>) {
  return vi.fn(async (url: string) => {
    const hit = routes.find((r) => String(url).includes(r.match));
    if (!hit) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: hit.ok, status: hit.status, json: async () => hit.body ?? {} };
  });
}

const ALIVE_ROUTES = [
  { match: "/api/tags", ok: true, status: 200, body: { models: [{ name: "minimax-m3" }] } },
  { match: "/api/chat", ok: true, status: 200, body: {} },
];

describe("listModels", () => {
  it("parses the /api/tags shape", async () => {
    const r = await listModels({ base: BASE, key: KEY, fetchImpl: fakeFetch(ALIVE_ROUTES) });
    expect(r.path).toBe("/api/tags");
    expect(r.names).toEqual(["minimax-m3"]);
  });

  it("falls through to /v1/models when tags is empty", async () => {
    const r = await listModels({
      base: BASE,
      key: KEY,
      fetchImpl: fakeFetch([
        { match: "/api/tags", ok: true, status: 200, body: { models: [] } },
        { match: "/v1/models", ok: true, status: 200, body: { data: [{ id: "glm-5.3" }] } },
      ]),
    });
    expect(r.path).toBe("/v1/models");
    expect(r.names).toEqual(["glm-5.3"]);
  });

  // ── CANARY ──────────────────────────────────────────────────────────
  // No endpoint answering is UNKNOWN. Returning an empty name list with a
  // non-null path would let the caller print `listed: no` as though it were
  // evidence of absence.
  it("CANARY — no endpoint answering yields path null, not an empty listing", async () => {
    const r = await listModels({
      base: BASE,
      key: KEY,
      fetchImpl: fakeFetch([{ match: "/api", ok: false, status: 500 }]),
    });
    expect(r.path).toBeNull();
    expect(r.names).toEqual([]);
  });
});

describe("probeLiveness", () => {
  it("classifies a served model ALIVE", async () => {
    const r = await probeLiveness({
      base: BASE,
      key: KEY,
      model: "minimax-m3",
      fetchImpl: fakeFetch(ALIVE_ROUTES),
    });
    expect(r.state).toBe("ALIVE");
  });

  it("classifies a refusal status DEAD and keeps the status", async () => {
    const r = await probeLiveness({
      base: BASE,
      key: KEY,
      model: "gone",
      fetchImpl: fakeFetch([{ match: "/api/chat", ok: false, status: 404 }]),
    });
    expect(r.state).toBe("DEAD");
    expect(r.status).toBe(404);
  });

  // ── CANARY ──────────────────────────────────────────────────────────
  // A hang must become ERROR, never DEAD. "It did not answer" is not "it is
  // retired", and conflating them would retire a live model on a bad network.
  it("CANARY — a timeout is ERROR, not DEAD", async () => {
    const hang = vi.fn(
      (_url: string, init: { signal?: AbortSignal }) =>
        new Promise((_res, rej) => {
          init.signal?.addEventListener("abort", () => {
            const e = new Error("timed out");
            e.name = "TimeoutError";
            rej(e);
          });
        }),
    );
    const r = await probeLiveness({
      base: BASE,
      key: KEY,
      model: "hangs",
      fetchImpl: hang as never,
      timeoutMs: 20,
    });
    expect(r.state).toBe("ERROR");
    expect(r.status).toBe("timeout");
  });

  it("CANARY — every request carries an abort signal", async () => {
    const spy = fakeFetch(ALIVE_ROUTES);
    await probeLiveness({ base: BASE, key: KEY, model: "m", fetchImpl: spy });
    const init = spy.mock.calls[0]?.[1] as { signal?: AbortSignal } | undefined;
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("runCensus — the positive control", () => {
  const census = (routes: Parameters<typeof fakeFetch>[0]) =>
    runCensus({
      base: BASE,
      key: KEY,
      incumbents: ["minimax-m3"],
      candidates: ["glm-5.3"],
      fetchImpl: fakeFetch(routes),
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });

  it("a healthy run reports controlOk and lists serveable candidates", async () => {
    const r = await census(ALIVE_ROUTES);
    expect(r.controlOk).toBe(true);
    expect(r.newlyAlive).toEqual(["glm-5.3"]);
  });

  // ── CANARY: THE BROKEN RUN ──────────────────────────────────────────
  // Everything dead means the PROBE is broken, not the catalog. The verdict
  // must refuse the data and say so — a confident "0 serveable" here would be
  // the measured-zero lie.
  it("CANARY — a run where nothing answers refuses to be acted on", async () => {
    const r = await census([{ match: "/api/chat", ok: false, status: 500 }]);
    expect(r.controlOk).toBe(false);
    const text = formatCensus(r, { base: BASE, keyLength: 12 }).join("\n");
    expect(text).toMatch(/ABORT-LEVEL/);
    expect(text).toMatch(/Do NOT act on this run/);
    // and it must NOT print a candidate verdict alongside a failed control
    expect(text).not.toMatch(/candidate\(s\) serveable/);
  });

  it("marks a model listed:'?' when no listing endpoint answered", async () => {
    const r = await census([{ match: "/api/chat", ok: true, status: 200 }]);
    expect(r.rows.every((row) => row.listed === "?")).toBe(true);
  });

  it("never prints the key", async () => {
    const r = await census(ALIVE_ROUTES);
    const text = formatCensus(r, { base: BASE, keyLength: KEY.length }).join("\n");
    expect(text).not.toContain(KEY);
    expect(text).toMatch(/key present \(13 chars, not shown\)/);
  });
});
