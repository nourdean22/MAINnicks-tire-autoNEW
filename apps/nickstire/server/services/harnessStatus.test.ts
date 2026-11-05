/** The admin Harness card reads bdnick; every failure must throw, so the card says unknown. Red first. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readHarnessFromBdnick } from "./harnessStatus";

const data = { generatedAt: "2026-11-05T15:00:00.000Z", reporting: 1, pcs: [] };
const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });

describe("readHarnessFromBdnick", () => {
  beforeEach(() => {
    vi.stubEnv("STATENOUR_SYNC_KEY", "sync-key-for-tests");
    vi.stubEnv("STATENOUR_SYNC_URL", "https://bdnick.test");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("asks bdnick for harness_status with the sync key and returns its data", async () => {
    const fetchMock = vi.fn(async () => reply(200, { data, query: "harness_status" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(readHarnessFromBdnick()).resolves.toEqual(data);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://bdnick.test/api/nour-os/query");
    expect((init.headers as Record<string, string>)["x-sync-key"]).toBe("sync-key-for-tests");
    expect(JSON.parse(init.body as string)).toEqual({ query: "harness_status" });
  });

  it("throws on a refused read", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(401, { error: "Unauthorized" })));
    await expect(readHarnessFromBdnick()).rejects.toThrow(/401/);
  });

  it("throws on a reply with no data, never returning an empty picture", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(200, { query: "harness_status" })));
    await expect(readHarnessFromBdnick()).rejects.toThrow(/no data/i);
  });

  it("throws without a key and never calls bdnick", async () => {
    vi.stubEnv("STATENOUR_SYNC_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(readHarnessFromBdnick()).rejects.toThrow(/not configured/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
