/**
 * apiHandler telemetry must never take down the request · 2026-08-19.
 *
 * THE BUG THIS PINS (root-caused from the red CI on PR #1697, job `node`,
 * tests/api/today-compound.test.ts):
 *
 *   lib/utils/http.ts logs every request to ApiRequestLog on a SAMPLE —
 *   `duration_ms > 1000 || Math.random() < 0.01`. The write dereferences
 *   `prisma.apiRequestLog` synchronously, and the trailing `.catch()`
 *   only covers the promise that call returns. When the deref itself
 *   threw, the throw landed in apiHandler's own catch block — which
 *   repeated the IDENTICAL deref (http.ts:255) and threw again, this
 *   time with nothing left to catch it. The route rejected instead of
 *   returning its envelope.
 *
 * Two consequences, both real:
 *   · In tests: nine files mock `@/lib/prisma` without `apiRequestLog`,
 *     so every apiHandler call they make was a 1-in-100 CI red. That is
 *     why it was unreproducible and why it moved between files.
 *   · In prod: any throw from the error-path telemetry escapes as an
 *     unhandled rejection instead of the 500 envelope, so the caller
 *     sees the logging failure and never the real one.
 *
 * These tests force the sampler ON (Math.random → 0) and omit both
 * telemetry models from the mock, so they FAIL on the pre-fix code and
 * pass only once the writes are wrapped.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Deliberately INCOMPLETE — no `apiRequestLog`, no `errorLog`. This is
// the exact shape the nine existing route tests use, and the shape the
// handler must survive.
vi.mock("@/lib/prisma", () => ({
  prisma: {},
  resetQueryCount: vi.fn(),
  getQueryCount: vi.fn(() => 0),
}));

import { apiHandler } from "@/lib/utils/http";
import { ServiceError } from "@/lib/utils/service-error";

beforeEach(() => {
  // 0 < 0.01 — the success-path sampler fires on EVERY request, turning
  // the 1% flake into a deterministic assertion.
  vi.spyOn(Math, "random").mockReturnValue(0);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const call = (handler: ReturnType<typeof apiHandler>) =>
  handler(new Request("http://localhost/api/test-telemetry"), {
    params: Promise.resolve({}),
  } as never) as Promise<Response>;

describe("apiHandler telemetry is best-effort, never load-bearing", () => {
  it("returns 200 even when the success-path request log cannot be written", async () => {
    const GET = apiHandler(async () => ({ value: 42 }), { auth: "none" });

    const res = await call(GET);

    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; data?: { value: number } };
    expect(json.ok).toBe(true);
    expect(json.data?.value).toBe(42);
  });

  it("returns the real 500 envelope when the handler throws — not the logger's TypeError", async () => {
    // Pre-fix, this rejected with `Cannot read properties of undefined
    // (reading 'create')` from http.ts's own catch block, burying the
    // actual cause.
    const GET = apiHandler(async () => {
      throw new Error("the real failure");
    }, { auth: "none" });

    const res = await call(GET);

    expect(res.status).toBe(500);
    const json = (await res.json()) as { ok: boolean; error?: string };
    expect(json.ok).toBe(false);
    // The response must describe the handler's failure, not the telemetry's.
    expect(json.error ?? "").not.toContain("create");
  });

  it("preserves a ServiceError's own status through the failing telemetry path", async () => {
    const GET = apiHandler(async () => {
      throw new ServiceError("nope", 403);
    }, { auth: "none" });

    const res = await call(GET);

    expect(res.status).toBe(403);
    const json = (await res.json()) as { ok: boolean; error?: string };
    expect(json.error).toBe("nope");
  });

  it("still returns 200 when the slow-request trigger fires instead of the sampler", async () => {
    // The other half of `shouldLog`: a request measured over 1s always
    // logs, regardless of the coin flip. A loaded CI runner hits this
    // path with no randomness involved at all.
    vi.spyOn(Math, "random").mockReturnValue(1); // sampler OFF
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => {
      const v = now;
      now += 5_000; // every read advances 5s → duration_ms > 1000
      return v;
    });

    const GET = apiHandler(async () => ({ ok: true }), { auth: "none" });

    const res = await call(GET);
    expect(res.status).toBe(200);
  });
});
