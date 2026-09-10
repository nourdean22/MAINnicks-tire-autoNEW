/**
 * Two rate-limit bypasses, both of which a source assertion cannot catch.
 *
 * 1. `x-real-ip` was read UNGATED, one line below the fix that gated
 *    `cf-connecting-ip`. Rotating it gave a fresh bucket per request, so every
 *    form limiter on the site — job applications, the $300 referral, booking,
 *    payment — was one curl header away from unlimited.
 *
 * 2. `blockBatchedLimits` tested `req.path`. These guards mount with
 *    `app.use(REGEX, ...)`, and inside a mounted handler Express rewrites
 *    req.path to the path RELATIVE to the mount — "/" for a RegExp mount. The
 *    guard has therefore never fired on any request. Worse, it was not applied
 *    to the three form endpoints at all, so ONE batched POST spent a single
 *    unit of the 10/hour budget and performed N inserts.
 *
 * Both are behavioural: the code reads correctly and does the wrong thing.
 * These run REAL express with this app's own mount shape.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import express from "express";
import type { Server } from "node:http";

const ORIGINAL = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL };
});

/** The exact mount pattern server/_core/index.ts uses. */
const withBatchRegex = (endpoint: string) =>
  new RegExp(`^/api/trpc/(.*,)?${endpoint.replace(/\./g, "\\.")}(,.*)?$`);

function listen(app: express.Express): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const srv: Server = app.listen(0, () => {
      const port = (srv.address() as { port: number }).port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => srv.close(() => r())),
      });
    });
  });
}

describe("batch guard fires under a RegExp mount", () => {
  // The fixed guard, verbatim from server/_core/index.ts.
  const blockBatchedLimits = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const path = String(req.originalUrl ?? "").split("?")[0];
    if (path.includes(",")) {
      return res.status(429).json({ error: "Batched requests are not allowed for rate-limited endpoints." });
    }
    next();
  };

  let srv: { url: string; close: () => Promise<void> };
  beforeEach(async () => {
    const app = express();
    app.use(withBatchRegex("candidates.submit"), blockBatchedLimits, (_q, res) => res.status(200).end());
    app.use((_q, res) => res.status(404).end());
    srv = await listen(app);
  });
  afterEach(() => srv.close());

  it("REJECTS a batched call to a form endpoint", async () => {
    const r = await fetch(`${srv.url}/api/trpc/candidates.submit,candidates.submit`, { method: "POST" });
    expect(r.status, "batched POST was accepted — one limiter unit, N inserts").toBe(429);
  });

  it("still ALLOWS a normal single call — the positive control", async () => {
    // Without this, a guard that rejected everything would pass the test above
    // and take the application form down with it.
    const r = await fetch(`${srv.url}/api/trpc/candidates.submit`, { method: "POST" });
    expect(r.status).toBe(200);
  });

  it("a comma in the QUERY STRING is not a batch", async () => {
    const r = await fetch(`${srv.url}/api/trpc/candidates.submit?tags=a,b`, { method: "POST" });
    expect(r.status, "a query-string comma was misread as a tRPC batch").toBe(200);
  });

  it("req.path really is '/' under this mount — the reason the old guard never fired", async () => {
    const app = express();
    let seenPath = "";
    let seenOriginal = "";
    app.use(withBatchRegex("candidates.submit"), (req, res) => {
      seenPath = req.path;
      seenOriginal = req.originalUrl;
      res.status(200).end();
    });
    const s2 = await listen(app);
    try {
      await fetch(`${s2.url}/api/trpc/candidates.submit,candidates.submit`, { method: "POST" });
      // This is the whole defect, measured rather than asserted from docs.
      expect(seenPath).toBe("/");
      expect(seenPath.includes(",")).toBe(false);
      expect(seenOriginal).toContain(",");
    } finally {
      await s2.close();
    }
  });
});

describe("x-real-ip cannot mint a fresh rate-limit bucket", () => {
  // The fixed clientIp, verbatim in shape from server/middleware/rateLimiters.ts.
  const clientIp = (req: express.Request): string => {
    const cloudflareInFront = process.env.TRUST_CLOUDFLARE_HEADERS === "true";
    const edgeSetsRealIp = process.env.TRUST_EDGE_IP_HEADERS === "true";
    let raw =
      (cloudflareInFront ? (req.headers["cf-connecting-ip"] as string) : "") ||
      (edgeSetsRealIp ? (req.headers["x-real-ip"] as string) : "") ||
      req.ip ||
      "unknown";
    if (raw && raw !== "unknown" && raw.includes(",")) raw = raw.split(",")[0].trim();
    return raw;
  };

  const keysFor = (headers: Record<string, string>[], env: Record<string, string> = {}) => {
    process.env = { ...ORIGINAL, ...env };
    return headers.map((h) =>
      clientIp({ headers: h, ip: "203.0.113.9" } as unknown as express.Request),
    );
  };

  it("rotating x-real-ip yields ONE key, not one per request", () => {
    const rotating = Array.from({ length: 14 }, (_v, i) => ({ "x-real-ip": `10.0.0.${i}` }));
    const keys = new Set(keysFor(rotating));
    expect(
      keys.size,
      "each rotated header produced its own bucket — the limiter is optional",
    ).toBe(1);
    expect([...keys][0]).toBe("203.0.113.9");
  });

  it("cf-connecting-ip is equally ignored unless the operator declares Cloudflare", () => {
    const keys = new Set(keysFor([{ "cf-connecting-ip": "10.1.1.1" }, { "cf-connecting-ip": "10.2.2.2" }]));
    expect(keys.size).toBe(1);
  });

  it("an operator CAN still opt in — the positive control", () => {
    // Without this the fix would be indistinguishable from deleting the
    // header support outright, which breaks any deployment whose edge really
    // does set it.
    const keys = keysFor([{ "x-real-ip": "10.0.0.5" }], { TRUST_EDGE_IP_HEADERS: "true" });
    expect(keys[0]).toBe("10.0.0.5");
  });

  it("an UNSET flag never means trust — both default off", () => {
    const k = keysFor([{ "x-real-ip": "10.0.0.5", "cf-connecting-ip": "10.0.0.6" }]);
    expect(k[0]).toBe("203.0.113.9");
  });

  it("comma injection still collapses to the first value when trusted", () => {
    const k = keysFor([{ "x-real-ip": "10.0.0.5, 10.0.0.6" }], { TRUST_EDGE_IP_HEADERS: "true" });
    expect(k[0]).toBe("10.0.0.5");
  });
});
