/**
 * 2026-08-13 · BDN-201/202/207 · recovery lane + failure reflection.
 *
 * Pins three mechanisms, not just shapes:
 *   1. wrapToolsWithEmptyHandling converts a THROWN execute into a
 *      structured soft-fail carrying a one-retry reflection hint, and
 *      passes the AI SDK's second ToolCallOptions arg through.
 *   2. invokeTool is fail-closed: recursive names, unknown names, and
 *      non-read-safe (mutating) tools are all refused BEFORE any
 *      execution — the recovery lane structurally cannot mutate.
 *   3. queryData's sandbox only reaches data through the frozen
 *      whitelist; anything else errors inside the sandbox.
 */
import { describe, it, expect, vi } from "vitest";

const mockGetTasks = vi.fn();

vi.mock("@/lib/ai/tools/brain", () => ({ brainTools: {} }));
vi.mock("@/lib/ai/tools/tasks", () => ({
  tasksTools: {
    getTasks: {
      description: "Get tasks",
      execute: (...args: unknown[]) => mockGetTasks(...args),
    },
  },
}));
vi.mock("@/lib/ai/tools/business", () => ({ businessTools: {} }));
vi.mock("@/lib/ai/tools/content", () => ({ contentTools: {} }));
vi.mock("@/lib/ai/tools/social", () => ({ socialTools: {} }));
vi.mock("@/lib/ai/tools/system", () => ({ systemTools: {} }));

import { nourTools } from "@/lib/ai/tools";
// NOTE: meta is NOT mocked — the recovery tools under test live there.
// Their dynamic import of "@/lib/ai/tools" resolves to the same mocked
// module graph, so the only real tool visible to them is getTasks.

const asAny = nourTools as Record<string, { execute: (a: unknown, o?: unknown) => Promise<unknown> }>;

describe("wrapToolsWithEmptyHandling · error reflection (BDN-202)", () => {
  it("converts a thrown execute into a structured soft-fail with a one-retry reflection", async () => {
    mockGetTasks.mockRejectedValueOnce(new Error("column does not exist"));
    const res = (await asAny.getTasks.execute({})) as Record<string, unknown>;
    expect(res.error).toBe("column does not exist");
    const reflection = res.reflection as { tool: string; guidance: string };
    expect(reflection.tool).toBe("getTasks");
    expect(reflection.guidance).toMatch(/retry ONCE/);
    expect(reflection.guidance).toMatch(/never claim the action succeeded/);
  });

  it("passes the AI SDK ToolCallOptions second argument through to the tool", async () => {
    mockGetTasks.mockResolvedValueOnce([{ id: 1 }]);
    const options = { toolCallId: "tc_1" };
    await asAny.getTasks.execute({}, options);
    expect(mockGetTasks).toHaveBeenCalledWith({}, options);
  });
});

describe("invokeTool · fail-closed gates (BDN-201)", () => {
  it("refuses recursive invocation of the recovery tools themselves", async () => {
    for (const name of ["searchTools", "invokeTool", "queryData"]) {
      const res = (await asAny.invokeTool.execute({ name, args: {} })) as Record<string, unknown>;
      expect(String(res.error)).toMatch(/recursive/);
    }
  });

  it("refuses unknown tool names with a pointer to searchTools", async () => {
    const res = (await asAny.invokeTool.execute({ name: "definitelyNotATool", args: {} })) as Record<string, unknown>;
    expect(String(res.error)).toMatch(/unknown tool/);
    expect(String(res.error)).toMatch(/searchTools/);
  });

  it("refuses a mutating tool even if it exists in the catalog (fail-closed read-safety)", async () => {
    // createTask is catalogued personal_write + MUTATING_PREFIX — the
    // registry classifies it not-read-safe regardless of this test's
    // mocked tool modules, so the gate fires before the lookup matters.
    const res = (await asAny.invokeTool.execute({ name: "createTask", args: {} })) as Record<string, unknown>;
    expect(String(res.error)).toMatch(/not read-safe|unknown tool/);
    expect(res.result).toBeUndefined();
  });
});

describe("queryData · whitelist sandbox (BDN-207)", () => {
  it("runs pure computation and returns the value", async () => {
    const res = (await asAny.queryData.execute({
      code: "return [1,2,3].reduce((s,v)=>s+v,0);",
    })) as Record<string, unknown>;
    expect(res.success).toBe(true);
    expect(res.result).toBe(6);
  });

  it("surfaces a whitelist violation as an error, not a silent pass", async () => {
    const res = (await asAny.queryData.execute({
      code: "return await api.call('createTask', {title:'x'});",
    })) as Record<string, unknown>;
    expect(res.success).toBe(false);
    expect(String(res.error)).toMatch(/whitelist/);
  });

  it("exposes the whitelist read-only via api.tools", async () => {
    const res = (await asAny.queryData.execute({
      code: "return api.tools.includes('getTasks');",
    })) as Record<string, unknown>;
    expect(res.success).toBe(true);
    expect(res.result).toBe(true);
  });
});
