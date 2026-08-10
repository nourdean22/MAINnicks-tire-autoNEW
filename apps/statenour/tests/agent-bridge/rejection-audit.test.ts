/**
 * Rejected bridge calls must leave a trace.
 *
 * Both bridge routes (/api/mcp, /api/actions/[tool]) skip apiHandler() from
 * lib/utils/http.ts, and auditBridgeCall() only fires once a tool has matched
 * inside handleToolsCall(). So a call refused by assertBridgeAuth() was
 * invisible in all three sinks at once: no start/done line, no ApiRequestLog
 * row, no agent_bridge_audit.
 *
 * Measured 2026-08-10 rather than reasoned about: a probe that provably
 * reached the handler (HTTP 403 — assertBridgeAuth threw Forbidden) produced
 * ZERO /api/mcp lines in the statenour-web stream while /api/health logged 94
 * times in the same 500-line window.
 *
 * The load-bearing test here is the FIRST one. classifyBridgeFailure() matches
 * on the literal strings assertBridgeAuth() throws, so a reworded auth message
 * would silently return null and send rejections dark again — with every route
 * still returning the right status code, and nothing failing. That coupling is
 * the thing that rots, so it is the thing pinned.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { assertBridgeAuth } from "@/lib/agent-bridge/auth";
import { auditBridgeRejection, classifyBridgeFailure } from "@/lib/agent-bridge/audit";

const SECRET = "test-bridge-secret-value";
const ENV_KEYS = ["AGENT_BRIDGE_ENABLED", "AGENT_BRIDGE_SECRET_TOKEN"] as const;
const saved: Record<string, string | undefined> = {};

function req(headers: Record<string, string> = {}) {
  return new Request("https://example.test/api/mcp", { method: "POST", headers });
}

/** Drive assertBridgeAuth for real and return the message it threw. */
function messageFrom(fn: () => void): string {
  try {
    fn();
  } catch (e: any) {
    return e?.message ?? "";
  }
  throw new Error("expected assertBridgeAuth to throw, but it did not");
}

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k]!;
  }
  vi.restoreAllMocks();
});

describe("agent-bridge · rejection audit", () => {
  it("every message assertBridgeAuth can throw is classifiable", () => {
    // Disabled: the enabled-gate fires before anything else.
    delete process.env.AGENT_BRIDGE_ENABLED;
    expect(classifyBridgeFailure(messageFrom(() => assertBridgeAuth(req())))).toBe("disabled");

    process.env.AGENT_BRIDGE_ENABLED = "true";

    // Missing / malformed Authorization header.
    process.env.AGENT_BRIDGE_SECRET_TOKEN = SECRET;
    expect(classifyBridgeFailure(messageFrom(() => assertBridgeAuth(req())))).toBe("unauthorized");
    expect(
      classifyBridgeFailure(messageFrom(() => assertBridgeAuth(req({ Authorization: "Basic xyz" })))),
    ).toBe("unauthorized");

    // Server misconfigured — secret absent, must fail closed.
    delete process.env.AGENT_BRIDGE_SECRET_TOKEN;
    expect(
      classifyBridgeFailure(messageFrom(() => assertBridgeAuth(req({ Authorization: "Bearer anything" })))),
    ).toBe("misconfigured");

    // Wrong token.
    process.env.AGENT_BRIDGE_SECRET_TOKEN = SECRET;
    expect(
      classifyBridgeFailure(messageFrom(() => assertBridgeAuth(req({ Authorization: "Bearer wrong-token" })))),
    ).toBe("forbidden");
  });

  it("a correct token is not classified as a failure", () => {
    process.env.AGENT_BRIDGE_ENABLED = "true";
    process.env.AGENT_BRIDGE_SECRET_TOKEN = SECRET;
    expect(() => assertBridgeAuth(req({ Authorization: `Bearer ${SECRET}` }))).not.toThrow();
  });

  it("emits an agent_bridge_rejected line carrying protocol + reason", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await auditBridgeRejection({
      protocol: "mcp",
      reason: "forbidden",
      req: req({ "x-forwarded-for": "203.0.113.9, 10.0.0.1", "user-agent": "probe/1.0" }),
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(spy.mock.calls[0][0] as string);
    expect(line.event).toBe("agent_bridge_rejected");
    expect(line.protocol).toBe("mcp");
    expect(line.reason).toBe("forbidden");
    expect(line.method).toBe("POST");
    expect(line.userAgent).toBe("probe/1.0");
    expect(typeof line.timestamp).toBe("string");
  });

  it("never emits the bearer token, and hashes the caller IP", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await auditBridgeRejection({
      protocol: "actions",
      reason: "forbidden",
      req: req({
        Authorization: `Bearer ${SECRET}`,
        "x-forwarded-for": "203.0.113.9",
        "user-agent": "probe/1.0",
      }),
    });

    const raw = spy.mock.calls[0][0] as string;
    // The whole point of the surface is that it guards 177 tools — an audit
    // line that echoes the credential would be worse than no audit line.
    expect(raw).not.toContain(SECRET);
    expect(raw).not.toContain("Bearer");
    // Correlatable across attempts, but not an address at rest.
    expect(raw).not.toContain("203.0.113.9");
    expect(JSON.parse(raw).clientHash).toMatch(/^[0-9a-f]{12}$/);
  });

  it("hashes the same caller to the same value so attempts can be correlated", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    for (let i = 0; i < 2; i++) {
      await auditBridgeRejection({
        protocol: "mcp",
        reason: "forbidden",
        req: req({ "x-forwarded-for": "198.51.100.4" }),
      });
    }
    const [a, b] = spy.mock.calls.map((c) => JSON.parse(c[0] as string).clientHash);
    expect(a).toBe(b);

    // ...and a different caller to a different value.
    await auditBridgeRejection({
      protocol: "mcp",
      reason: "forbidden",
      req: req({ "x-forwarded-for": "198.51.100.5" }),
    });
    const c = JSON.parse(spy.mock.calls[2][0] as string).clientHash;
    expect(c).not.toBe(a);
  });

  it("survives a caller with no forwarding header", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await auditBridgeRejection({ protocol: "mcp", reason: "disabled", req: req() });
    const line = JSON.parse(spy.mock.calls[0][0] as string);
    expect(line.clientHash).toMatch(/^[0-9a-f]{12}$/);
    expect(line.userAgent).toBeNull();
  });
});
