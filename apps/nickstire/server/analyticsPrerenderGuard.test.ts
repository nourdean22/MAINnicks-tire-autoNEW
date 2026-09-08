/**
 * The prerender regen must never write to production.
 *
 * WHY (2026-09-08): `.github/workflows/prerender-refresh.yml` boots this server
 * with PRERENDER_MODE=true against the production database (it falls back to
 * DATABASE_URL when no read-only credential is set) and drives every public
 * page through Puppeteer. index.ts skips crons and queues in that mode, but a
 * page load still fires the conversion beacon — so each weekly snapshot run
 * inserted synthetic customer_events rows. The route now returns 204 without
 * touching the DB when PRERENDER_MODE is "true".
 *
 * Shape: the control (unset) proves the write path is reached, the canary
 * (set) proves it is not. Wired through node:http, not a mocked fetch — the
 * serial suite shares one global and a leaked fetch mock has fooled an HTTP
 * wiring test before (spaFallback.test.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

const dbMock = vi.fn(async () => null); // null → "no DB" branch, no insert attempted
vi.mock("./lib/db-helper", () => ({ db: dbMock }));

async function postJson(port: number, path: string, body: unknown): Promise<number> {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path, method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } },
      (res) => { res.resume(); res.on("end", () => resolve(res.statusCode ?? 0)); },
    );
    req.on("error", reject);
    req.end(payload);
  });
}

describe("POST /api/analytics/conversion under PRERENDER_MODE", () => {
  let server: http.Server;
  let port: number;
  const originalMode = process.env.PRERENDER_MODE;

  beforeEach(async () => {
    dbMock.mockClear();
    const { registerAnalyticsRoutes } = await import("./routes/analyticsRoutes");
    const app = express();
    registerAnalyticsRoutes(app);
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    if (originalMode === undefined) delete process.env.PRERENDER_MODE;
    else process.env.PRERENDER_MODE = originalMode;
  });

  it("control: outside prerender mode the beacon reaches the DB layer", async () => {
    delete process.env.PRERENDER_MODE;
    const status = await postJson(port, "/api/analytics/conversion", { type: "cta_click", page: "/" });
    expect(status).toBe(204);
    expect(dbMock).toHaveBeenCalledTimes(1);
  });

  it("canary: with PRERENDER_MODE=true the beacon is accepted but nothing is persisted", async () => {
    process.env.PRERENDER_MODE = "true";
    const status = await postJson(port, "/api/analytics/conversion", { type: "cta_click", page: "/" });
    expect(status).toBe(204);
    expect(dbMock).not.toHaveBeenCalled();
  });

  it("the guard is the literal string \"true\", matching index.ts — \"1\" does not count", async () => {
    process.env.PRERENDER_MODE = "1";
    await postJson(port, "/api/analytics/conversion", { type: "cta_click", page: "/" });
    expect(dbMock).toHaveBeenCalledTimes(1);
  });
});
