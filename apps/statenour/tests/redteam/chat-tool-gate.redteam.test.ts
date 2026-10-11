/**
 * tests/redteam/chat-tool-gate.redteam.test.ts · 2026-10-10
 *
 * Red-team of the chat tool execution gate (wave 1 T4 + T3, PR #2981):
 *   lib/ai/tools.ts            wrapToolsWithEmptyHandling -> authorityGate (lock / Private Lab / Read)
 *   lib/tools/sink-policy.ts   tainted turn -> outward side effect waits for the owner
 *   lib/tools/two-key.ts       runDeviceCommand / Instagram two-key + criticalRiskGate
 *   lib/agent/turn-context.ts  set-only untrustedInput / privateMode
 *   lib/ai/capability-registry.ts isReadSafeTool (the one classifier every layer shares)
 *   lib/ai/tools/meta.ts       invokeTool / queryData recovery lanes
 *   lib/ai/chat/gate.ts        parseChatControls
 *
 * Every probe drives the REAL wrapper with the REAL turn context; only I/O
 * (prisma, flags, provider clients) is mocked, and each mock is a spy so the
 * test asserts whether the side effect was REACHED, not what a regex says.
 *
 * Verdict convention:
 *   - green `it`            : the guard behaves correctly (deny or allow as it should)
 *   - `it.fails`            : a verified bypass / false positive, written as the
 *                             CORRECT behaviour; it passes today because that
 *                             assertion fails. When the fix lands it turns red:
 *                             flip it to a plain `it`.
 *   - "OBSERVED" twin `it`  : pins today's wrong behaviour concretely, so an
 *                             it.fails can never pass on a harness crash.
 *   - "INTENDED" `it`       : a reported defect that verification refuted; the
 *                             test pins the current (correct) behaviour and says why.
 * Fixed defects are plain `it` marked FIXED, each beside a CONTROL that the fix
 * did not over-block (2026-10-10 fix pass; findCustomer/GSC belong to business.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import vm from "node:vm";

// ── I/O mocks (spies) ────────────────────────────────────────────────────

const db = vi.hoisted(() => {
  const calls: Array<{ op: string; args: any }> = [];
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
    { get: (_t, name) => (typeof name === "string" && name !== "then" ? model(name) : undefined) },
  );
  return { calls, handlers, prisma };
});
vi.mock("@/lib/prisma", () => ({ prisma: db.prisma }));

const flags = vi.hoisted(() => ({ on: {} as Record<string, boolean> }));
vi.mock("@/lib/feature-flags", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/feature-flags")>();
  return { ...actual, getFlag: (key: string) => ({ isOn: flags.on[key] ?? false }) };
});

const spies = vi.hoisted(() => ({
  telegramSend: vi.fn(async () => ({ state: "provider_accepted", messageId: 1 })),
  setMit: vi.fn(async () => ({ ok: true })),
  gmailDraft: vi.fn(async () => ({ draftId: "d_1" })),
  boardPersist: vi.fn(async () => ({
    consultation: { boardName: "Strategic", synthesis: { consensus: "c", recommendation: "r", confidence: 0.5 }, takes: [] },
    recordId: "bm_1",
  })),
  calendarCreate: vi.fn(async () => ({ id: "ev_1", htmlLink: "https://calendar.example.invalid/ev_1" })),
  queryNick: vi.fn(async (): Promise<unknown> => ({ error: "unset" })),
}));
vi.mock("@/lib/services/telegram-observed", () => ({ sendTelegramObserved: spies.telegramSend }));
vi.mock("@/lib/ai/tools/tool-idempotency", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/tools/tool-idempotency")>();
  // Pass-through: the inner tool's own dedupe is not the guard under test.
  return { ...actual, withToolIdempotency: async (_k: string, _w: number, fn: () => unknown) => fn() };
});
vi.mock("@/lib/services/mit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/mit")>();
  return { ...actual, setMit: spies.setMit };
});
vi.mock("@/lib/integrations/gmail", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/integrations/gmail")>();
  return { ...actual, isGmailConfigured: () => true, createDraft: spies.gmailDraft };
});
vi.mock("@/lib/services/board-consult-record", () => ({ consultBoardAndPersist: spies.boardPersist }));
vi.mock("@/lib/services/google-oauth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/google-oauth")>();
  return { ...actual, isGoogleOauthConfigured: async () => true };
});
vi.mock("@/lib/services/calendar-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/calendar-api")>();
  return { ...actual, createEvent: spies.calendarCreate };
});
vi.mock("@/lib/nickstire/query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/nickstire/query")>();
  return { ...actual, queryNick: spies.queryNick };
});
vi.mock("@/lib/settings/ai-config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settings/ai-config")>();
  return { ...actual, getAiConfig: async () => ({ ...(actual as any).DEFAULT_AI_CONFIG, disabledTools: [] }) };
});

// ── Mutation switch (positive-control-first, step 5) ─────────────────────
// REDTEAM_MUTATE=sink | twokey | authority neuters ONE real gate; the
// matching positive control below must then go red. Unset = real gates.
const MUTATE = vi.hoisted(() => process.env.REDTEAM_MUTATE ?? "");
vi.mock("@/lib/tools/sink-policy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tools/sink-policy")>();
  return MUTATE === "sink" ? { ...actual, sinkPolicyGate: async () => null } : actual;
});
vi.mock("@/lib/tools/two-key", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tools/two-key")>();
  return MUTATE === "twokey" ? { ...actual, twoKeyGate: async () => null } : actual;
});
vi.mock("@/lib/ai/capability-registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/capability-registry")>();
  return MUTATE === "authority" ? { ...actual, isReadSafeTool: () => true } : actual;
});

// ── Real modules under test ──────────────────────────────────────────────

import { wrapToolsWithEmptyHandling, nourTools, rawTools } from "@/lib/ai/tools";
import { withTurnContext, updateTurnContext, currentTurn } from "@/lib/agent/turn-context";
import { fenceContent } from "@/lib/ai/tool-result-fencing";
import { guardianBypassStorage } from "@/lib/tools/guardian";
import { SINK_POLICY_REASON, isExternalSideEffectTool } from "@/lib/tools/sink-policy";
import { DEVICE_TWO_KEY_REASON, TWO_KEY_REASON, isIrreversibleCustomerSend } from "@/lib/tools/two-key";
import { classifyTool, isReadSafeTool, stripMutatingTools } from "@/lib/ai/capability-registry";
import { getToolCapability } from "@/lib/tools/tool-registry";
import { parseChatControls } from "@/lib/ai/chat/gate";

/**
 * `it.fails` for a verified defect. REDTEAM_SHOW_FAILURES=1 runs them as plain
 * `it` so each one's failure message can be read: an it.fails that fails on a
 * crash instead of the asserted value is a silent instrument.
 */
const itFails = process.env.REDTEAM_SHOW_FAILURES === "1" ? it : it.fails;

type Result = Record<string, any>;
type Exec = { execute: (a: unknown, o?: unknown) => Promise<Result> };

const real = (name: string) => (nourTools as unknown as Record<string, Exec>)[name];
/** Model code that reports the host process when the vm context leaks the host's Function. */
const HOST_PROBE = "return Object.constructor('return typeof process')();";
/** A spy tool behind the REAL wrapper, keyed by a real catalog name. */
function wrapOne(name: string, fn = vi.fn(async () => ({ ok: true }))) {
  const w = wrapToolsWithEmptyHandling({ [name]: { execute: fn } } as never) as unknown as Record<string, Exec>;
  return { tool: w[name], fn };
}
const approvalRows = () =>
  db.calls.filter((c) => c.op === "approvalRequest.create").map((c) => c.args.data as Record<string, unknown>);
/** Taint the turn the way production does: a real external_web fence. */
const taint = () => fenceContent("scrapeWebPage", "external_web", "UNTRUSTED-MARKER page text");
const inTurn = <T>(seed: Parameters<typeof withTurnContext>[0], fn: () => Promise<T>) => withTurnContext(seed, fn);

beforeEach(() => {
  db.calls.length = 0;
  for (const k of Object.keys(db.handlers)) delete db.handlers[k];
  // Stateful approval table so the dedupe lookups see earlier rows.
  const rows: Array<Record<string, any>> = [];
  db.handlers["approvalRequest.create"] = ({ data }) => {
    const row = { id: `req_${rows.length + 1}`, createdAt: new Date(), ...data };
    rows.push(row);
    return row;
  };
  db.handlers["approvalRequest.findMany"] = ({ where }) =>
    rows.filter((r) => r.toolId === where?.toolId && r.status === where?.status && r.reason === where?.reason);
  db.handlers["smartDevice.findUnique"] = () => ({
    id: "dev_1", name: "Front Door Lock", platform: "tuya", status: "ONLINE", location: "home", deviceType: "LOCK",
  });
  db.handlers["deviceCommand.create"] = () => ({ id: "cmd_1", status: "pending", createdAt: new Date() });
  db.handlers["brainMemory.findMany"] = () => [];
  db.handlers["personProfile.findFirst"] = () => null;
  flags.on = {};
  for (const s of Object.values(spies)) s.mockClear();
  spies.queryNick.mockImplementation(async () => ({ error: "unset" }));
});

// ═════════════════════════════════════════════════════════════════════════
// 0 · POSITIVE CONTROLS — the guard must deny, observed denied
// ═════════════════════════════════════════════════════════════════════════
describe("positive controls (real tools, real wrapper)", () => {
  it("tainted turn: real sendTelegram is held for the owner with the sink-policy reason; the provider is never called", async () => {
    const res = await inTurn({}, async () => {
      taint();
      expect(currentTurn()?.untrustedInput).toBe(true);
      return real("sendTelegram").execute({ message: "hello", urgency: "low" });
    });
    expect(res.error).toBe("approval_required");
    expect(res.reason).toBe(SINK_POLICY_REASON);
    expect(spies.telegramSend).not.toHaveBeenCalled();
    expect(approvalRows().map((r) => r.toolId)).toEqual(["sendTelegram"]);
  });

  it("CONTROL · clean owner turn: the same sendTelegram call runs (the gate is not deny-everything)", async () => {
    const res = await inTurn({}, () => real("sendTelegram").execute({ message: "hello", urgency: "low" }));
    expect(res.error).toBeUndefined();
    expect(spies.telegramSend).toHaveBeenCalledTimes(1);
  });

  it("NICK_MUTATION_LOCK on: a catalog write is refused as mutation_locked and its body never runs", async () => {
    flags.on.NICK_MUTATION_LOCK = true;
    const { tool, fn } = wrapOne("createTask");
    const res = await inTurn({}, () => tool.execute({ title: "x" }));
    expect(res.error).toBe("mutation_locked");
    expect(fn).not.toHaveBeenCalled();
  });

  it("runDeviceCommand unlock: held with the device two-key reason; no DeviceCommand row is queued", async () => {
    const res = await inTurn({}, () => real("runDeviceCommand").execute({ deviceId: "dev_1", command: "unlock" }));
    expect(res.error).toBe("approval_required");
    expect(res.reason).toBe(DEVICE_TWO_KEY_REASON);
    expect(db.calls.some((c) => c.op === "deviceCommand.create")).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 1 · TURN CONTEXT · set-only flags, nesting, actionPermission
// ═════════════════════════════════════════════════════════════════════════
describe("turn context stickiness", () => {
  it("untrustedInput:false after a taint cannot clear it; the sink still holds", async () => {
    const { tool, fn } = wrapOne("sendTelegram");
    const res = await inTurn({}, async () => {
      taint();
      updateTurnContext({ untrustedInput: false, conversationId: "c1" });
      return tool.execute({ message: "m" });
    });
    expect(res.error).toBe("approval_required");
    expect(fn).not.toHaveBeenCalled();
  });

  it("privateMode:false after Private Lab cannot clear it; a write is still refused", async () => {
    const { tool, fn } = wrapOne("createTask");
    const res = await inTurn({}, async () => {
      updateTurnContext({ privateMode: true });
      updateTurnContext({ privateMode: false });
      return tool.execute({ title: "x" });
    });
    expect(res.error).toBe("private_turn");
    expect(fn).not.toHaveBeenCalled();
  });

  it("a seeded privateMode turn refuses writes; a seeded read turn refuses writes", async () => {
    const a = wrapOne("createTask");
    expect((await inTurn({ privateMode: true }, () => a.tool.execute({ title: "x" }))).error).toBe("private_turn");
    const b = wrapOne("createTask");
    expect((await inTurn({ actionPermission: "read" }, () => b.tool.execute({ title: "x" }))).error).toBe("read_only_turn");
    expect(a.fn).not.toHaveBeenCalled();
    expect(b.fn).not.toHaveBeenCalled();
  });

  it("CONTROL · a draft turn and a non-chat scope (no turn) let a write through", async () => {
    const a = wrapOne("createTask");
    expect((await inTurn({ actionPermission: "draft" }, () => a.tool.execute({ title: "x" }))).error).toBeUndefined();
    const b = wrapOne("createTask");
    expect((await b.tool.execute({ title: "x" })).error).toBeUndefined();
    expect(a.fn).toHaveBeenCalledTimes(1);
    expect(b.fn).toHaveBeenCalledTimes(1);
  });

  // FIXED (was a P3 latent bypass): actionPermission is one-way, like the sticky flags.
  it("EXPECTED · Read permission can only tighten within a turn (execute / null patches are ignored)", async () => {
    const { tool, fn } = wrapOne("createTask");
    const res = await inTurn({ actionPermission: "read" }, async () => {
      updateTurnContext({ actionPermission: "execute" });
      updateTurnContext({ actionPermission: null });
      return tool.execute({ title: "x" });
    });
    expect(res.error).toBe("read_only_turn");
    expect(fn).not.toHaveBeenCalled();
  });
  it("CONTROL · the route's first publish (null -> any level) and a tightening patch both land", async () => {
    const levels = await inTurn({}, async () => {
      updateTurnContext({ actionPermission: "execute" });
      const first = currentTurn()?.actionPermission;
      updateTurnContext({ actionPermission: "draft" });
      return [first, currentTurn()?.actionPermission];
    });
    expect(levels).toEqual(["execute", "draft"]);
  });

  // FIXED (was a P3 latent bypass): a nested scope inherits instead of starting clean.
  it("EXPECTED · a nested scope inherits the parent's taint / privateMode / read permission", async () => {
    const { tool, fn } = wrapOne("sendTelegram");
    const res = await inTurn({}, async () => {
      taint();
      return withTurnContext({}, () => tool.execute({ message: "m" }));
    });
    expect(res.error).toBe("approval_required");
    expect(fn).not.toHaveBeenCalled();
    const inner = await inTurn({ privateMode: true, actionPermission: "read" }, () =>
      withTurnContext({ actionPermission: "execute" }, async () => currentTurn()),
    );
    expect([inner?.privateMode, inner?.actionPermission]).toEqual([true, "read"]);
  });
  it("CONTROL · a nested scope in a clean turn stays clean (the sink runs), and a stricter seed still tightens", async () => {
    const { tool, fn } = wrapOne("sendTelegram");
    const res = await inTurn({}, () => withTurnContext({}, () => tool.execute({ message: "m" })));
    expect(res.error).toBeUndefined();
    expect(fn).toHaveBeenCalledTimes(1);
    const inner = await inTurn({ actionPermission: "execute" }, () =>
      withTurnContext({ actionPermission: "read" }, async () => currentTurn()?.actionPermission),
    );
    expect(inner).toBe("read");
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 2 · isReadSafeTool MISCLASSIFICATION — a write that every layer calls a read
// ═════════════════════════════════════════════════════════════════════════
describe("read-safe classifier lets writes through every layer", () => {
  // FIXED (was P2): clearMit writes through lib/services/mit setMit(""); the
  // classifier now sees it ('clear' verb prefix). arsenalBoardConsult persists
  // a BrainMemory row; its catalog entry now declares sideEffecting.
  it("classifier verdicts: clearMit and arsenalBoardConsult are NOT read-safe", () => {
    expect(classifyTool("clearMit")).toEqual({ readSafe: false, reason: "mutating_name" });
    expect(classifyTool("arsenalBoardConsult")).toEqual({ readSafe: false, reason: "side_effecting_flag" });
  });

  it("EXPECTED · lock on: clearMit is refused as mutation_locked and setMit is never called", async () => {
    flags.on.NICK_MUTATION_LOCK = true;
    const res = await inTurn({}, () => real("clearMit").execute({}));
    expect(res.error).toBe("mutation_locked");
    expect(spies.setMit).not.toHaveBeenCalled();
  });
  it("EXPECTED · Read turn: clearMit is refused as read_only_turn", async () => {
    const res = await inTurn({ actionPermission: "read" }, () => real("clearMit").execute({}));
    expect(res.error).toBe("read_only_turn");
    expect(spies.setMit).not.toHaveBeenCalled();
  });
  it("EXPECTED · Private Lab: clearMit is refused as private_turn", async () => {
    const res = await inTurn({ privateMode: true }, () => real("clearMit").execute({}));
    expect(res.error).toBe("private_turn");
    expect(spies.setMit).not.toHaveBeenCalled();
  });
  it("CONTROL · a clean draft turn: clearMit still runs and calls setMit('')", async () => {
    const res = await inTurn({ actionPermission: "draft" }, () => real("clearMit").execute({}));
    expect(res.error).toBeUndefined();
    expect(spies.setMit).toHaveBeenCalledWith("");
  });

  it("EXPECTED · invokeTool refuses clearMit (it mutates state)", async () => {
    const res = await inTurn({ actionPermission: "read" }, () =>
      real("invokeTool").execute({ name: "clearMit", args: {} }),
    );
    expect(String(res.error)).toMatch(/not read-safe/);
    expect(spies.setMit).not.toHaveBeenCalled();
  });

  it("EXPECTED · stripMutatingTools (read/private prepare-tools strip AND regen lanes) removes clearMit and arsenalBoardConsult", () => {
    const { tools, stripped } = stripMutatingTools(rawTools as unknown as Record<string, unknown>);
    expect(stripped).toContain("createTask"); // the strip is live
    expect(stripped).toEqual(expect.arrayContaining(["clearMit", "arsenalBoardConsult"]));
    expect("clearMit" in tools).toBe(false);
    expect("arsenalBoardConsult" in tools).toBe(false);
    expect("getTasks" in tools).toBe(true); // control: reads survive
  });

  it("EXPECTED · Private Lab: arsenalBoardConsult (which persists a row) is refused as private_turn", async () => {
    const res = await inTurn({ privateMode: true }, () =>
      real("arsenalBoardConsult").execute({ boardId: "strategic", question: "private question text" }),
    );
    expect(res.error).toBe("private_turn");
    expect(spies.boardPersist).not.toHaveBeenCalled();
  });
  it("EXPECTED · lock on: arsenalBoardConsult is refused as mutation_locked; a clean turn still convenes the board", async () => {
    flags.on.NICK_MUTATION_LOCK = true;
    const locked = await inTurn({}, () =>
      real("arsenalBoardConsult").execute({ boardId: "strategic", question: "question text" }),
    );
    expect(locked.error).toBe("mutation_locked");
    expect(spies.boardPersist).not.toHaveBeenCalled();
    flags.on.NICK_MUTATION_LOCK = false;
    const open = await inTurn({}, () =>
      real("arsenalBoardConsult").execute({ boardId: "strategic", question: "question text" }),
    );
    expect(open.recordId).toBe("bm_1");
    expect(spies.boardPersist).toHaveBeenCalledTimes(1);
  });

  it("CONTROL · a true read (getTasks via invokeTool in a Read turn) still passes the recovery lane", async () => {
    db.handlers["task.findMany"] = () => [];
    const res = await inTurn({ actionPermission: "read" }, () =>
      real("invokeTool").execute({ name: "getTasks", args: {} }),
    );
    expect(res.viaRecoveryLane).toBe(true);
    expect(String(res.error ?? "")).not.toMatch(/not read-safe/);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 3 · SINK LIST · name alias between the catalog and the tool registry
// ═════════════════════════════════════════════════════════════════════════
describe("sink list coverage", () => {
  it("the tool registry (dotted ids) can never name a nourTools key, so the sink list is the catalog flag alone", () => {
    // Why the registry arm was deleted from isExternalSideEffectTool: it could
    // not fire for ANY tool the wrapper gates. A future camelCase registry key
    // turns this red and the arm can be reconsidered.
    expect(getToolCapability("gmail.compose_draft_card")?.externalMutation).toBe(true);
    const named = Object.keys(rawTools).filter((n) => getToolCapability(n) !== null);
    expect(named).toEqual([]);
    expect(isExternalSideEffectTool("composeEmail")).toBe(true);
  });

  // FIXED (was P2): composeEmail creates a real Gmail draft and is now a sink.
  it("EXPECTED · tainted turn: composeEmail (an external Gmail write) waits for the owner", async () => {
    const res = await inTurn({}, async () => {
      taint();
      return real("composeEmail").execute({
        to: "someone@example.invalid", subject: "s", body: "b", tone: "warm",
      });
    });
    expect(res.error).toBe("approval_required");
    expect(spies.gmailDraft).not.toHaveBeenCalled();
  });
  it("CONTROL · clean turn: composeEmail still drafts", async () => {
    const res = await inTurn({}, () =>
      real("composeEmail").execute({ to: "someone@example.invalid", subject: "s", body: "b", tone: "warm" }),
    );
    expect(res.error).toBeUndefined();
    expect(spies.gmailDraft).toHaveBeenCalledTimes(1);
  });

  it("every catalog sideEffecting sink is held in a tainted turn (sendTelegram, proposeCalendarEvent, sendOpportunitySms, stageCustomerAlert, runDeviceCommand)", async () => {
    for (const name of ["sendTelegram", "proposeCalendarEvent", "sendOpportunitySms", "stageCustomerAlert", "runDeviceCommand"]) {
      const { tool, fn } = wrapOne(name);
      const res = await inTurn({}, async () => {
        taint();
        return tool.execute({ command: "turn_on" });
      });
      expect({ name, error: res.error }).toEqual({ name, error: "approval_required" });
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it("CONTROL · a read tool whose NAME mentions a sink (getInstagramAutopostStatus) still runs in a tainted turn", async () => {
    const { tool, fn } = wrapOne("getInstagramAutopostStatus");
    await inTurn({}, async () => {
      taint();
      return tool.execute({});
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  // FIXED (was P3): the sink gate dedupes like two-key.
  it("EXPECTED · a retried sink call in the same tainted turn reuses the pending approval (one row, like two-key)", async () => {
    const { tool } = wrapOne("sendTelegram");
    const ids = await inTurn({}, async () => {
      taint();
      const a = await tool.execute({ message: "same" });
      const b = await tool.execute({ message: "same" });
      return [a.requestId, b.requestId];
    });
    expect(approvalRows()).toHaveLength(1);
    expect(ids).toEqual(["req_1", "req_1"]);
  });
  it("CONTROL · a different payload in the same tainted turn gets its own approval row", async () => {
    const { tool } = wrapOne("sendTelegram");
    await inTurn({}, async () => {
      taint();
      await tool.execute({ message: "one" });
      await tool.execute({ message: "two" });
    });
    expect(approvalRows().map((r) => r.payload)).toEqual([{ message: "one" }, { message: "two" }]);
  });
  it("CONTROL · two-key dedupes the same retried call to one approval row", async () => {
    await inTurn({}, async () => {
      await real("runDeviceCommand").execute({ deviceId: "dev_1", command: "unlock" });
      await real("runDeviceCommand").execute({ deviceId: "dev_1", command: "unlock" });
    });
    expect(approvalRows()).toHaveLength(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 4 · TAINT SOURCES · bridge reads that carry third-party-authored text
// ═════════════════════════════════════════════════════════════════════════
describe("bridge output taints the turn", () => {
  it("CONTROL · queryNickstire fences bridge data (fenceBridgeResult) and taints", async () => {
    spies.queryNick.mockImplementation(async () => ({ data: { text: "UNTRUSTED-MARKER" } }));
    const tainted = await inTurn({}, async () => {
      await real("queryNickstire").execute({ query: "shop_pulse" });
      return currentTurn()?.untrustedInput;
    });
    expect(tainted).toBe(true);
  });

  // FIXED (was P2, 07-SN-02 S2): findCustomer returned customer-entered record
  // fields unfenced; they now sit in an external_doc fence that taints the turn.
  it("EXPECTED · findCustomer's customer record (customer-entered fields) is fenced and taints the turn", async () => {
    spies.queryNick.mockImplementation(async () => ({
      data: {
        customer: {
          fullName: "UNTRUSTED-MARKER name", phone: null, email: null, vehicle: "UNTRUSTED-MARKER vehicle",
          lastVisitDate: null, totalSpend: 0, visitCount: 0, lastService: null, predictedNextService: null,
          ltvBand: null, riskStatus: null, reviewRequested: false, reviewCompleted: false,
        },
        quotes: [],
      },
      query: "customer_search",
      timestamp: "t",
    }));
    const out = await inTurn({}, async () => {
      const r = await real("findCustomer").execute({ nameOrPhone: "x" });
      return { timeline: String(r.timeline), tainted: currentTurn()?.untrustedInput };
    });
    const fence = out.timeline.indexOf('<tool_data tool="findCustomer" source="external_doc">');
    expect(fence).toBeGreaterThanOrEqual(0);
    expect(out.timeline.indexOf("UNTRUSTED-MARKER name")).toBeGreaterThan(fence);
    expect(out.tainted).toBe(true);
  });
  it("CONTROL · the same proposeCalendarEvent after a tainting read IS held", async () => {
    const res = await inTurn({}, async () => {
      taint();
      return real("proposeCalendarEvent").execute({ title: "t", startISO: "2026-10-11T10:00:00-04:00" });
    });
    expect(res.error).toBe("approval_required");
    expect(spies.calendarCreate).not.toHaveBeenCalled();
  });
  // FIXED (was P2): same fix, seen at the sink.
  it("EXPECTED · after findCustomer returns a customer record, an outward sink waits for the owner", async () => {
    spies.queryNick.mockImplementation(async () => ({
      data: { customer: { fullName: "UNTRUSTED-MARKER name", totalSpend: 0, visitCount: 0 }, quotes: [] },
      query: "customer_search",
      timestamp: "t",
    }));
    const res = await inTurn({}, async () => {
      await real("findCustomer").execute({ nameOrPhone: "x" });
      return real("proposeCalendarEvent").execute({ title: "t", startISO: "2026-10-11T10:00:00-04:00" });
    });
    expect(res.error).toBe("approval_required");
    expect(spies.calendarCreate).not.toHaveBeenCalled();
  });

  // FIXED (was P2, S10): getGscTopQueries returned public search-query text
  // unfenced; business.ts now passes it through fenceBridgeResult.
  it("EXPECTED · getGscTopQueries returns search-query text inside an external_doc fence", async () => {
    spies.queryNick.mockImplementation(async () => ({ data: { queries: [{ query: "UNTRUSTED-MARKER", clicks: 1 }] } }));
    const raw = await inTurn({}, async () => JSON.stringify(await real("getGscTopQueries").execute({})));
    expect(raw).toContain('<tool_data tool=\\"getGscTopQueries\\" source=\\"external_doc\\">');
    expect(raw).toContain("UNTRUSTED-MARKER");
  });
  it("EXPECTED · getGscTopQueries (public search-query text) taints the turn", async () => {
    spies.queryNick.mockImplementation(async () => ({ data: { queries: [{ query: "UNTRUSTED-MARKER", clicks: 1 }] } }));
    const tainted = await inTurn({}, async () => {
      await real("getGscTopQueries").execute({});
      return currentTurn()?.untrustedInput;
    });
    expect(tainted).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 5 · RECOVERY LANES · invokeTool / queryData cannot reach a sink or a write
// ═════════════════════════════════════════════════════════════════════════
describe("invokeTool / queryData", () => {
  it("invokeTool refuses sendTelegram (not read-safe) and the provider is never called", async () => {
    const res = await inTurn({}, () => real("invokeTool").execute({ name: "sendTelegram", args: { message: "m" } }));
    expect(String(res.error)).toMatch(/not read-safe/);
    expect(spies.telegramSend).not.toHaveBeenCalled();
  });

  it("invokeTool refuses runDeviceCommand unlock and queues nothing", async () => {
    const res = await inTurn({}, () =>
      real("invokeTool").execute({ name: "runDeviceCommand", args: { deviceId: "dev_1", command: "unlock" } }),
    );
    expect(String(res.error)).toMatch(/not read-safe/);
    expect(db.calls.some((c) => c.op === "deviceCommand.create")).toBe(false);
  });

  it("invokeTool name variants do not resolve to a sink: case, padding, prototype keys, self-recursion", async () => {
    for (const name of ["SendTelegram", "sendTelegram ", " sendTelegram", "sendtelegram", "constructor", "__proto__", "toString"]) {
      const res = await inTurn({}, () => real("invokeTool").execute({ name, args: {} }));
      expect({ name, err: String(res.error) }).toEqual({ name, err: expect.stringMatching(/unknown tool/) });
    }
    for (const name of ["invokeTool", "searchTools"]) {
      const res = await inTurn({}, () => real("invokeTool").execute({ name, args: {} }));
      expect(String(res.error)).toMatch(/recursive/);
    }
    expect(spies.telegramSend).not.toHaveBeenCalled();
  });

  it("queryData's api.call cannot reach sendTelegram (whitelist)", async () => {
    const res = await inTurn({}, () =>
      real("queryData").execute({ code: "return await api.call('sendTelegram', { message: 'm' });" }),
    );
    expect(res.success).toBe(false);
    expect(String(res.error)).toMatch(/not in the read-only whitelist/);
    expect(spies.telegramSend).not.toHaveBeenCalled();
  });

  // FIXED (was P1, S9): queryData is read-safe, so it runs in Read turns, Private
  // Lab, under the lock and in tainted turns. Its node:vm context used to hold the
  // host's Object and host functions (api.call), so Object.constructor was the
  // host Function and model code reached process.env, fetch and
  // process.getBuiltinModule. The context now holds no host value at all (see
  // meta.ts SANDBOX_PRELUDE; every vector is in tests/ai/code-sandbox-escape.test.ts).
  it("CONTROL · the host probe DOES report the host process when a context holds one host value", () => {
    // The pre-S9 runCode shape: the host's Object placed in the context.
    expect(vm.runInContext(`(() => { ${HOST_PROBE} })()`, vm.createContext({ Object }))).toBe("object");
  });
  it("EXPECTED · Read turn + Private Lab + lock on: queryData still runs, and its sandbox cannot reach the host process", async () => {
    flags.on.NICK_MUTATION_LOCK = true;
    const res = await inTurn({ actionPermission: "read", privateMode: true }, () =>
      real("queryData").execute({ code: HOST_PROBE }),
    );
    // Held by the sandbox, not by a gate refusal.
    expect(res.result).toBeUndefined();
    expect(String(res.error)).toMatch(/Code generation from strings disallowed/);
  });

  it("queryNickstire forwards only from/to/term: a bridge send query cannot carry its required fields", async () => {
    spies.queryNick.mockImplementation(async () => ({ error: "opportunityId (uuid) required" }));
    await inTurn({}, () =>
      real("queryNickstire").execute({
        query: "send_opportunity_sms", term: "t",
        opportunityId: "00000000-0000-0000-0000-000000000000", body: "b", idempotencyKey: "k1234567", approvedBy: "x",
      } as never),
    );
    const [query, filters] = spies.queryNick.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(query).toBe("send_opportunity_sms");
    expect(filters).toEqual({ term: "t" });
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 6 · TWO-KEY · runDeviceCommand / Instagram argument variants
// ═════════════════════════════════════════════════════════════════════════
describe("two-key argument variants", () => {
  it("unlock / disarm / raw are held across case and whitespace", async () => {
    for (const command of ["unlock", " UNLOCK ", "Unlock\n", "\tDisarm", "DISARM", "raw", " Raw "]) {
      db.calls.length = 0;
      const res = await inTurn({}, () => real("runDeviceCommand").execute({ deviceId: "dev_1", command }));
      expect({ command, error: res.error }).toEqual({ command, error: "approval_required" });
      expect(db.calls.some((c) => c.op === "deviceCommand.create")).toBe(false);
    }
  });

  it("a command that is not a string is held (fail closed)", () => {
    for (const command of [undefined, null, 1, ["unlock"], { v: "unlock" }]) {
      expect(isIrreversibleCustomerSend("runDeviceCommand", { command })).toBe(true);
    }
    expect(isIrreversibleCustomerSend("runDeviceCommand", null)).toBe(true);
  });

  it("CONTROL · everyday verbs run (lights, lock) and a param that only QUOTES 'unlock' is not held", async () => {
    for (const args of [
      { deviceId: "dev_1", command: "turn_on" },
      { deviceId: "dev_1", command: "lock" },
      { deviceId: "dev_1", command: "speak", params: { text: "remember to unlock the gate later" } },
    ]) {
      db.calls.length = 0;
      const res = await inTurn({}, () => real("runDeviceCommand").execute(args));
      expect({ args, error: res.error }).toEqual({ args, error: undefined });
      expect(db.calls.some((c) => c.op === "deviceCommand.create")).toBe(true);
    }
  });

  it("the owner's approved re-execution (guardian bypass) sends unlock once; the lock still outranks it", async () => {
    const ok = await guardianBypassStorage.run(true, () =>
      inTurn({}, () => real("runDeviceCommand").execute({ deviceId: "dev_1", command: "unlock" })),
    );
    expect(ok.error).toBeUndefined();
    flags.on.NICK_MUTATION_LOCK = true;
    const locked = await guardianBypassStorage.run(true, () =>
      inTurn({}, () => real("runDeviceCommand").execute({ deviceId: "dev_1", command: "unlock" })),
    );
    expect(locked.error).toBe("mutation_locked");
  });

  it("Instagram: autopost ON and a live run are held; only explicit enabled===false / dryRun===true skip", () => {
    for (const enabled of [true, "false", 0, undefined, null]) {
      expect(isIrreversibleCustomerSend("setInstagramAutopostConfig", { enabled })).toBe(true);
    }
    expect(isIrreversibleCustomerSend("setInstagramAutopostConfig", { enabled: false })).toBe(false);
    for (const dryRun of [false, "true", 1, undefined]) {
      expect(isIrreversibleCustomerSend("triggerInstagramAutopost", { dryRun })).toBe(true);
    }
    expect(isIrreversibleCustomerSend("triggerInstagramAutopost", { dryRun: true })).toBe(false);
    expect(TWO_KEY_REASON).toMatch(/two-key/);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 7 · FALSE POSITIVES · reads refused as writes
// ═════════════════════════════════════════════════════════════════════════
describe("false positives at the authority gate", () => {
  it("CONTROL · runCode (critical, pure compute) runs in a clean turn", async () => {
    const res = await inTurn({}, () => real("runCode").execute({ code: "return 2 + 2;" }));
    expect(res.result).toBe(4);
  });

  // REFUTED false positive: the lock refuses runCode by its 'run' name prefix.
  // When this was verified, its node:vm context held the host's Object, so model
  // code reached `process`. S9 made the context host-free (pinned below), so the
  // refusal is now conservative rather than required; exempting runCode from the
  // lock is an operator decision, not a gate fix.
  it("INTENDED · lock on: runCode is refused (the 'run' prefix keeps it out of the read-safe set)", async () => {
    flags.on.NICK_MUTATION_LOCK = true;
    const res = await inTurn({}, () => real("runCode").execute({ code: "return 2 + 2;" }));
    expect(res.error).toBe("mutation_locked");
  });
  // FIXED (was P1, S9): runCode's vm context no longer reaches the host process.
  it("EXPECTED · runCode's vm context cannot reach the host process", async () => {
    const res = await inTurn({}, () => real("runCode").execute({ code: HOST_PROBE }));
    expect(res.result).toBeUndefined();
    expect(String(res.error)).toMatch(/Code generation from strings disallowed/);
  });

  it("OBSERVED · lock refuses the /ask memorySearch read (uncataloged lane tool)", async () => {
    flags.on.NICK_MUTATION_LOCK = true;
    const b = wrapOne("memorySearch");
    expect((await inTurn({}, () => b.tool.execute({ query: "q" }))).error).toBe("mutation_locked");
    expect(b.fn).not.toHaveBeenCalled();
  });
  // FIXED (was P3): the Gmail list/read tools are catalogued as reads (research).
  it("EXPECTED · Read turn: the Gmail inbox READ tool is not refused as a write", async () => {
    const { tool, fn } = wrapOne("arsenalGmailInbox");
    const res = await inTurn({ actionPermission: "read" }, () => tool.execute({}));
    expect(res.error).toBeUndefined();
    expect(fn).toHaveBeenCalledTimes(1);
    const t = wrapOne("arsenalGmailReadThread");
    expect((await inTurn({ actionPermission: "read" }, () => t.tool.execute({ threadId: "x" }))).error).toBeUndefined();
    expect(t.fn).toHaveBeenCalledTimes(1);
  });

  itFails("EXPECTED · lock on: the Telegram /ask lane's memorySearch (an uncataloged READ) is not refused", async () => {
    flags.on.NICK_MUTATION_LOCK = true;
    const { tool, fn } = wrapOne("memorySearch");
    const res = await inTurn({}, () => tool.execute({ query: "q" }));
    expect(res.error).toBeUndefined();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("OBSERVED · the read-gate verdicts behind those refusals", () => {
    expect(classifyTool("runCode").reason).toBe("mutating_name");
    expect(classifyTool("arsenalGmailInbox").reason).toBe("read_safe");
    expect(classifyTool("arsenalGmailReadThread").reason).toBe("read_safe");
    expect(classifyTool("memorySearch").reason).toBe("not_in_catalog");
    expect(isReadSafeTool("getTasks")).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 8 · gate.ts parseChatControls · request-body permission parsing
// ═════════════════════════════════════════════════════════════════════════
describe("parseChatControls", () => {
  it("canonical values parse; an absent permission defaults to draft", () => {
    expect(parseChatControls({ actionPermission: "read" }).actionPermission).toBe("read");
    expect(parseChatControls({ privateMode: true }).privateMode).toBe(true);
    expect(parseChatControls({}).actionPermission).toBe("draft");
  });

  // FIXED (was P3): a value that is present but unrecognised no longer widens to draft.
  it("EXPECTED · a present-but-unrecognised permission falls to the most restrictive value (read)", () => {
    expect(parseChatControls({ actionPermission: "READ" }).actionPermission).toBe("read");
    expect(parseChatControls({ actionPermission: " read" }).actionPermission).toBe("read");
    expect(parseChatControls({ actionPermission: "EXECUTE" }).actionPermission).toBe("read");
    expect(parseChatControls({ actionPermission: 1 }).actionPermission).toBe("read");
  });
  it("CONTROL · an absent or null permission is still the draft default", () => {
    expect(parseChatControls({}).actionPermission).toBe("draft");
    expect(parseChatControls({ actionPermission: null }).actionPermission).toBe("draft");
    expect(parseChatControls({ actionPermission: undefined }).actionPermission).toBe("draft");
  });
});
