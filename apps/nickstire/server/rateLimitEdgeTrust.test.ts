/**
 * Rate-limit keys must not be client-chosen.
 *
 * WHY (2026-09-08): `clientIp()` honoured `cf-connecting-ip` unconditionally.
 * Cloudflare is not in front of production (`server: railway`, no cf-ray), so
 * the header arrived straight from the client — and a fresh value per request
 * was a fresh bucket per request. The form limiter (10/hour) was optional for
 * anyone who sent the header. It is now honoured only under
 * TRUST_CLOUDFLARE_HEADERS=true.
 *
 * Proven through the REAL exported limiter over node:http, both ways:
 *   control  — flag off: 12 requests with 12 different cf-connecting-ip
 *              values share one bucket → a 429 appears;
 *   canary   — flag on: the same 12 requests land in 12 buckets → no 429.
 * (x-real-ip handling is unchanged by this PR and not asserted here.)
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { formLimiter } from "./middleware/rateLimiters";

async function get(port: number, cfIp: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: "/limited", method: "GET", headers: { "cf-connecting-ip": cfIp } },
      (res) => { res.resume(); res.on("end", () => resolve(res.statusCode ?? 0)); },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("cf-connecting-ip and the form limiter", () => {
  let server: http.Server;
  let port: number;
  const original = process.env.TRUST_CLOUDFLARE_HEADERS;

  beforeEach(async () => {
    const app = express();
    app.get("/limited", formLimiter, (_req, res) => res.sendStatus(200));
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    if (original === undefined) delete process.env.TRUST_CLOUDFLARE_HEADERS;
    else process.env.TRUST_CLOUDFLARE_HEADERS = original;
  });

  it("control: with the flag off, rotating the header does NOT buy new buckets", async () => {
    delete process.env.TRUST_CLOUDFLARE_HEADERS;
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push(await get(port, `203.0.113.${i}`)); // TEST-NET-3
    expect(statuses[0]).toBe(200);
    expect(statuses).toContain(429); // 10/hour from one real address
  });

  it("canary: with the flag on (Cloudflare declared as the edge), each header value is its own client", async () => {
    process.env.TRUST_CLOUDFLARE_HEADERS = "true";
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push(await get(port, `198.51.100.${i}`)); // TEST-NET-2
    expect(statuses).toEqual(Array(12).fill(200));
  });
});
