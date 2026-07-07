import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { assertBridgeAuth } from "@/lib/agent-bridge/auth";

function reqWithAuth(header?: string): Request {
  return new Request("http://localhost/api/actions/test", {
    headers: header ? { Authorization: header } : {},
  });
}

describe("assertBridgeAuth", () => {
  const ORIG_ENABLED = process.env.AGENT_BRIDGE_ENABLED;
  const ORIG_SECRET = process.env.AGENT_BRIDGE_SECRET_TOKEN;

  beforeEach(() => {
    process.env.AGENT_BRIDGE_ENABLED = "true";
    process.env.AGENT_BRIDGE_SECRET_TOKEN = "test-secret-token-1234";
  });

  afterEach(() => {
    if (ORIG_ENABLED === undefined) delete process.env.AGENT_BRIDGE_ENABLED;
    else process.env.AGENT_BRIDGE_ENABLED = ORIG_ENABLED;
    if (ORIG_SECRET === undefined) delete process.env.AGENT_BRIDGE_SECRET_TOKEN;
    else process.env.AGENT_BRIDGE_SECRET_TOKEN = ORIG_SECRET;
  });

  it("throws when the bridge is disabled", () => {
    process.env.AGENT_BRIDGE_ENABLED = "false";
    expect(() => assertBridgeAuth(reqWithAuth("Bearer test-secret-token-1234"))).toThrow(
      "Agent Bridge is disabled."
    );
  });

  it("throws Unauthorized when the Authorization header is missing", () => {
    expect(() => assertBridgeAuth(reqWithAuth())).toThrow("Unauthorized");
  });

  it("throws Unauthorized for non-Bearer schemes", () => {
    expect(() => assertBridgeAuth(reqWithAuth("Basic abc"))).toThrow("Unauthorized");
  });

  it("fails closed when the server secret is unset", () => {
    delete process.env.AGENT_BRIDGE_SECRET_TOKEN;
    expect(() => assertBridgeAuth(reqWithAuth("Bearer anything"))).toThrow(/Failing closed/);
  });

  it("throws Forbidden on a wrong token", () => {
    expect(() => assertBridgeAuth(reqWithAuth("Bearer wrong-token"))).toThrow("Forbidden");
  });

  it("rejects an empty bearer token", () => {
    // fetch spec trims header values, so "Bearer " arrives as "Bearer" and is
    // rejected at the scheme check; either way it must throw.
    expect(() => assertBridgeAuth(reqWithAuth("Bearer "))).toThrow(/Unauthorized|Forbidden/);
  });

  it("throws Forbidden on a token that is a prefix of the secret (length must not leak)", () => {
    expect(() => assertBridgeAuth(reqWithAuth("Bearer test-secret"))).toThrow("Forbidden");
  });

  it("accepts the correct token", () => {
    expect(() => assertBridgeAuth(reqWithAuth("Bearer test-secret-token-1234"))).not.toThrow();
  });
});
