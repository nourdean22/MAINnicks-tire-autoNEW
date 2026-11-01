/**
 * Bug hunt 2026-10-27 (Codex on PR 3332): POST /api/admin/flags/toggle flipped a flag with NO audit row, while the
 * Settings pause line takes "since <date> by <who>" from the newest audit row. Pause by A (audited), resume and pause
 * again through this route (unaudited): the new pause read as A's, with A's old date, and the value still matched.
 * Every writer of a flag must leave the audit row the reader looks for (action flag.toggled).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  audited: [] as Array<{ action: string; entityType: string; entityId: string; newValue?: string; actor?: string }>,
  setCalls: [] as Array<[string, boolean]>,
  auditFails: false,
}));

vi.mock("../services/featureFlags", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/featureFlags")>()),
  setFlag: async (k: string, v: boolean) => {
    h.setCalls.push([k, v]);
  },
}));
vi.mock("../services/auditTrail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/auditTrail")>()),
  logAdminAction: async (a: { action: string; entityType: string; entityId: string; newValue?: string; actor?: string }) => {
    if (h.auditFails) throw new Error("audit_log unreadable");
    h.audited.push(a);
  },
}));

import { registerAdminRoutes } from "./adminRoutes";

type Handler = (req: unknown, res: unknown) => Promise<void> | void;
function toggleHandler(): Handler {
  const posts = new Map<string, Handler>();
  const app = {
    get: () => undefined,
    post: (path: string, ...fns: Handler[]) => posts.set(path, fns[fns.length - 1]),
    put: () => undefined,
    delete: () => undefined,
    patch: () => undefined,
    use: () => undefined,
  };
  registerAdminRoutes(app as never);
  const handler = posts.get("/api/admin/flags/toggle");
  if (!handler) throw new Error("toggle route not registered");
  return handler;
}

function call(body: unknown) {
  const out: { status: number; json: unknown } = { status: 200, json: undefined };
  const res = {
    status: (s: number) => {
      out.status = s;
      return res;
    },
    json: (j: unknown) => {
      out.json = j;
    },
  };
  return toggleHandler()({ body }, res).then(() => out);
}

beforeEach(() => {
  h.audited.length = 0;
  h.setCalls.length = 0;
  h.auditFails = false;
});

// AGENTS.md section 3: a partial vi.mock factory (no importOriginal spread) strips every other export of the module for
// anything else that imports it in the same worker. Both mocks above keep the real module and override one function.
describe("the mocks are partial, not replacements", () => {
  it("auditTrail and featureFlags keep their other exports", async () => {
    const audit = await import("../services/auditTrail");
    const flags = await import("../services/featureFlags");
    expect(typeof audit.getAuditTrail).toBe("function");
    expect(typeof flags.getAllFlags).toBe("function");
    // positive control: the override is still the one in force
    await flags.setFlag("send_pause_declined_recovery", true);
    expect(h.setCalls).toEqual([["send_pause_declined_recovery", true]]);
  });
});

describe("POST /api/admin/flags/toggle", () => {
  it("writes the flag.toggled audit row the Settings pause line reads", async () => {
    const out = await call({ key: "send_pause_declined_recovery", value: true });
    expect(h.setCalls).toEqual([["send_pause_declined_recovery", true]]); // positive control: the flip ran
    expect(out.json).toMatchObject({ toggled: true });
    expect(h.audited).toHaveLength(1);
    expect(h.audited[0]).toMatchObject({
      action: "flag.toggled",
      entityType: "feature_flag",
      entityId: "send_pause_declined_recovery",
      newValue: "true",
      actor: "admin-api-key",
    });
  });

  it("an audit miss never blocks the flip", async () => {
    h.auditFails = true;
    const out = await call({ key: "send_pause_declined_recovery", value: false });
    expect(h.setCalls).toEqual([["send_pause_declined_recovery", false]]);
    expect(out.json).toMatchObject({ toggled: true });
  });

  it("a bad body is refused and writes nothing", async () => {
    const out = await call({ key: "send_pause_declined_recovery", value: "yes" });
    expect(out.status).toBe(400);
    expect(h.setCalls).toEqual([]);
    expect(h.audited).toEqual([]);
  });
});
