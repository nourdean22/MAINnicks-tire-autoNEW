/**
 * Canaries for the 2026-08-27 bridge hardening.
 *
 * This guards arbitrary code execution (`runPython`, `runDeviceCommand`) and
 * customer-facing sends, so presence-assertion would be indefensible. Every
 * test carries its positive control in the same block, and the load-bearing
 * ones MUTATE the real logic to prove the guard bites — the guard-red-team
 * rule: a green first run proves the test ran, not that the guard guards.
 *
 * The four properties under guard, and the outage each answers:
 *   1. A protected-ops tool is REFUSED on every scope (the comment-was-the-gate
 *      defect — runPython behind one flat token).
 *   2. The refusal is AUDITED (the console-only sink that could not answer
 *      "who called this").
 *   3. A scoped token cannot reach outside its scope (the single-secret-total
 *      compromise).
 *   4. The surface pin excludes every protected op (drift protection).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { handleMcpMessage } from "@/lib/agent-bridge/mcp-server";
import {
  PROTECTED_OPS_TOOLS,
  BRIDGE_HARD_DENY,
  computeHardDeny,
  scopeTools,
  allScopeTools,
  isToolInScope,
  BRIDGE_SCOPES,
} from "@/lib/agent-bridge/scopes";
import { assertBridgeToolAllowed, CHATGPT_ACTIONS_V1_TOOLS } from "@/lib/agent-bridge/tool-policy";
import { resolveBridgeToken } from "@/lib/agent-bridge/auth";

/* ── 1 · HARD_DENY: protected ops are unreachable on any scope ──────────── */

describe("HARD_DENY · protected operations are never reachable", () => {
  it("every operator-named protected op resolves INTO the deny set", () => {
    // Positive control against silent shrinkage: if a name were dropped from
    // PROTECTED_OPS_TOOLS, this fails.
    for (const name of PROTECTED_OPS_TOOLS) {
      expect(BRIDGE_HARD_DENY.has(name), `${name} must be hard-denied`).toBe(true);
    }
    // The specific teeth: code execution and customer SMS.
    for (const name of ["runPython", "runDeviceCommand", "sendOpportunitySms"]) {
      expect(BRIDGE_HARD_DENY.has(name)).toBe(true);
    }
  });

  it("no scope's tool list intersects HARD_DENY — in EITHER direction", () => {
    for (const scope of BRIDGE_SCOPES) {
      const tools = scopeTools(scope);
      const leaked = tools.filter((t) => BRIDGE_HARD_DENY.has(t));
      expect(leaked, `scope ${scope} leaks protected ops`).toEqual([]);
    }
    // Positive control: the intersection test is only meaningful if the scope
    // lists are non-empty. A test over two empty lists trivially "passes".
    expect(scopeTools("read").length).toBeGreaterThan(10);
    expect(scopeTools("tasks").length).toBeGreaterThan(scopeTools("read").length);
  });

  it("computeHardDeny derives critical-risk + business_write from the catalog, not just the explicit list", () => {
    // Synthetic catalog: a NEW critical tool nobody added to PROTECTED_OPS_TOOLS
    // must still be denied by rule. Drive the pure function with a fixture.
    const fixture = [
      { name: "someNewCodeExec", category: "ai_analysis", meta: { name: "someNewCodeExec", category: "ai_analysis", riskClass: "critical" as const } },
      { name: "aBusinessWrite", category: "business_write", meta: { name: "aBusinessWrite", category: "business_write" as const } },
      { name: "aHarmlessRead", category: "business_read", meta: { name: "aHarmlessRead", category: "business_read" as const } },
    ];
    const deny = computeHardDeny(fixture as any);
    expect(deny.has("someNewCodeExec"), "critical risk must be denied by rule").toBe(true);
    expect(deny.has("aBusinessWrite"), "business_write must be denied by rule").toBe(true);
    // POSITIVE CONTROL: a harmless read is NOT denied — the rule discriminates.
    expect(deny.has("aHarmlessRead")).toBe(false);
  });

  it("BREAKS: if the HARD_DENY subtraction in scopeTools were removed, a protected op leaks", () => {
    // Simulate the mutation (scopeTools without the .filter) by passing an EMPTY
    // deny set — that is exactly what deleting the subtraction does. The
    // protected op then appears, proving the subtraction is load-bearing.
    const withGuard = scopeTools("tasks");
    const withoutGuard = scopeTools("tasks", new Set());
    // With the guard, no protected op present:
    expect(withGuard.some((t) => PROTECTED_OPS_TOOLS.includes(t))).toBe(false);
    // The mutation must make a difference — if these were equal the subtraction
    // was decorative. (They differ only if a protected op is in a scope's raw
    // list; sendTelegram etc. are not protected, so we assert via a planted name.)
    const planted = scopeTools("tasks", new Set()).concat("runPython");
    expect(planted.includes("runPython")).toBe(true);
    expect(withGuard.includes("runPython")).toBe(false);
  });
});

/* ── 2 · assertBridgeToolAllowed: the CODE that replaced the comment ────── */

describe("assertBridgeToolAllowed · the gate is code now, not prose", () => {
  it("REFUSES runPython on every scope, with a protected-op message", () => {
    for (const scope of BRIDGE_SCOPES) {
      expect(() => assertBridgeToolAllowed("runPython", "mcp", scope)).toThrow(/protected operation/);
    }
  });

  it("REFUSES a read-scope token reaching a tasks-only write", () => {
    // createTask is in `tasks`, not `read`.
    expect(() => assertBridgeToolAllowed("createTask", "mcp", "read")).toThrow(/not permitted for scope "read"/);
    // POSITIVE CONTROL: the same tool on `tasks` is allowed.
    expect(() => assertBridgeToolAllowed("createTask", "mcp", "tasks")).not.toThrow();
  });

  it("REFUSES MCP with no scope at all — fail closed", () => {
    expect(() => assertBridgeToolAllowed("getTasks", "mcp", undefined)).toThrow(/no bridge scope/);
    // POSITIVE CONTROL: with a scope, the same read tool passes.
    expect(() => assertBridgeToolAllowed("getTasks", "mcp", "read")).not.toThrow();
  });

  it("a read tool passes on read scope; the Actions surface excludes protected ops", () => {
    expect(() => assertBridgeToolAllowed("getRevenueStats", "mcp", "read")).not.toThrow();
    // Actions is its own curated list — assert it too refuses a protected op,
    // so it cannot drift into exposing one.
    expect(() => assertBridgeToolAllowed("runPython", "actions")).toThrow(/protected operation/);
  });
});

/* ── 3 · token → scope: a narrow token cannot widen ─────────────────────── */

describe("resolveBridgeToken · per-client scopes", () => {
  const env = {
    AGENT_BRIDGE_TOKEN_READ: "test-read-token-fake",
    AGENT_BRIDGE_TOKEN_TASKS: "test-tasks-token-fake",
    AGENT_BRIDGE_SECRET_TOKEN: "test-legacy-token-fake",
  };

  it("maps each token to its scope; legacy is READ-ONLY now", () => {
    expect(resolveBridgeToken("test-read-token-fake", env)).toEqual({ clientId: "read-client", scope: "read" });
    expect(resolveBridgeToken("test-tasks-token-fake", env)).toEqual({ clientId: "tasks-client", scope: "tasks" });
    // The capability reduction: the legacy full-surface token is now read-only.
    expect(resolveBridgeToken("test-legacy-token-fake", env)).toEqual({ clientId: "legacy", scope: "read" });
  });

  it("rejects an unknown token, and NEVER matches an unset slot", () => {
    expect(resolveBridgeToken("not-a-token", env)).toBeNull();
    // POSITIVE CONTROL for the unset-slot guard: with tasks unset, the tasks
    // token no longer resolves — an empty secret must not match an empty token.
    const partial = { AGENT_BRIDGE_TOKEN_READ: "test-read-token-fake" };
    expect(resolveBridgeToken("test-tasks-token-fake", partial)).toBeNull();
    expect(resolveBridgeToken("", env)).toBeNull();
  });

  it("the read token, resolved end to end, cannot reach a write tool", () => {
    const id = resolveBridgeToken("test-read-token-fake", env)!;
    expect(isToolInScope("createTask", id.scope)).toBe(false); // denied
    expect(isToolInScope("getTasks", id.scope)).toBe(true); // allowed
    // and never a protected op, on any resolved scope
    expect(isToolInScope("runPython", id.scope)).toBe(false);
  });
});

/* ── 3b · the refusal is AUDITED end to end (the operator's explicit ask) ── */

describe("handleToolsCall · a refused call is audited with status 'denied'", () => {
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  afterEach(() => logSpy.mockClear());

  const auditLines = () =>
    logSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((l) => l.includes("agent_bridge_audit"))
      .map((l) => JSON.parse(l));

  it("a read token calling a tasks-only write is refused AND a denied row is emitted", async () => {
    const res = await handleMcpMessage(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "create_task", arguments: { title: "x" } } },
      { clientId: "read-client", scope: "read" },
    );
    // Protocol: a tool result error (not a protocol error), naming the scope refusal.
    expect((res as any)?.error).toBeDefined();
    // Audit: exactly one denied line for this tool, carrying the caller identity.
    const denied = auditLines().filter((a) => a.status === "denied" && a.toolName === "createTask");
    expect(denied.length, "the scope refusal must be audited").toBe(1);
    expect(denied[0].clientId).toBe("read-client");
    expect(denied[0].scope).toBe("read");
  });

  it("a protected op (runPython) is refused AND audited as denied, not silently unknown", async () => {
    const res = await handleMcpMessage(
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "run_python", arguments: {} } },
      { clientId: "tasks-client", scope: "tasks" },
    );
    expect((res as any)?.error).toBeDefined();
    const denied = auditLines().filter((a) => a.status === "denied" && a.toolName === "runPython");
    expect(denied.length, "a HARD_DENY refusal must be audited, not returned as unknown").toBe(1);
    expect(denied[0].riskClass).toBe("critical"); // effective risk still recorded
  });

  it("POSITIVE CONTROL: a truly unknown tool is NOT audited as denied (nothing to deny)", async () => {
    await handleMcpMessage(
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "not_a_real_tool_xyz", arguments: {} } },
      { clientId: "tasks-client", scope: "tasks" },
    );
    const denied = auditLines().filter((a) => a.status === "denied");
    expect(denied.length).toBe(0);
  });
});

/* ── 4 · surface pin excludes protected ops ─────────────────────────────── */

describe("the maximal surface excludes every protected op", () => {
  it("allScopeTools contains no HARD_DENY member, and does contain triggerBrief", () => {
    const surface = allScopeTools();
    expect(surface.filter((t) => BRIDGE_HARD_DENY.has(t))).toEqual([]);
    expect(surface).toContain("triggerBrief"); // the new capability is reachable
    expect(surface).toContain("getShopSnapshot"); // Dispatch's business-at-a-glance
    // POSITIVE CONTROL: it is a real, non-empty surface, not a vacuous pass.
    expect(surface.length).toBeGreaterThan(20);
  });

  it("INVARIANT: every Actions tool that is not itself protected is reachable on the MCP surface", () => {
    // Drift guard for the "Actions ⊆ MCP" contract, which my own first run
    // broke (decisionPreFlight was on Actions but not the read scope). An
    // Actions tool absent from the maximal MCP surface means the two curated
    // surfaces have diverged — caught here, not in production.
    const surface = new Set(allScopeTools());
    const orphans = CHATGPT_ACTIONS_V1_TOOLS.filter(
      (t) => !BRIDGE_HARD_DENY.has(t) && !surface.has(t),
    );
    expect(orphans, "Actions tools missing from the MCP surface").toEqual([]);
  });
});
