/**
 * Q-18: POST /api/mcp validates `Origin` (Streamable HTTP 2026-07-28,
 * "Security & Endpoint" 1): a present-and-invalid Origin MUST get 403.
 *
 * `createMcpHandler` from @modelcontextprotocol/server is validation-free by
 * design, so before this check any web page could drive the bridge from a
 * browser holding a token. Driven through the exported route handler and the
 * real audit sink (console.log), same shape as mcp-route-rejection-canary.
 *
 * The allowed cases are the positive controls: they prove a 403 below comes
 * from the Origin check, not from a request the endpoint refuses anyway.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "@/app/api/mcp/route";
import { mcpAllowedOriginHostnames } from "@/lib/agent-bridge/mcp-server";

const SECRET = "origin-canary-secret";
const ENV_KEYS = [
  "AGENT_BRIDGE_ENABLED",
  "AGENT_BRIDGE_SECRET_TOKEN",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_SITE_URL",
] as const;
const saved: Record<string, string | undefined> = {};

const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "origin-canary", version: "0.0.0" },
  },
};

function post(headers: Record<string, string>, body: unknown = INITIALIZE) {
  return new Request("https://bdnick.info/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const AUTH = { authorization: `Bearer ${SECRET}` };

function rejectionLines(spy: ReturnType<typeof vi.spyOn>) {
  return spy.mock.calls
    .map((c) => {
      try {
        return JSON.parse(c[0] as string);
      } catch {
        return null;
      }
    })
    .filter((line) => line && line.event === "agent_bridge_rejected");
}

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.AGENT_BRIDGE_ENABLED = "true";
  process.env.AGENT_BRIDGE_SECRET_TOKEN = SECRET;
  process.env.NEXT_PUBLIC_APP_URL = "https://bdnick.info";
  delete process.env.NEXT_PUBLIC_SITE_URL;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k]!;
  }
  vi.restoreAllMocks();
});

describe("POST /api/mcp - Origin validation (Q-18)", () => {
  it("a foreign Origin with a VALID token -> 403, JSON-RPC error with no id, audited", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await POST(post({ ...AUTH, origin: "https://evil.example" }));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBeNull();
    expect(body.result).toBeUndefined();
    expect(body.error?.message).toContain("evil.example");

    const lines = rejectionLines(spy);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ protocol: "mcp", reason: "invalid_origin" });
  });

  it("checks Origin before auth: a foreign Origin with NO token is 403, not 401", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await POST(post({ origin: "https://evil.example" }));
    expect(res.status).toBe(403);
  });

  it("the opaque `null` Origin (sandboxed iframe, file://) -> 403", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await POST(post({ ...AUTH, origin: "null" }));
    expect(res.status).toBe(403);
  });

  it("a look-alike host (suffix match) is refused", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await POST(post({ ...AUTH, origin: "https://bdnick.info.evil.example" }));
    expect(res.status).toBe(403);
  });

  it("a modern server/discover from a foreign Origin is refused too", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const version = "2026-07-28";
    const res = await POST(
      post(
        {
          ...AUTH,
          origin: "https://evil.example",
          "MCP-Protocol-Version": version,
          "Mcp-Method": "server/discover",
        },
        {
          jsonrpc: "2.0",
          id: 2,
          method: "server/discover",
          params: {
            _meta: {
              "io.modelcontextprotocol/protocolVersion": version,
              "io.modelcontextprotocol/clientInfo": { name: "origin-canary", version: "0.0.0" },
              "io.modelcontextprotocol/clientCapabilities": {},
            },
          },
        },
      ),
    );
    expect(res.status).toBe(403);
  });

  it("POSITIVE CONTROL: no Origin (a server-side MCP client) initializes, no rejection line", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await POST(post(AUTH));
    expect(res.status).toBe(200);
    expect(rejectionLines(spy)).toHaveLength(0);
  });

  it("POSITIVE CONTROL: the app's own Origin initializes", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await POST(post({ ...AUTH, origin: "https://bdnick.info" }));
    expect(res.status).toBe(200);
  });

  it("POSITIVE CONTROL: a localhost Origin (MCP Inspector) initializes", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await POST(post({ ...AUTH, origin: "http://localhost:6274" }));
    expect(res.status).toBe(200);
  });

  it.each([
    "https://claude.ai",
    "https://chatgpt.com",
    "https://chat.openai.com",
    "https://perplexity.ai",
    "https://www.perplexity.ai",
  ])(
    "POSITIVE CONTROL: hosted MCP client Origin %s with a valid token initializes",
    async (origin) => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const res = await POST(post({ ...AUTH, origin }));
      expect(res.status).toBe(200);
      expect(rejectionLines(spy)).toHaveLength(0);
    },
  );

  it("a hosted-client look-alike (claude.ai.evil.example) is still refused", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await POST(post({ ...AUTH, origin: "https://claude.ai.evil.example" }));
    expect(res.status).toBe(403);
  });

  it("the allowlist follows NEXT_PUBLIC_APP_URL and always keeps the localhost class", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://staging.example.org";
    const hosts = mcpAllowedOriginHostnames();
    expect(hosts).toContain("staging.example.org");
    expect(hosts).not.toContain("bdnick.info");
    expect(hosts).toEqual(expect.arrayContaining(["localhost", "127.0.0.1", "[::1]"]));
  });
});
