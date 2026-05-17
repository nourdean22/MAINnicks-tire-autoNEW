/**
 * Unit tests for safeParseBody + aiRouteError in lib/utils/http.ts.
 *
 * v8.0.1 · 2026-04-29 — extracted from the v7.9 plan-project hotfix
 * and applied to 6 more AI routes. These tests pin the contract so
 * a future refactor doesn't break the alert-spam fix.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

// Note: NextResponse uses fetch globals — vitest's default env supports them.
// Import from http-parse (the auth-free sibling); http.ts re-exports.
import { safeParseBody, aiRouteError } from "@/lib/utils/http-parse";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

function makeReq(body: unknown, contentType = "application/json"): Request {
  return new Request("http://t/x", {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const schema = z.object({
  topic: z.string().min(1),
  depth: z.enum(["quick", "standard"]).default("quick"),
});

// ─────────────────────────────────────────────────────────────────
// safeParseBody
// ─────────────────────────────────────────────────────────────────

describe("safeParseBody", () => {
  it("returns ok:true when input matches schema", async () => {
    const r = await safeParseBody(schema, makeReq({ topic: "tires" }), "test");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.topic).toBe("tires");
      expect(r.data.depth).toBe("quick");
    }
  });

  it("returns ok:false with a 400 Response on missing required field", async () => {
    const r = await safeParseBody(schema, makeReq({}), "test");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.response.status).toBe(400);
      const json = (await r.response.json()) as {
        error: string;
        code: string;
        issues: Array<{ field: string; message: string }>;
      };
      expect(json.code).toBe("INVALID_INPUT");
      expect(json.error).toMatch(/Invalid/i);
      expect(json.issues.length).toBeGreaterThan(0);
      expect(json.issues[0].field).toBe("topic");
    }
  });

  it("returns 400 when body is not JSON (no crash, no 500)", async () => {
    const r = await safeParseBody(
      schema,
      makeReq("not json at all", "application/json"),
      "test",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(400);
  });

  it("logs as console.warn (NOT error) so Vercel email alerts stay quiet", async () => {
    const warn = vi.spyOn(console, "warn");
    const errorSpy = vi.spyOn(console, "error");
    await safeParseBody(schema, makeReq({}), "test-route");
    expect(warn).toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warn.mock.calls[0][0]).toContain("[test-route]");
  });

  it("includes the route name in the warn label", async () => {
    const warn = vi.spyOn(console, "warn");
    await safeParseBody(schema, makeReq({}), "my-special-route");
    expect(warn.mock.calls[0][0]).toBe("[my-special-route] invalid input");
  });

  it("flags root-level errors with field='(root)'", async () => {
    // Schema that rejects at the root (not a known property path).
    const rootSchema = z.string();
    const r = await safeParseBody(rootSchema, makeReq({ not: "a string" }), "test");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const json = (await r.response.json()) as {
        issues: Array<{ field: string }>;
      };
      expect(json.issues[0].field).toBe("(root)");
    }
  });
});

// ─────────────────────────────────────────────────────────────────
// aiRouteError
// ─────────────────────────────────────────────────────────────────

describe("aiRouteError", () => {
  it("turns a ZodError into 502 (downstream AI gave bad shape)", async () => {
    let zodErr: unknown;
    try {
      schema.parse({});
    } catch (e) {
      zodErr = e;
    }
    expect(zodErr).toBeDefined();
    const r = aiRouteError(zodErr, "plan-project", "fallback");
    expect(r.status).toBe(502);
    const j = (await r.json()) as { code: string; error: string };
    expect(j.code).toBe("AI_BAD_SHAPE");
    expect(j.error).toMatch(/retry/i);
  });

  it("turns an issue-bearing object into 502 (parseJson then Zod failure shape)", async () => {
    const r = aiRouteError({ issues: [{ path: [], message: "bad" }] }, "test", "fb");
    expect(r.status).toBe(502);
  });

  it("turns a generic Error into 500 with the message", async () => {
    const r = aiRouteError(new Error("db connection refused"), "test", "fallback");
    expect(r.status).toBe(500);
    const j = (await r.json()) as { error: string };
    expect(j.error).toBe("db connection refused");
  });

  it("uses the fallback message when err is not an Error instance", async () => {
    const r = aiRouteError("just a string somehow", "test", "fallback msg");
    expect(r.status).toBe(500);
    const j = (await r.json()) as { error: string };
    expect(j.error).toBe("fallback msg");
  });

  it("logs server errors as console.error (alert signal stays valid)", async () => {
    const errorSpy = vi.spyOn(console, "error");
    aiRouteError(new Error("real crash"), "test-route", "fb");
    expect(errorSpy).toHaveBeenCalled();
    expect(errorSpy.mock.calls[0][0]).toBe("[test-route]");
  });

  it("logs Zod-shape errors as console.warn (NOT error — no email alert)", async () => {
    const warn = vi.spyOn(console, "warn");
    const errorSpy = vi.spyOn(console, "error");
    let zodErr: unknown;
    try {
      schema.parse({});
    } catch (e) {
      zodErr = e;
    }
    aiRouteError(zodErr, "test", "fb");
    expect(warn).toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
