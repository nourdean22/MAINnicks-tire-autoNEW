/**
 * Meta / Instagram webhook — signature + routing guards.
 *
 * This endpoint is the only public, unauthenticated surface that can drive the
 * autonomous comment responder, which POSTS PUBLICLY to the shop's Instagram.
 * The signature check is therefore the whole security boundary, and the
 * env-gate check is what stops "subscribe the field in the Meta dashboard" from
 * silently arming replies while REEL_COMMENT_RESPONDER_ENABLED still reads off.
 *
 * Both failure modes are silent in production — a forged request that got
 * through would look like a normal run in the logs. Cheap tests, real teeth.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { verifyMetaSignature, hasCommentChange, metaWebhookRouter, __resetWebhookStateForTests } from "./meta";

const SECRET = "test_app_secret";

function sign(body: string, secret = SECRET): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
}

describe("verifyMetaSignature", () => {
  it("accepts a signature computed with the right secret over the raw bytes", () => {
    const body = JSON.stringify({ object: "instagram", entry: [] });
    expect(verifyMetaSignature(Buffer.from(body), sign(body), SECRET)).toBe(true);
  });

  it("rejects a signature made with a different secret", () => {
    const body = JSON.stringify({ object: "instagram" });
    expect(verifyMetaSignature(Buffer.from(body), sign(body, "wrong_secret"), SECRET)).toBe(false);
  });

  it("rejects when the body was altered after signing", () => {
    const signed = JSON.stringify({ object: "instagram", entry: [] });
    const tampered = JSON.stringify({ object: "instagram", entry: [{ id: "evil" }] });
    expect(verifyMetaSignature(Buffer.from(tampered), sign(signed), SECRET)).toBe(false);
  });

  it("rejects a missing signature, missing body, or missing secret", () => {
    const body = Buffer.from("{}");
    expect(verifyMetaSignature(body, undefined, SECRET)).toBe(false);
    expect(verifyMetaSignature(undefined, sign("{}"), SECRET)).toBe(false);
    expect(verifyMetaSignature(body, sign("{}"), "")).toBe(false);
  });

  it("rejects a non-sha256 algorithm prefix (sha1 is the legacy, weaker header)", () => {
    const body = "{}";
    const sha1 = "sha1=" + crypto.createHmac("sha1", SECRET).update(body).digest("hex");
    expect(verifyMetaSignature(Buffer.from(body), sha1, SECRET)).toBe(false);
  });

  it("rejects a truncated hex digest instead of comparing it against a truncated buffer", () => {
    // Buffer.from(hex) stops at the first invalid pair, so a short forged digest
    // could otherwise byte-compare equal against a shortened computed digest.
    const body = "{}";
    const real = sign(body).slice("sha256=".length);
    expect(verifyMetaSignature(Buffer.from(body), "sha256=" + real.slice(0, 10), SECRET)).toBe(false);
  });

  it("rejects non-hex garbage without throwing", () => {
    expect(() => verifyMetaSignature(Buffer.from("{}"), "sha256=zzzz", SECRET)).not.toThrow();
    expect(verifyMetaSignature(Buffer.from("{}"), "sha256=zzzz", SECRET)).toBe(false);
    expect(verifyMetaSignature(Buffer.from("{}"), "garbage", SECRET)).toBe(false);
  });
});

describe("hasCommentChange", () => {
  it("is true for an instagram comments change", () => {
    expect(
      hasCommentChange({ object: "instagram", entry: [{ changes: [{ field: "comments", value: {} }] }] }),
    ).toBe(true);
  });

  it("ignores other fields multiplexed onto the same callback URL", () => {
    expect(
      hasCommentChange({ object: "instagram", entry: [{ changes: [{ field: "story_insights" }] }] }),
    ).toBe(false);
    expect(hasCommentChange({ object: "instagram", entry: [{ changes: [{ field: "messages" }] }] })).toBe(false);
  });

  it("ignores non-instagram objects (page/whatsapp share the webhook format)", () => {
    expect(hasCommentChange({ object: "page", entry: [{ changes: [{ field: "comments" }] }] })).toBe(false);
  });

  it("survives malformed payloads", () => {
    expect(hasCommentChange(undefined)).toBe(false);
    expect(hasCommentChange({})).toBe(false);
    expect(hasCommentChange({ object: "instagram" })).toBe(false);
    expect(hasCommentChange({ object: "instagram", entry: [] })).toBe(false);
    expect(hasCommentChange({ object: "instagram", entry: [{}] })).toBe(false);
  });
});

// ─── Router behavior ──────────────────────────────────
// Express routers are plain middleware functions, so we can drive them with a
// minimal fake req/res instead of pulling in supertest.

type FakeRes = {
  statusCode: number | null;
  body: string | null;
  contentType: string | null;
  sendStatus: (c: number) => FakeRes;
  type: (t: string) => FakeRes;
  send: (b: string) => FakeRes;
  end: () => void;
};

function makeRes(): FakeRes {
  const res: FakeRes = {
    statusCode: null,
    body: null,
    contentType: null,
    sendStatus(c) { res.statusCode = c; return res; },
    type(t) { res.contentType = t; return res; },
    send(b) { res.body = b; if (res.statusCode === null) res.statusCode = 200; return res; },
    end() { /* express internals */ },
  };
  return res;
}

function makeReq(opts: { method: string; url: string; body?: unknown; rawBody?: Buffer; headers?: Record<string, string> }) {
  const headers = opts.headers ?? {};
  return {
    method: opts.method,
    url: opts.url,
    originalUrl: opts.url,
    baseUrl: "",
    headers,
    body: opts.body,
    rawBody: opts.rawBody,
    get(name: string) { return headers[name.toLowerCase()]; },
  };
}

function dispatch(req: unknown, res: FakeRes): Promise<void> {
  return new Promise((resolve) => {
    (metaWebhookRouter as unknown as (rq: unknown, rs: unknown, nx: () => void) => void)(req, res, () => resolve());
    // Handlers here are synchronous up to the ack; let microtasks flush.
    setImmediate(resolve);
  });
}

describe("POST /instagram", () => {
  const ENV_KEYS = ["FB_APP_SECRET", "FB_VERIFY_TOKEN", "REEL_COMMENT_RESPONDER_ENABLED"] as const;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    __resetWebhookStateForTests();
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    __resetWebhookStateForTests();
    vi.restoreAllMocks();
  });

  it("fails CLOSED with 500 when FB_APP_SECRET is unset (never accept unsigned)", async () => {
    delete process.env.FB_APP_SECRET;
    const body = JSON.stringify({ object: "instagram" });
    const res = makeRes();
    await dispatch(
      makeReq({ method: "POST", url: "/instagram", body: JSON.parse(body), rawBody: Buffer.from(body), headers: { "x-hub-signature-256": sign(body) } }),
      res,
    );
    expect(res.statusCode).toBe(500);
  });

  it("rejects an unsigned request with 403", async () => {
    process.env.FB_APP_SECRET = SECRET;
    const body = JSON.stringify({ object: "instagram" });
    const res = makeRes();
    await dispatch(makeReq({ method: "POST", url: "/instagram", body: JSON.parse(body), rawBody: Buffer.from(body) }), res);
    expect(res.statusCode).toBe(403);
  });

  it("rejects a forged signature with 403", async () => {
    process.env.FB_APP_SECRET = SECRET;
    const body = JSON.stringify({ object: "instagram" });
    const res = makeRes();
    await dispatch(
      makeReq({ method: "POST", url: "/instagram", body: JSON.parse(body), rawBody: Buffer.from(body), headers: { "x-hub-signature-256": sign(body, "attacker") } }),
      res,
    );
    expect(res.statusCode).toBe(403);
  });

  it("acks a correctly signed request with 200", async () => {
    process.env.FB_APP_SECRET = SECRET;
    process.env.REEL_COMMENT_RESPONDER_ENABLED = "false";
    const body = JSON.stringify({ object: "instagram", entry: [{ changes: [{ field: "comments" }] }] });
    const res = makeRes();
    await dispatch(
      makeReq({ method: "POST", url: "/instagram", body: JSON.parse(body), rawBody: Buffer.from(body), headers: { "x-hub-signature-256": sign(body) } }),
      res,
    );
    expect(res.statusCode).toBe(200);
  });
});

describe("GET /instagram (subscription verification)", () => {
  const saved = { FB_VERIFY_TOKEN: process.env.FB_VERIFY_TOKEN };

  afterEach(() => {
    if (saved.FB_VERIFY_TOKEN === undefined) delete process.env.FB_VERIFY_TOKEN;
    else process.env.FB_VERIFY_TOKEN = saved.FB_VERIFY_TOKEN;
  });

  it("echoes hub.challenge verbatim when the verify token matches", async () => {
    process.env.FB_VERIFY_TOKEN = "tok_abc";
    const res = makeRes();
    const req = makeReq({ method: "GET", url: "/instagram?hub.mode=subscribe&hub.verify_token=tok_abc&hub.challenge=12345" });
    (req as unknown as { query: Record<string, string> }).query = {
      "hub.mode": "subscribe", "hub.verify_token": "tok_abc", "hub.challenge": "12345",
    };
    await dispatch(req, res);
    expect(res.body).toBe("12345");
    expect(res.contentType).toBe("text/plain");
  });

  it("rejects a wrong verify token with 403", async () => {
    process.env.FB_VERIFY_TOKEN = "tok_abc";
    const res = makeRes();
    const req = makeReq({ method: "GET", url: "/instagram?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=12345" });
    (req as unknown as { query: Record<string, string> }).query = {
      "hub.mode": "subscribe", "hub.verify_token": "nope", "hub.challenge": "12345",
    };
    await dispatch(req, res);
    expect(res.statusCode).toBe(403);
    expect(res.body).toBeNull();
  });
});
