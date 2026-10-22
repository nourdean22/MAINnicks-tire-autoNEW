/**
 * Actions bridge request limits (2026-10-22).
 *
 * POST /api/actions/[tool] parses its own body and hands the arguments to the
 * same zod validation the MCP bridge uses, so it carries the same exposure
 * GHSA-46jr-4wx8-v453 describes: one request under no size limit, or with a
 * huge number of array elements and object keys, can exhaust memory during
 * validation. Bridge auth still applies; these limits are defence in depth and
 * match the MCP route (tests/agent-bridge/mcp-request-limits.test.ts).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/actions/[tool]/route";
import { getBridgeSafeTools } from "@/lib/agent-bridge/tool-adapter";

const TOKEN = "actions-limits-test-token";
const ENV_KEYS = ["AGENT_BRIDGE_ENABLED", "AGENT_BRIDGE_TOKEN_READ"] as const;
const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.AGENT_BRIDGE_ENABLED = "true";
  process.env.AGENT_BRIDGE_TOKEN_READ = TOKEN;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k]!;
  }
});

function call(name: string, body: string) {
  return POST(
    new Request(`https://example.test/api/actions/${name}`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body,
    }),
    { params: Promise.resolve({ tool: name }) },
  );
}

describe("actions bridge request limits", () => {
  const tool = getBridgeSafeTools("actions", "read")[0]!;

  it("answers 413 for a body over 1 MiB", async () => {
    const response = await call(tool.name, JSON.stringify({ pad: "x".repeat(1_100_000) }));
    expect(response.status).toBe(413);
  });

  it("positive control: a 500 KB body is not refused for size", async () => {
    const response = await call(tool.name, JSON.stringify({ pad: "x".repeat(500_000) }));
    expect(response.status).not.toBe(413);
  });

  it("refuses arguments over 10,000 elements with 400, before the tool runs", async () => {
    const response = await call(tool.name, JSON.stringify({ items: new Array(10_001).fill(0) }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/more than the maximum of 10000 elements/);
  });

  it("counts nested object members too, not only top-level arrays", async () => {
    const nested = Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`k${i}`, new Array(99).fill(0)]));
    const response = await call(tool.name, JSON.stringify(nested));
    expect(response.status).toBe(400);
  });

  it("positive control: 100 elements pass both limits", async () => {
    const response = await call(tool.name, JSON.stringify({ items: new Array(100).fill(0) }));
    expect([400, 413]).not.toContain(response.status);
  });
});
