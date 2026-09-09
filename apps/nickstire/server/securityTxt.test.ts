/**
 * /.well-known/security.txt — RFC 9116 shape, asserted on the SERVED body.
 *
 * The builder and its constants are module-private (the knip orphan gate
 * counts a test-only export as an orphan), so everything here goes through
 * the real registration over node:http with an injected clock.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { registerSecurityTxt } from "./_core/securityTxt";

const WELL_KNOWN = "/.well-known/security.txt";
const NOW = new Date("2026-09-08T14:30:00Z");

describe("security.txt", () => {
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    const app = express();
    registerSecurityTxt(app, { siteUrl: "https://nickstire.org", contactPhoneHref: "tel:+12168620005", now: NOW });
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterEach(async () => { await new Promise<void>((r) => server.close(() => r())); });

  function get(path: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
    return new Promise((resolve, reject) => {
      http.get({ host: "127.0.0.1", port, path }, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => { body += c; });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      }).on("error", reject);
    });
  }

  it("serves the well-known path as cached plain text with the required fields", async () => {
    const r = await get(WELL_KNOWN);
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toBe("text/plain; charset=utf-8");
    expect(r.headers["cache-control"]).toBe("public, max-age=86400");
    const lines = r.body.trimEnd().split("\n");
    expect(lines.filter((l) => l.startsWith("Contact: "))).toEqual([
      "Contact: https://nickstire.org/contact",
      "Contact: tel:+12168620005",
    ]);
    expect(lines.filter((l) => l.startsWith("Expires: "))).toHaveLength(1);
    expect(lines).toContain(`Canonical: https://nickstire.org${WELL_KNOWN}`);
    expect(lines).toContain("Preferred-Languages: en");
    expect(r.body.endsWith("\n")).toBe(true);
    expect(r.body).not.toContain("\r");
  });

  it("Expires is ISO 8601, 180 whole UTC days after the clock it was built with, and under a year (RFC 9116 §2.5.5)", async () => {
    const { body } = await get(WELL_KNOWN);
    const raw = body.split("\n").find((l) => l.startsWith("Expires: "))!.slice("Expires: ".length);
    const expires = new Date(raw);
    expect(Number.isNaN(expires.getTime())).toBe(false);
    expect(raw).toBe("2027-03-07T00:00:00.000Z");
    const days = (expires.getTime() - NOW.getTime()) / 86400000;
    expect(days).toBeGreaterThan(30);
    expect(days).toBeLessThan(365);
  });

  it("301s the legacy top-level path to the well-known one", async () => {
    const r = await get("/security.txt");
    expect(r.status).toBe(301);
    expect(r.headers.location).toBe(WELL_KNOWN);
  });

  it("canary: a different clock moves Expires (the body is built from the injected time, not a constant)", async () => {
    const app = express();
    registerSecurityTxt(app, { siteUrl: "https://nickstire.org", contactPhoneHref: "tel:+12168620005", now: new Date("2026-01-01T00:00:00Z") });
    const s = http.createServer(app);
    await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
    const p = (s.address() as AddressInfo).port;
    try {
      const body = await new Promise<string>((resolve, reject) => {
        http.get({ host: "127.0.0.1", port: p, path: WELL_KNOWN }, (res) => {
          let b = ""; res.setEncoding("utf8"); res.on("data", (c) => { b += c; }); res.on("end", () => resolve(b));
        }).on("error", reject);
      });
      expect(body).toContain("Expires: 2026-06-30T00:00:00.000Z");
    } finally {
      await new Promise<void>((r) => s.close(() => r()));
    }
  });
});

/**
 * THE ASSERTION THAT WAS MISSING.
 *
 * Everything above builds its own `express()` app and registers the route onto it, so
 * it proves the FUNCTION works and says nothing about whether production ever calls it.
 * It did not: `registerSecurityTxt` shipped with its only importer being this file, and
 * nickstire.org served 404 at both paths while this suite was green. The knip orphan
 * gate caught it as a whole unimported file on 2026-09-09; wired the same day.
 *
 * A route tested only against a throwaway app is the producer-without-consumer shape.
 * This asserts the consumer.
 */
describe("security.txt is registered on the REAL server", () => {
  it("is imported and called in the app bootstrap", async () => {
    const { readFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const bootstrap = await readFile(
      path.join(__dirname, "_core", "index.ts"),
      "utf-8",
    );

    expect(
      bootstrap.includes('from "./securityTxt"'),
      "server/_core/index.ts must import registerSecurityTxt",
    ).toBe(true);

    // Called, not merely imported — an unused import is exactly as dead as no import.
    expect(
      /registerSecurityTxt\s*\(\s*app\b/.test(bootstrap),
      "server/_core/index.ts must CALL registerSecurityTxt(app, ...)",
    ).toBe(true);
  });
});
