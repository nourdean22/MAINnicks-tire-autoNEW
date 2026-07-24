import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * Container-readiness + live-token-health regression tests (Instagram audit
 * wave 3). Pins two fixes in services/metaSocial.ts:
 *
 *  1. postInstagramCarousel published immediately after creating the parent
 *     container — image/story/reel all poll status_code=FINISHED first. The
 *     carousel path must never hit media_publish while Meta is still
 *     processing (or has failed) the container.
 *  2. verifyMetaConnectionLive: presence-only status showed "ready" with a
 *     dead token; the live probe asks the Graph API itself and caches.
 *
 * db-helper is mocked to null (best-effort durable-store paths tolerate it);
 * credentials come from stubbed env vars. Global fetch is stubbed per test
 * and restored in afterEach (singleFork hygiene).
 */
vi.mock("./lib/db-helper", () => ({
  db: async () => null,
  dbTyped: async () => null,
  requireDb: async () => {
    throw new Error("no db in this test");
  },
}));

import {
  pollContainerReady,
  postInstagramCarousel,
  verifyMetaConnectionLive,
  __resetMetaLiveCacheForTests,
} from "./services/metaSocial";

type FetchRoute = (url: string, init?: { body?: string }) => { status?: number; body: unknown } | null;

function stubFetch(route: FetchRoute) {
  const calls: string[] = [];
  const mock = vi.fn(async (url: string, init?: { body?: string }) => {
    calls.push(url);
    const match = route(url, init);
    if (!match) throw new Error(`unrouted fetch in test: ${url}`);
    const status = match.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => match.body,
    };
  });
  vi.stubGlobal("fetch", mock);
  return { mock, calls };
}

beforeEach(() => {
  __resetMetaLiveCacheForTests();
  vi.stubEnv("META_PAGE_ACCESS_TOKEN", "test-token");
  vi.stubEnv("META_IG_USER_ID", "1789");
  vi.stubEnv("META_PAGE_ID", "42");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("pollContainerReady", () => {
  it("returns ready once Meta reports FINISHED, tolerating transient check failures", async () => {
    const statuses = [
      { status: 500, body: null },
      { body: { status_code: "IN_PROGRESS" } },
      { body: { status_code: "FINISHED" } },
    ];
    stubFetch(() => statuses.shift() ?? null);
    const res = await pollContainerReady("cid", "tok", { what: "image", intervalMs: 1 });
    expect(res).toEqual({ ready: true });
  });

  it("fails with the format-specific error when Meta reports ERROR", async () => {
    stubFetch(() => ({ body: { status_code: "ERROR" } }));
    const res = await pollContainerReady("cid", "tok", { what: "carousel", intervalMs: 1 });
    expect(res).toEqual({ ready: false, error: "Meta carousel processing failed (status_code: ERROR)" });
  });

  it("times out instead of looping forever when the container never finishes", async () => {
    stubFetch(() => ({ body: { status_code: "IN_PROGRESS" } }));
    const res = await pollContainerReady("cid", "tok", { what: "image", intervalMs: 1, maxAttempts: 3 });
    expect(res.ready).toBe(false);
    if (!res.ready) expect(res.error).toMatch(/timed out/);
  });
});

describe("postInstagramCarousel container gate", () => {
  function carouselRoute(statusBody: unknown): FetchRoute {
    return (url, init) => {
      if (url.includes("status_code")) return { body: statusBody };
      if (url.includes("media_publish")) return { body: { id: "post-777" } };
      if (url.includes("/media")) {
        const isChild = init?.body?.includes("is_carousel_item");
        return { body: { id: isChild ? "child-1" : "parent-9" } };
      }
      return null;
    };
  }

  it("does NOT call media_publish when the container reports ERROR", async () => {
    const { calls } = stubFetch(carouselRoute({ status_code: "ERROR" }));
    const res = await postInstagramCarousel({
      imageUrls: ["https://cdn.example.com/a.jpg", "https://cdn.example.com/b.jpg"],
      caption: "Two tires, one story.",
    });
    expect(res.success).toBe(false);
    expect(res.error).toBe("Meta carousel processing failed (status_code: ERROR)");
    // The whole point of the gate: Meta said the container is broken, so the
    // publish endpoint must never have been touched.
    expect(calls.some((u) => u.includes("media_publish"))).toBe(false);
  }, 15000);

  it("publishes after the container reports FINISHED", async () => {
    const { calls } = stubFetch(carouselRoute({ status_code: "FINISHED" }));
    const res = await postInstagramCarousel({
      imageUrls: ["https://cdn.example.com/a.jpg", "https://cdn.example.com/b.jpg"],
      caption: "Two tires, one story.",
    });
    expect(res).toEqual({ success: true, postId: "post-777" });
    const statusIdx = calls.findIndex((u) => u.includes("status_code"));
    const publishIdx = calls.findIndex((u) => u.includes("media_publish"));
    expect(statusIdx).toBeGreaterThanOrEqual(0);
    expect(publishIdx).toBeGreaterThan(statusIdx);
  }, 15000);
});

describe("verifyMetaConnectionLive", () => {
  it("reports ok with identities when the Graph accepts the token", async () => {
    stubFetch((url) => {
      if (url.includes("/1789?")) return { body: { id: "1789", username: "nickstire" } };
      if (url.includes("/42?")) return { body: { id: "42", name: "Nick's Tire & Auto" } };
      return null;
    });
    const res = await verifyMetaConnectionLive({ force: true });
    expect(res.ok).toBe(true);
    expect(res.igUsername).toBe("nickstire");
    expect(res.pageName).toBe("Nick's Tire & Auto");
  });

  it("reports NOT ok with the Graph error when the token is dead — presence alone never passes", async () => {
    stubFetch(() => ({
      status: 401,
      body: { error: { message: "Error validating access token: the session has been invalidated" } },
    }));
    const res = await verifyMetaConnectionLive({ force: true });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("session has been invalidated");
  });

  it("serves from cache within the TTL instead of re-hitting the Graph", async () => {
    const { mock } = stubFetch((url) => {
      if (url.includes("/1789?")) return { body: { id: "1789", username: "nickstire" } };
      if (url.includes("/42?")) return { body: { id: "42", name: "Nick's" } };
      return null;
    });
    const first = await verifyMetaConnectionLive({ force: true });
    expect(first.ok).toBe(true);
    const callsAfterFirst = mock.mock.calls.length;

    const second = await verifyMetaConnectionLive();
    expect(second).toEqual(first);
    expect(mock.mock.calls.length).toBe(callsAfterFirst);
  });

  it("reports a TRANSPORT failure as unknown — not as a dead token (Wave 2)", async () => {
    // stubFetch throws for unrouted urls — exactly a network/timeout throw.
    stubFetch(() => null);
    const res = await verifyMetaConnectionLive({ force: true });
    expect(res.ok).toBe(false);
    expect(res.unknown).toBe(true);
    expect(res.error).toContain("Could not reach Meta");
  });

  it("never CACHES a transport failure — the next poll re-asks and can recover (Wave 2)", async () => {
    stubFetch(() => null);
    const blip = await verifyMetaConnectionLive({ force: true });
    expect(blip.unknown).toBe(true);

    // Transport restored; a NON-forced call must re-probe rather than replay
    // the blip for 5 minutes.
    stubFetch((url) => {
      if (url.includes("/1789?")) return { body: { id: "1789", username: "nickstire" } };
      if (url.includes("/42?")) return { body: { id: "42", name: "Nick's" } };
      return null;
    });
    const recovered = await verifyMetaConnectionLive();
    expect(recovered.ok).toBe(true);
    expect(recovered.unknown).toBeUndefined();
  });

  it("a definitive Graph rejection IS cached (unchanged) and carries no unknown flag", async () => {
    stubFetch(() => ({ status: 401, body: { error: { message: "token revoked" } } }));
    const rejected = await verifyMetaConnectionLive({ force: true });
    expect(rejected.ok).toBe(false);
    expect(rejected.unknown).toBeUndefined();

    // Even with transport now healthy, the cached rejection answers.
    const { mock } = stubFetch((url) => {
      if (url.includes("/1789?")) return { body: { id: "1789", username: "nickstire" } };
      return null;
    });
    const cached = await verifyMetaConnectionLive();
    expect(cached.ok).toBe(false);
    expect(mock.mock.calls.length).toBe(0);
  });
});
