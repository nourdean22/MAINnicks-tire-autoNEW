/**
 * GET /api/admin/events answered 0 x 2xx in 14 days of Railway HTTP logs
 * (2026-10-05..19: 3 x 5xx, 100 other). Cause: the app mounts
 * compression({ threshold: 1024 }) before every route, `text/event-stream`
 * is compressible, and sseHandler neither opted out (Cache-Control
 * no-transform) nor flushed. The ~40-byte "connected" frame and every
 * heartbeat sat in the gzip buffer, so the browser's EventSource never
 * received a byte and the edge logged the request as abandoned, not 200.
 *
 * This mounts the real sseHandler behind the same compression config and
 * asserts the first frame reaches a gzip-accepting client uncompressed.
 */
import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import compression from "compression";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { sseHandler } from "./realtimePush";

const KEY = "test-admin-key";
let server: http.Server | undefined;
const prevKey = process.env.ADMIN_API_KEY;

afterEach(() => {
  server?.closeAllConnections();
  server?.close();
  server = undefined;
  if (prevKey === undefined) delete process.env.ADMIN_API_KEY;
  else process.env.ADMIN_API_KEY = prevKey;
});

function firstChunk(port: number, headers: Record<string, string>) {
  return new Promise<{ status: number; encoding: string | undefined; body: string }>((resolve, reject) => {
    const req = http.get({ port, path: "/api/admin/events", headers }, (res) => {
      res.once("data", (chunk: Buffer) => {
        resolve({ status: res.statusCode ?? 0, encoding: res.headers["content-encoding"], body: chunk.toString("utf8") });
        req.destroy();
      });
    });
    req.on("error", reject);
    setTimeout(() => { req.destroy(); reject(new Error("no bytes within 2s: the stream is buffered")); }, 2000);
  });
}

describe("admin SSE stream under the app's compression middleware", () => {
  it("delivers the connected frame immediately and uncompressed to a gzip-accepting browser", async () => {
    process.env.ADMIN_API_KEY = KEY;
    const app = express();
    app.use(compression({ threshold: 1024 }));
    app.get("/api/admin/events", sseHandler);
    server = app.listen(0);
    const { port } = server.address() as AddressInfo;

    const r = await firstChunk(port, { Authorization: `Bearer ${KEY}`, "Accept-Encoding": "gzip, deflate, br" });
    expect(r.status).toBe(200);
    expect(r.encoding).toBeUndefined();
    expect(r.body).toContain('"type":"connected"');
  });

  it("control: auth still rejects a request with no credentials", async () => {
    process.env.ADMIN_API_KEY = KEY;
    const app = express();
    app.use(compression({ threshold: 1024 }));
    app.get("/api/admin/events", sseHandler);
    server = app.listen(0);
    const { port } = server.address() as AddressInfo;
    const status = await new Promise<number>((resolve, reject) => {
      http.get({ port, path: "/api/admin/events" }, (res) => { resolve(res.statusCode ?? 0); res.resume(); }).on("error", reject);
    });
    expect(status).toBe(401);
  });
});
