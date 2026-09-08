/**
 * /.well-known/security.txt — RFC 9116 shape, and the wiring that serves it.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { buildSecurityTxt, registerSecurityTxt, SECURITY_TXT_PATH } from "./_core/securityTxt";

const opts = { siteUrl: "https://nickstire.org", contactPhoneHref: "tel:+12168620005" };

describe("buildSecurityTxt", () => {
  const now = new Date("2026-09-08T14:30:00Z");
  const body = buildSecurityTxt({ ...opts, now });
  const lines = body.trimEnd().split("\n");

  it("has the required fields: at least one Contact, exactly one Expires", () => {
    expect(lines.filter((l) => l.startsWith("Contact: "))).toEqual([
      "Contact: https://nickstire.org/contact",
      "Contact: tel:+12168620005",
    ]);
    expect(lines.filter((l) => l.startsWith("Expires: "))).toHaveLength(1);
    expect(lines).toContain("Canonical: https://nickstire.org/.well-known/security.txt");
    expect(lines).toContain("Preferred-Languages: en");
  });

  it("Expires is ISO 8601, in the future, and less than a year out (RFC 9116 §2.5.5)", () => {
    const expires = new Date(lines.find((l) => l.startsWith("Expires: "))!.slice("Expires: ".length));
    expect(Number.isNaN(expires.getTime())).toBe(false);
    const days = (expires.getTime() - now.getTime()) / 86400000;
    expect(days).toBeGreaterThan(30);
    expect(days).toBeLessThan(365);
    expect(body).toContain("Expires: 2027-03-07T00:00:00.000Z"); // 180 whole UTC days after Sep 8 2026
  });

  it("ends with a newline and uses no CRLF", () => {
    expect(body.endsWith("\n")).toBe(true);
    expect(body).not.toContain("\r");
  });
});

describe("wiring", () => {
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    const app = express();
    registerSecurityTxt(app, opts);
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

  it("serves the well-known path as cached plain text", async () => {
    const r = await get(SECURITY_TXT_PATH);
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toBe("text/plain; charset=utf-8");
    expect(r.headers["cache-control"]).toBe("public, max-age=86400");
    expect(r.body).toContain("Contact: tel:+12168620005");
  });

  it("301s the legacy top-level path to the well-known one", async () => {
    const r = await get("/security.txt");
    expect(r.status).toBe(301);
    expect(r.headers.location).toBe(SECURITY_TXT_PATH);
  });
});
