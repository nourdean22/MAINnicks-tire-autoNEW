/**
 * tests/ai/run-code-description.test.ts - S9 parked note (2026-10-11).
 *
 * After the S9 sandbox rewrite, runCode wraps the model's code in a function
 * body, so a value comes back only through `return`; a bare last expression
 * yields null. The description and the `code` field said "Returns last
 * expression", which sends the model a contract the runner does not keep.
 * Each case pins the runner fact AND the text, so neither can drift alone.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { metaTools } from "@/lib/ai/tools/meta";
import { computeToolSchemas } from "@/lib/ai/tools/schema-digest";

type Res = { success: boolean; result?: unknown; logs?: string[] };
const run = (code: string) => (metaTools.runCode.execute as (i: unknown, o: unknown) => Promise<Res>)({ code }, {});
const contract = () => JSON.stringify(computeToolSchemas().find((t) => t.name === "runCode"));

describe("runCode's model-facing contract matches its runner", () => {
  it("a bare last expression returns null, and the contract does not promise it", async () => {
    expect(await run("1 + 1")).toMatchObject({ success: true, result: null });
    expect(contract()).not.toMatch(/last expression/i);
  });

  it("`return` brings the value back, and the contract says to use it", async () => {
    expect(await run("return avg([2, 4])")).toMatchObject({ success: true, result: 3 });
    expect(contract()).toMatch(/`return/);
  });

  it("console.log lines come back as logs, and the contract says so", async () => {
    expect((await run("console.log('hi'); return 1")).logs).toEqual(["hi"]);
    expect(contract()).toMatch(/console\.log/);
  });

  it("CONTROL: the contract this test reads is the real runCode entry", () => {
    expect(contract()).toContain("\"name\":\"runCode\"");
  });
});
