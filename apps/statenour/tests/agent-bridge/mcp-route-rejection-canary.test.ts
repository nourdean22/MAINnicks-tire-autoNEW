/**
 * Route-level canary for the #1487 rejection-audit wiring in
 * app/api/mcp/route.ts.
 *
 * The sibling suites cover the layers BELOW the route: rejection-audit
 * pins failure classification and mcp-protocol pins the official SDK bridge.
 * This file proves that a refused POST still reaches auditBridgeRejection()
 * before protocol handling, while accepted legacy and modern MCP requests
 * reach the single SDK-backed endpoint.
 *
 * End-to-end on purpose: we drive the exported POST/GET handlers and observe
 * the REAL audit sink (the structured console.log line), not a module mock -
 * a mock would go green even if the route stopped calling the real thing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST, GET } from "@/app/api/mcp/route";

const SECRET = "route-canary-secret";
const ENV_KEYS = ["AGENT_BRIDGE_ENABLED", "AGENT_BRIDGE_SECRET_TOKEN"] as const;
const saved: Record<string, string | undefined> = {};

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://example.test/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function decodeMcpResponse(response: Response) {
  const text = await response.text();
  if (!text) return null;
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    const data = text
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter(Boolean);
    return data.length ? JSON.parse(data[data.length - 1]!) : null;
  }
  return JSON.parse(text);
}

const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "route-canary", version: "0.0.0" },
  },
};

/** Every agent_bridge_rejected line the spied console.log captured. */
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
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k]!;
  }
  vi.restoreAllMocks();
});

describe("POST /api/mcp - rejections leave a trace (route-level, #1487)", () => {
  it("missing Authorization -> 401 AND an audited unauthorized rejection", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await POST(post(INITIALIZE));
    expect(res.status).toBe(401);

    const lines = rejectionLines(spy);
    expect(lines).toHaveLength(1);
    expect(lines[0].protocol).toBe("mcp");
    expect(lines[0].reason).toBe("unauthorized");
  });

  it("wrong bearer token -> 403 AND an audited forbidden rejection", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await POST(post(INITIALIZE, { Authorization: "Bearer wrong-token" }));
    expect(res.status).toBe(403);

    const lines = rejectionLines(spy);
    expect(lines).toHaveLength(1);
    expect(lines[0].reason).toBe("forbidden");
  });

  it("bridge disabled -> 503 AND an audited disabled rejection", async () => {
    delete process.env.AGENT_BRIDGE_ENABLED;
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await POST(post(INITIALIZE, { Authorization: `Bearer ${SECRET}` }));
    expect(res.status).toBe(503);

    const lines = rejectionLines(spy);
    expect(lines).toHaveLength(1);
    expect(lines[0].reason).toBe("disabled");
  });

  it("a correct token initializes normally and emits NO rejection line", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await POST(post(INITIALIZE, { Authorization: `Bearer ${SECRET}` }));
    expect(res.status).toBe(200);

    const body = await decodeMcpResponse(res);
    expect(body.jsonrpc).toBe("2.0");
    expect(body.result?.serverInfo?.name).toBe("statenour-command");
    // The allow-canary: the audit must not fire on accepted calls, or the
    // sink drowns in noise and someone mutes it.
    expect(rejectionLines(spy)).toHaveLength(0);
  });

  it("serves modern server/discover on the same authenticated POST endpoint", async () => {
    const version = "2026-07-28";
    const res = await POST(post(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "server/discover",
        params: {
          _meta: {
            "io.modelcontextprotocol/protocolVersion": version,
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      },
      {
        Authorization: `Bearer ${SECRET}`,
        "MCP-Protocol-Version": version,
        "Mcp-Method": "server/discover",
      },
    ));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result?.supportedVersions).toContain(version);
    expect(body.result?._meta?.["io.modelcontextprotocol/serverInfo"]?.name).toBe("statenour-command");
  });

  it("rejects a modern Mcp-Method/body mismatch", async () => {
    const version = "2026-07-28";
    const res = await POST(post(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/list",
        params: {
          _meta: {
            "io.modelcontextprotocol/protocolVersion": version,
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      },
      {
        Authorization: `Bearer ${SECRET}`,
        "MCP-Protocol-Version": version,
        "Mcp-Method": "tools/call",
      },
    ));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error?.code).toBe(-32020);
  });

  it("GET stays 405 (the surface is POST-only Streamable HTTP)", () => {
    expect(GET().status).toBe(405);
  });
});
