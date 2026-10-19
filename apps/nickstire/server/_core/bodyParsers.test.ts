/**
 * The photo routes really accept their 12 MB bodies, and everything else keeps the 2 MB limit and
 * req.rawBody. Real Express over a real socket: the defect was an ORDER bug that no handler-level
 * test can see (the 12 MB parsers were mounted after the global 2 MB one and never ran).
 */
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import path from "node:path";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PHOTO_UPLOAD_ROUTES, registerBodyParsers } from "./bodyParsers";

let base = "";
let server: ReturnType<ReturnType<typeof express>["listen"]>;

beforeAll(async () => {
  const app = express();
  registerBodyParsers(app);
  app.post(/.*/, (req, res) => {
    res.json({ bytes: JSON.stringify(req.body).length, rawBody: Buffer.isBuffer((req as { rawBody?: unknown }).rawBody) });
  });
  app.use((err: { status?: number; type?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err.status ?? 500).json({ error: err.type ?? "error" });
  });
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

// About what a 2.2 MB phone photo becomes as base64 JSON: over the 2 MB default, under 12 MB.
const PHOTO_BODY = JSON.stringify({ "0": { json: { base64: "A".repeat(3_000_000), filename: "front.jpg", mimeType: "image/jpeg" } } });
const post = (p: string, body: string) => fetch(`${base}${p}`, { method: "POST", headers: { "content-type": "application/json" }, body });

describe("registerBodyParsers", () => {
  it.each(PHOTO_UPLOAD_ROUTES.map((r) => [r]))("%s accepts a 3 MB photo body", async (route) => {
    const res = await post(route, PHOTO_BODY);
    expect(res.status).toBe(200);
    expect((await res.json()).bytes).toBe(PHOTO_BODY.length);
  });

  it("every other route still refuses the same body with 413 (control: the default limit is untouched)", async () => {
    const res = await post("/api/trpc/lead.submit", PHOTO_BODY);
    expect(res.status).toBe(413);
  });

  it("a photo route still refuses a body over 12 MB", async () => {
    const res = await post(PHOTO_UPLOAD_ROUTES[0], JSON.stringify({ base64: "A".repeat(13_000_000) }));
    expect(res.status).toBe(413);
  });

  it("a small body on any other route is parsed and keeps req.rawBody for signed webhooks", async () => {
    const res = await post("/api/webhooks/sms-gateway", JSON.stringify({ hello: "world" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ bytes: 17, rawBody: true });
  });
});

describe("the server entrypoint uses it", () => {
  const src = readFileSync(path.join(import.meta.dirname, "index.ts"), "utf8");

  it("index.ts registers the parsers once, before the tRPC middleware", () => {
    const at = src.indexOf("registerBodyParsers(app)");
    expect(at).toBeGreaterThan(0);
    expect(src.indexOf("registerBodyParsers(app)", at + 1)).toBe(-1);
    expect(at).toBeLessThan(src.indexOf('"/api/trpc",'));
  });

  it("index.ts mounts no second JSON parser for the photo routes (one mounted after the default never runs)", () => {
    for (const route of PHOTO_UPLOAD_ROUTES) expect(src).not.toContain(`app.use("${route}"`);
  });
});
