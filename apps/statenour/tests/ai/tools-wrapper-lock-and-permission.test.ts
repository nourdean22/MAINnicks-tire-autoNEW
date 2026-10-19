/**
 * tests/ai/tools-wrapper-lock-and-permission.test.ts · 2026-10-10 (audit 07-SN-03)
 *
 * THE DEFECT: every chat tool executes through wrapToolsWithEmptyHandling
 * (lib/ai/tools.ts), and that wrapper ran only sinkPolicyGate + twoKeyGate.
 * evaluateToolAction (tool-policy.ts) holds NICK_MUTATION_LOCK and the
 * critical-risk -> owner rule, but no chat tool goes through it. So with the
 * lock ON, `createTask` still wrote; `runDeviceCommand {command:"unlock"}`
 * queued a DeviceCommand the Tuya agent executes; a Read-permission or
 * Private Lab turn could still run a write if the tool reached the model.
 *
 * Pinned here, each with a positive control so a gate that fires on
 * everything cannot pass:
 *   1. Lock on -> any non-read-safe tool is refused with the lock message;
 *      reads still run; an unreadable lock fails closed; the lock holds even
 *      for an approved re-execution.
 *   2. Critical-risk tools (getToolRiskClass === "critical") wait for the
 *      owner: an ApprovalRequest, never the tool. The approved re-execution
 *      runs once.
 *   3. two-key additions: setInstagramAutopostConfig turning autoposting on,
 *      runDeviceCommand unlock | disarm | raw (case/whitespace-proof).
 *   4. Read-permission and Private Lab turns refuse writes before any
 *      approval row is written; a Draft turn writes.
 *   5. browseAndDo's permission is clamped to the turn's.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => {
  const calls: Array<{ op: string; args: unknown }> = [];
  const handlers: Record<string, (args: any) => unknown> = {};
  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: (_t, method) => {
          if (typeof method !== "string" || method === "then") return undefined;
          return (args: unknown) => {
            const op = `${name}.${method}`;
            calls.push({ op, args });
            const h = handlers[op];
            return Promise.resolve(h ? h(args) : null);
          };
        },
      },
    );
  const prisma = new Proxy(
    {},
    {
      get: (_t, name) => (typeof name === "string" && name !== "then" ? model(name) : undefined),
    },
  );
  return { calls, handlers, prisma };
});
vi.mock("@/lib/prisma", () => ({ prisma: db.prisma }));

const flags = vi.hoisted(() => ({ on: {} as Record<string, boolean>, lockThrows: false }));
vi.mock("@/lib/feature-flags", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/feature-flags")>();
  return {
    ...actual,
    getFlag: (key: string) => {
      if (key === "NICK_MUTATION_LOCK" && flags.lockThrows) throw new Error("flag store down");
      return { isOn: flags.on[key] ?? false };
    },
  };
});

// The turn is set directly: TurnContext has no actionPermission field yet
// (see the task report), so the reader is exercised through currentTurn().
const turnState = vi.hoisted(() => ({ turn: null as Record<string, unknown> | null }));
vi.mock("@/lib/agent/turn-context", () => ({
  currentTurn: () => turnState.turn,
  withTurnContext: (_seed: unknown, fn: () => unknown) => fn(),
  updateTurnContext: () => undefined,
}));

// The catalog has no critical-risk WRITE without a two-key rule today
// (runDeviceCommand has one; runCode/runPython are pure compute), so the
// control for the critical gate is a fixture tool added to the risk lookups.
vi.mock("@/lib/ai/tools/catalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/tools/catalog")>();
  const fake = { name: "fakeCriticalWrite", category: "business_write" as const, sideEffecting: true, riskClass: "critical" as const };
  return {
    ...actual,
    getToolMeta: (name: string) => (name === fake.name ? fake : actual.getToolMeta(name)),
    getToolRiskClass: (name: string, meta?: Parameters<typeof actual.getToolRiskClass>[1]) =>
      name === fake.name ? "critical" : actual.getToolRiskClass(name, meta),
  };
});

const browse = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>> }));
vi.mock("@/lib/ai/browser/browse-and-do", () => ({
  browseAndDo: async (input: Record<string, unknown>) => {
    browse.calls.push(input);
    return { summary: "ok", steps: [] };
  },
}));

import { wrapToolsWithEmptyHandling, nourTools } from "@/lib/ai/tools";
import { metaTools } from "@/lib/ai/tools/meta";
import { guardianBypassStorage } from "@/lib/tools/guardian";
import { isIrreversibleCustomerSend } from "@/lib/tools/two-key";

type Result = { error?: string; reason?: string; requestId?: string | null; reflection?: { tool: string; guidance: string } };
type Exec = { execute: (a: unknown, o?: unknown) => Promise<Result> };

function wrapOne(name: string, execute: (...a: unknown[]) => unknown) {
  return (wrapToolsWithEmptyHandling({ [name]: { execute } } as never) as unknown as Record<string, Exec>)[name];
}
const real = (name: string) => (nourTools as unknown as Record<string, Exec>)[name];
const writes = () =>
  db.calls.filter((c) => /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)$/.test(c.op)).map((c) => c.op);
const approvalRows = () =>
  db.calls.filter((c) => c.op === "approvalRequest.create").map((c) => (c.args as { data: Record<string, unknown> }).data);

beforeEach(() => {
  db.calls.length = 0;
  for (const k of Object.keys(db.handlers)) delete db.handlers[k];
  db.handlers["approvalRequest.findMany"] = () => [];
  db.handlers["approvalRequest.create"] = ({ data }: { data: Record<string, unknown> }) => ({ id: "req_1", ...data });
  db.handlers["smartDevice.findUnique"] = () => ({
    id: "dev_1",
    name: "Front Door Lock",
    platform: "tuya",
    status: "ONLINE",
    location: "home",
    deviceType: "LOCK",
  });
  db.handlers["deviceCommand.create"] = () => ({ id: "cmd_1", status: "pending", createdAt: new Date() });
  flags.on = {};
  flags.lockThrows = false;
  turnState.turn = { conversationId: "c1", untrustedInput: false, privateMode: false, inferredBasisOnly: false };
  browse.calls.length = 0;
});

describe("NICK_MUTATION_LOCK at the nourTools boundary", () => {
  it("lock on: the real createTask is refused with the lock message and writes nothing", async () => {
    flags.on.NICK_MUTATION_LOCK = true;
    const res = await real("createTask").execute({ title: "Call the tire supplier" }, {});
    expect(res.error).toBe("mutation_locked");
    expect(res.reason).toContain("NICK_MUTATION_LOCK");
    expect(res.reason).toContain("createTask");
    expect(res.reflection?.guidance).toMatch(/not (run|performed)/i);
    expect(writes()).toEqual([]);
  });

  it("positive control: lock on, a read tool still runs", async () => {
    flags.on.NICK_MUTATION_LOCK = true;
    const run = vi.fn(async () => ({ steps: 9000 }));
    expect(await wrapOne("getHealthToday", run).execute({}, {})).toEqual({ steps: 9000 });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("positive control: lock off, a write runs", async () => {
    const run = vi.fn(async () => ({ ok: true }));
    await wrapOne("createTask", run).execute({ title: "x" }, {});
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("an unreadable lock fails closed for writes and leaves reads alone", async () => {
    flags.lockThrows = true;
    const write = vi.fn(async () => ({ ok: true }));
    const read = vi.fn(async () => ({ ok: true }));
    const res = await wrapOne("createTask", write).execute({ title: "x" }, {});
    expect(res.error).toBe("mutation_locked");
    expect(res.reason).toMatch(/could not be read/i);
    expect(write).not.toHaveBeenCalled();
    await wrapOne("getHealthToday", read).execute({}, {});
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("the lock holds even for an approved re-execution (guardian bypass)", async () => {
    flags.on.NICK_MUTATION_LOCK = true;
    const run = vi.fn(async () => ({ ok: true }));
    const tool = wrapOne("createTask", run);
    const res = await guardianBypassStorage.run(true, () => tool.execute({ title: "x" }, {}));
    expect(res.error).toBe("mutation_locked");
    expect(run).not.toHaveBeenCalled();
  });

  it("a tool missing from the catalog counts as a write (unknown is not safe)", async () => {
    flags.on.NICK_MUTATION_LOCK = true;
    const run = vi.fn(async () => ({ ok: true }));
    expect((await wrapOne("notInTheCatalog", run).execute({}, {})).error).toBe("mutation_locked");
    expect(run).not.toHaveBeenCalled();
  });
});

describe("critical-risk tools wait for the owner", () => {
  it("runDeviceCommand unlock through the real nourTools: an ApprovalRequest under the device two-key rule, no DeviceCommand row", async () => {
    const res = await real("runDeviceCommand").execute({ deviceId: "dev_1", command: "unlock" }, {});
    expect(res.error).toBe("approval_required");
    expect(res.requestId).toBe("req_1");
    expect(res.reason).toMatch(/unlocks, disarms or sends raw codes/);
    expect(writes()).not.toContain("deviceCommand.create");
    expect(approvalRows()).toHaveLength(1);
    expect(approvalRows()[0]).toMatchObject({
      toolId: "runDeviceCommand",
      status: "pending_approval",
      actionType: "require_owner",
      // The row says how risky the TOOL is, whichever rule held it.
      riskClass: "critical",
    });
    expect(approvalRows()[0].payload).toEqual({ deviceId: "dev_1", command: "unlock" });
  });

  it("a lights command runs: the per-argument two-key rule governs runDeviceCommand, not the blanket critical gate", async () => {
    const res = (await real("runDeviceCommand").execute({ deviceId: "dev_1", command: "turn_on" }, {})) as Result & { success?: boolean };
    expect(res.error).toBeUndefined();
    expect(res.success).toBe(true);
    expect(writes()).toContain("deviceCommand.create");
    expect(approvalRows()).toHaveLength(0);
  });

  it("pure-compute critical tools (runCode, runPython) run in chat with no approval", async () => {
    for (const name of ["runCode", "runPython"]) {
      const run = vi.fn(async () => ({ ok: true }));
      const res = await wrapOne(name, run).execute({ code: "1+1" }, {});
      expect(res, name).toEqual({ ok: true });
      expect(run, name).toHaveBeenCalledTimes(1);
    }
    expect(approvalRows()).toHaveLength(0);
  });

  it("control: a critical-risk side-effecting tool with no two-key rule still waits for the owner", async () => {
    const run = vi.fn(async () => ({ ok: true }));
    const res = await wrapOne("fakeCriticalWrite", run).execute({ amount: 1 }, {});
    expect(res.error).toBe("approval_required");
    expect(res.reason).toMatch(/critical-risk/i);
    expect(run).not.toHaveBeenCalled();
    expect(approvalRows()[0]).toMatchObject({ toolId: "fakeCriticalWrite", riskClass: "critical" });
  });

  it("the approved re-execution is the second key: a critical tool runs once under the bypass", async () => {
    const run = vi.fn(async () => ({ success: true }));
    const tool = wrapOne("runDeviceCommand", run);
    const res = await guardianBypassStorage.run(true, () => tool.execute({ deviceId: "dev_1", command: "unlock" }, {}));
    expect(run).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ success: true });
    expect(approvalRows()).toHaveLength(0);
  });

  it("positive control: a high-risk but not critical write is not held", async () => {
    const run = vi.fn(async () => ({ ok: true }));
    await wrapOne("createTask", run).execute({ title: "x" }, {});
    expect(run).toHaveBeenCalledTimes(1);
    expect(approvalRows()).toHaveLength(0);
  });
});

describe("two-key list additions", () => {
  it("probes: unlock, disarm and raw device commands need the second key in any case or padding", () => {
    for (const command of ["unlock", " UNLOCK ", "Unlock", "unlock\n", "disarm", "DISARM", "raw", "Raw "]) {
      expect(isIrreversibleCustomerSend("runDeviceCommand", { command }), JSON.stringify(command)).toBe(true);
    }
    // A command that is not a string cannot be shown to be safe.
    for (const command of [undefined, null, 42, { verb: "unlock" }]) {
      expect(isIrreversibleCustomerSend("runDeviceCommand", { command }), JSON.stringify(command)).toBe(true);
    }
    // Negative controls: everyday commands are not on the two-key list.
    for (const command of ["turn_on", "turn_off", "lock", "snapshot", "set_temp"]) {
      expect(isIrreversibleCustomerSend("runDeviceCommand", { command }), command).toBe(false);
    }
  });
});

describe("turn permission and Private Lab", () => {
  it("a Read turn refuses a write, says why, and queues nothing", async () => {
    turnState.turn = { ...turnState.turn, actionPermission: "read" };
    const run = vi.fn(async () => ({ ok: true }));
    const res = await wrapOne("createTask", run).execute({ title: "x" }, {});
    expect(res.error).toBe("read_only_turn");
    expect(res.reason).toContain("createTask");
    expect(res.reason).toMatch(/Read permission/);
    expect(run).not.toHaveBeenCalled();
  });

  it("a Read turn refuses a critical write BEFORE any approval row is written", async () => {
    turnState.turn = { ...turnState.turn, actionPermission: "read" };
    const res = await real("runDeviceCommand").execute({ deviceId: "dev_1", command: "unlock" }, {});
    expect(res.error).toBe("read_only_turn");
    expect(approvalRows()).toHaveLength(0);
    expect(writes()).toEqual([]);
  });

  it("positive control: a Read turn still runs a read", async () => {
    turnState.turn = { ...turnState.turn, actionPermission: "read" };
    const run = vi.fn(async () => ({ ok: true }));
    await wrapOne("getHealthToday", run).execute({}, {});
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("a Private Lab turn refuses a write and writes no approval row", async () => {
    turnState.turn = { ...turnState.turn, privateMode: true };
    const run = vi.fn(async () => ({ ok: true }));
    const res = await wrapOne("createTask", run).execute({ title: "x" }, {});
    expect(res.error).toBe("private_turn");
    expect(res.reason).toContain("createTask");
    expect(run).not.toHaveBeenCalled();
    const held = await real("runDeviceCommand").execute({ deviceId: "dev_1", command: "unlock" }, {});
    expect(held.error).toBe("private_turn");
    expect(approvalRows()).toHaveLength(0);
  });

  it("positive control: a Draft turn writes", async () => {
    turnState.turn = { ...turnState.turn, actionPermission: "draft" };
    const run = vi.fn(async () => ({ ok: true }));
    await wrapOne("createTask", run).execute({ title: "x" }, {});
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("browseAndDo permission is clamped to the turn", () => {
  const go = (permission: string) =>
    (metaTools.browseAndDo as unknown as Exec).execute({ goal: "check the hours on example.com", permission }, {});

  it("a Draft turn cannot fire the final action: execute -> draft", async () => {
    turnState.turn = { ...turnState.turn, actionPermission: "draft" };
    await go("execute");
    expect(browse.calls[0].permission).toBe("draft");
  });

  it("a turn with no recorded permission is treated as Draft (fail closed)", async () => {
    await go("execute");
    expect(browse.calls[0].permission).toBe("draft");
  });

  it("a Read turn can only look: draft -> read", async () => {
    turnState.turn = { ...turnState.turn, actionPermission: "read" };
    await go("draft");
    expect(browse.calls[0].permission).toBe("read");
  });

  it("outside a turn (no bypass) execute is clamped to draft", async () => {
    turnState.turn = null;
    await go("execute");
    expect(browse.calls[0].permission).toBe("draft");
  });

  it("positive controls: an Execute turn keeps execute; an approved re-execution keeps its payload", async () => {
    turnState.turn = { ...turnState.turn, actionPermission: "execute" };
    await go("execute");
    expect(browse.calls[0].permission).toBe("execute");

    turnState.turn = null;
    await guardianBypassStorage.run(true, () => go("execute"));
    expect(browse.calls[1].permission).toBe("execute");

    // Never raised: a Draft turn asking for read stays read.
    turnState.turn = { conversationId: "c1", actionPermission: "draft" };
    await go("read");
    expect(browse.calls[2].permission).toBe("read");
  });
});
