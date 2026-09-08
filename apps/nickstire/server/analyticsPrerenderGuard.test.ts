/**
 * The prerender regen must never write to production.
 *
 * WHY (2026-09-08): `.github/workflows/prerender-refresh.yml` boots this server
 * with PRERENDER_MODE=true against the production database (it falls back to
 * DATABASE_URL when no read-only credential is set) and drives every public
 * page through Puppeteer. index.ts skips crons and queues in that mode, but a
 * page load still fires the public beacons — the conversion sink inserted a
 * synthetic customer_events row per rendered page on every weekly run. The
 * three DB-writing public sinks now return 204 without touching storage when
 * PRERENDER_MODE is "true".
 *
 * Shape, per sink: the control (unset) proves the write path is reached, the
 * canary (set) proves it is not. Wired through node:http, not a mocked fetch —
 * the serial suite shares one global and a leaked fetch mock has fooled an
 * HTTP wiring test before (spaFallback.test.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

const dbMock = vi.fn(async () => null); // null → "no DB" branch, no insert attempted
vi.mock("./lib/db-helper", () => ({ db: dbMock }));
const savePartialFormMock = vi.fn();
vi.mock("./services/abandonedForms", () => ({ savePartialForm: savePartialFormMock }));

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

describe("public analytics sinks under PRERENDER_MODE", () => {
  let server: http.Server;
  let port: number;
  const originalMode = process.env.PRERENDER_MODE;

  beforeEach(async () => {
    dbMock.mockClear();
    savePartialFormMock.mockClear();
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

  describe("POST /api/analytics/conversion (customer_events insert)", () => {
    it("control: outside prerender mode the beacon reaches the DB layer", async () => {
      delete process.env.PRERENDER_MODE;
      expect(await postJson(port, "/api/analytics/conversion", { type: "cta_click", page: "/" })).toBe(204);
      expect(dbMock).toHaveBeenCalledTimes(1);
    });

    it("canary: with PRERENDER_MODE=true the beacon is accepted but nothing is persisted", async () => {
      process.env.PRERENDER_MODE = "true";
      expect(await postJson(port, "/api/analytics/conversion", { type: "cta_click", page: "/" })).toBe(204);
      expect(dbMock).not.toHaveBeenCalled();
    });

    it("the guard is the literal string \"true\", matching index.ts — \"1\" does not count", async () => {
      process.env.PRERENDER_MODE = "1";
      await postJson(port, "/api/analytics/conversion", { type: "cta_click", page: "/" });
      expect(dbMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("POST /api/track-abandoned (abandoned_forms upsert)", () => {
    const beacon = { service: "Brakes", step: 1, formType: "booking" };

    it("control: outside prerender mode a step-1 abandonment is saved", async () => {
      delete process.env.PRERENDER_MODE;
      expect(await postJson(port, "/api/track-abandoned", beacon)).toBe(204);
      expect(savePartialFormMock).toHaveBeenCalledTimes(1);
    });

    it("canary: with PRERENDER_MODE=true nothing is saved", async () => {
      process.env.PRERENDER_MODE = "true";
      expect(await postJson(port, "/api/track-abandoned", beacon)).toBe(204);
      expect(savePartialFormMock).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/uber-code (audit_log insert)", () => {
    it("control: outside prerender mode the code reaches the DB layer", async () => {
      delete process.env.PRERENDER_MODE;
      expect(await postJson(port, "/api/uber-code", { code: "NICK-TEST" })).toBe(204);
      expect(dbMock).toHaveBeenCalledTimes(1);
    });

    it("canary: with PRERENDER_MODE=true nothing is persisted", async () => {
      process.env.PRERENDER_MODE = "true";
      expect(await postJson(port, "/api/uber-code", { code: "NICK-TEST" })).toBe(204);
      expect(dbMock).not.toHaveBeenCalled();
    });
  });
});
