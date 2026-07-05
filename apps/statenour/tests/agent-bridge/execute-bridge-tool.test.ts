/**
 * Regression · executeBridgeTool validates args against the tool's zod
 * schema BEFORE handler.execute (2026-07-05 read-only audit, P2 CONFIRMED).
 *
 * Both external bridges — the ChatGPT Actions route (app/api/actions/
 * [tool]/route.ts) and the MCP server (lib/agent-bridge/mcp-server.ts) —
 * POST raw JSON that flows through executeBridgeTool. Before this guard it
 * reached handler.execute UNPARSED: zod defaults (e.g. daysBack:
 * z.number().default(7)) never applied, and a missing required field hit
 * the handler as undefined → unbounded reads / DB errors. Auth-gated
 * (assertBridgeAuth) so the blast radius is the operator's own
 * integrations, but a robustness hole regardless.
 */
import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { executeBridgeTool } from "@/lib/agent-bridge/tool-adapter";

function makeTool(schema: unknown, execute: (...a: unknown[]) => unknown) {
  return { name: "test_tool", camelName: "testTool", handler: { parameters: schema, execute } };
}

describe("executeBridgeTool · zod validation before execute", () => {
  it("rejects a missing required field WITHOUT calling execute", async () => {
    const execute = vi.fn(async () => ({ ok: true }));
    const schema = z.object({ query: z.string(), daysBack: z.number().default(7) });
    const res = await executeBridgeTool(makeTool(schema, execute), {}); // missing `query`
    expect(execute).not.toHaveBeenCalled();
    expect(res.error).toBe(true);
    expect(String(res.message)).toMatch(/query/i);
  });

  it("applies zod defaults — an omitted daysBack reaches execute as 7, not undefined", async () => {
    const execute = vi.fn(async (input: unknown) => ({ echo: input }));
    const schema = z.object({ query: z.string(), daysBack: z.number().default(7) });
    await executeBridgeTool(makeTool(schema, execute), { query: "revenue" });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toEqual({ query: "revenue", daysBack: 7 });
  });

  it("passes validated args through and normalizes string output", async () => {
    const execute = vi.fn(async () => "plain text result");
    const schema = z.object({ query: z.string() });
    const res = await executeBridgeTool(makeTool(schema, execute), { query: "x" });
    expect(res).toEqual({ content: "plain text result" });
  });

  it("tools without a zod schema still execute (back-compat, no regression)", async () => {
    const execute = vi.fn(async () => ({ ok: 1 }));
    const tool = { name: "no_schema", handler: { execute } }; // no .parameters
    const res = await executeBridgeTool(tool, { anything: true });
    expect(execute).toHaveBeenCalledWith({ anything: true }, {});
    expect(res).toEqual({ ok: 1 });
  });
});
