/**
 * Q-13 — Instagram control over its own key, one attempt, never retried.
 *
 * Pinned:
 *   1. controlNickIg sends x-ig-control-key = NOUR_OS_IG_CONTROL_KEY to
 *      /api/nour-os/ig-control, and never falls back to STATENOUR_SYNC_KEY.
 *   2. It makes exactly ONE request on a 5xx or a timeout (queryNick retried
 *      both, and each retry started another minutes-long, possibly live, run).
 *   3. A timeout is "outcome unknown", and the live tool HOLDS its duplicate
 *      claim on it instead of releasing it.
 *   4. The two mutating tools use the control route, not the query bridge.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryNickSpy = vi.fn(async () => ({ data: {}, query: "q", timestamp: "t" }));
vi.mock("@/lib/nickstire/query", () => ({
  queryNick: (...args: unknown[]) => queryNickSpy(...(args as [])),
}));

const markers = new Map<string, { expiresAt: Date; content: string }>();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: {
      create: async ({ data }: { data: { category: string; key: string; expiresAt: Date; content: string } }) => {
        const k = `${data.category}:${data.key}`;
        if (markers.has(k)) {
          const err = new Error("Unique constraint failed") as Error & { code: string };
          err.code = "P2002";
          throw err;
        }
        markers.set(k, { expiresAt: data.expiresAt, content: data.content });
        return { id: "m1" };
      },
      findUnique: async ({ where }: { where: { category_key: { category: string; key: string } } }) =>
        markers.get(`${where.category_key.category}:${where.category_key.key}`) ?? null,
      update: async ({ where, data }: { where: { category_key: { category: string; key: string } }; data: { content: string; expiresAt: Date } }) => {
        const k = `${where.category_key.category}:${where.category_key.key}`;
        if (markers.has(k)) markers.set(k, { expiresAt: data.expiresAt, content: data.content });
        return {};
      },
      deleteMany: async ({ where }: { where: { category: string; key: string } }) => ({
        count: markers.delete(`${where.category}:${where.key}`) ? 1 : 0,
      }),
    },
  },
}));

import { controlNickIg } from "@/lib/nickstire/ig-control";
import { socialTools } from "@/lib/ai/tools/social";

type Exec = (a: unknown, b: unknown) => Promise<Record<string, unknown>>;
const fetchSpy = vi.fn();
const ORIG = { control: process.env.NOUR_OS_IG_CONTROL_KEY, sync: process.env.STATENOUR_SYNC_KEY, url: process.env.NICKSTIRE_URL };

function ok(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  markers.clear();
  queryNickSpy.mockClear();
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
  process.env.NOUR_OS_IG_CONTROL_KEY = "ig-control-key";
  process.env.STATENOUR_SYNC_KEY = "sync-key";
  process.env.NICKSTIRE_URL = "https://nick.test";
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const [name, value] of [
    ["NOUR_OS_IG_CONTROL_KEY", ORIG.control],
    ["STATENOUR_SYNC_KEY", ORIG.sync],
    ["NICKSTIRE_URL", ORIG.url],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("controlNickIg", () => {
  it("posts the action with the control key, not the sync key", async () => {
    fetchSpy.mockResolvedValueOnce(ok({ action: "autopost_run", timestamp: "t", data: { status: "dry_run" } }));
    const res = await controlNickIg("autopost_run", { dryRun: true });
    expect(res).toMatchObject({ data: { status: "dry_run" } });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://nick.test/api/nour-os/ig-control");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-ig-control-key"]).toBe("ig-control-key");
    expect(Object.values(headers)).not.toContain("sync-key");
    expect(JSON.parse(String(init.body))).toEqual({ action: "autopost_run", filters: { dryRun: true } });
  });

  it("no control key → error, no request, no sync-key fallback", async () => {
    delete process.env.NOUR_OS_IG_CONTROL_KEY;
    const res = await controlNickIg("autopost_set_config", { enabled: true });
    expect(res).toMatchObject({ error: expect.stringContaining("NOUR_OS_IG_CONTROL_KEY") });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("5xx → exactly one request, reported as a known error", async () => {
    fetchSpy.mockResolvedValue(new Response("boom", { status: 503 }));
    const res = await controlNickIg("autopost_run", { dryRun: false });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ statusCode: 503 });
    expect((res as { outcomeUnknown?: boolean }).outcomeUnknown).toBeUndefined();
  });

  it("timeout → exactly one request, outcome unknown", async () => {
    const timeout = new Error("The operation was aborted due to timeout");
    timeout.name = "TimeoutError";
    fetchSpy.mockRejectedValue(timeout);
    const res = await controlNickIg("autopost_run", { dryRun: false });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ outcomeUnknown: true, error: expect.stringContaining("may still be running") });
  });
});

describe("IG tools use the control route", () => {
  const run = socialTools.triggerInstagramAutopost.execute as unknown as Exec;
  const setConfig = socialTools.setInstagramAutopostConfig.execute as unknown as Exec;

  it("setInstagramAutopostConfig → autopost_set_config on the control route, never queryNick", async () => {
    fetchSpy.mockResolvedValueOnce(ok({ action: "autopost_set_config", timestamp: "t", data: { success: true, livePostingEnabled: false } }));
    await setConfig({ enabled: false }, {});
    expect(queryNickSpy).not.toHaveBeenCalled();
    expect(JSON.parse(String((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body))).toEqual({
      action: "autopost_set_config",
      filters: { enabled: false },
    });
  });

  it("dry run → autopost_run on the control route, never queryNick", async () => {
    fetchSpy.mockResolvedValueOnce(ok({ action: "autopost_run", timestamp: "t", data: {} }));
    await run({ dryRun: true }, {});
    expect(queryNickSpy).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("live run that times out HOLDS the duplicate claim: a second live call does not post", async () => {
    const timeout = new Error("timeout");
    timeout.name = "TimeoutError";
    fetchSpy.mockRejectedValueOnce(timeout);
    const first = await run({ dryRun: false }, {});
    expect(first).toMatchObject({ outcomeUnknown: true });

    fetchSpy.mockResolvedValue(ok({ action: "autopost_run", timestamp: "t", data: { status: "posted" } }));
    const second = await run({ dryRun: false }, {});
    expect(second).toMatchObject({ deduped: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("live run with a known failure RELEASES the claim, so a retry may post", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("nope", { status: 503 }));
    await run({ dryRun: false }, {});
    fetchSpy.mockResolvedValueOnce(ok({ action: "autopost_run", timestamp: "t", data: { status: "posted" } }));
    const second = await run({ dryRun: false }, {});
    expect(second).toMatchObject({ data: { status: "posted" } });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
