/**
 * Q-13 — the sync key alone must not be able to post to Instagram.
 *
 * Positive control: on main before this change, the first describe block is
 * red — /api/nour-os/query ran instagram_autopost_run with STATENOUR_SYNC_KEY
 * and armed legacy_autopost_live for a live post.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runSpy = vi.fn(async (opts: unknown) => ({ status: "dry_run", opts }));
const setFlagSpy = vi.fn(async (_key: string, _on: boolean) => undefined);
let flagOn = false;

const auditRows: Array<{ action: string; entityType: string; entityId: string; newValue?: string; actor?: string }> = [];
let auditFails = false;

// Keep every real export (getAuditTrail, ...) so a later file in a shared registry never gets a partial module.
vi.mock("../services/auditTrail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/auditTrail")>()),
  logAdminAction: async (a: (typeof auditRows)[number]) => {
    if (auditFails) throw new Error("audit_log unreadable");
    auditRows.push(a);
  },
}));
vi.mock("../services/igAutopost", () => ({ runIgAutopost: runSpy }));
vi.mock("../services/featureFlags", () => ({
  isEnabled: vi.fn(async () => flagOn),
  setFlag: setFlagSpy,
}));

type Handler = (req: unknown, res: unknown) => Promise<unknown>;

function fakeRes() {
  const res: { statusCode: number; body: any; status: (c: number) => typeof res; json: (b: unknown) => typeof res } = {
    statusCode: 200,
    body: null,
    status(c: number) { this.statusCode = c; return this; },
    json(b: unknown) { this.body = b; return this; },
  };
  return res;
}

async function mount(modPath: "./nour-os-query" | "./nour-os-ig-control"): Promise<Handler> {
  let handler: Handler | null = null;
  const app = { post: (_p: string, fn: Handler) => { handler = fn; } } as never;
  if (modPath === "./nour-os-query") (await import("./nour-os-query")).registerNourOsQueryRoute(app);
  else (await import("./nour-os-ig-control")).registerNourOsIgControlRoute(app);
  return handler!;
}

const SYNC = "sync-key-aaaaaaaa";
const CONTROL = "ig-control-key-bb";
const ORIG = { sync: process.env.STATENOUR_SYNC_KEY, control: process.env.NOUR_OS_IG_CONTROL_KEY };

beforeEach(() => {
  vi.resetModules();
  runSpy.mockClear();
  setFlagSpy.mockClear();
  flagOn = false;
  auditRows.length = 0;
  auditFails = false;
  process.env.STATENOUR_SYNC_KEY = SYNC;
  process.env.NOUR_OS_IG_CONTROL_KEY = CONTROL;
});

afterEach(() => {
  for (const [name, value] of [["STATENOUR_SYNC_KEY", ORIG.sync], ["NOUR_OS_IG_CONTROL_KEY", ORIG.control]] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("/api/nour-os/query no longer carries the mutating IG actions", () => {
  for (const query of ["instagram_autopost_run", "instagram_autopost_set_config"]) {
    it(`${query} with the sync key → 400 unknown query, nothing runs, no flag flips`, async () => {
      const handler = await mount("./nour-os-query");
      const res = fakeRes();
      await handler({ headers: { "x-sync-key": SYNC }, body: { query, filters: { dryRun: false, enabled: true } } }, res);
      expect(res.statusCode).toBe(400);
      expect(runSpy).not.toHaveBeenCalled();
      expect(setFlagSpy).not.toHaveBeenCalled();
    });
  }

  it("the read-only IG status query is still served", async () => {
    const handler = await mount("./nour-os-query");
    const res = fakeRes();
    await handler({ headers: { "x-sync-key": SYNC }, body: { query: "instagram_autopost_status" } }, res);
    expect(res.body?.error ?? "").not.toMatch(/Unknown query/);
  });
});

describe("/api/nour-os/ig-control auth", () => {
  async function post(headers: Record<string, string>, body: unknown = { action: "autopost_run", filters: { dryRun: false } }) {
    const handler = await mount("./nour-os-ig-control");
    const res = fakeRes();
    await handler({ headers, body }, res);
    return res;
  }

  it("control key unset → 503 even with the sync key, nothing runs", async () => {
    delete process.env.NOUR_OS_IG_CONTROL_KEY;
    const res = await post({ "x-ig-control-key": SYNC, "x-sync-key": SYNC });
    expect(res.statusCode).toBe(503);
    // StateNour's ig-control client matches this exact text to tell the route's
    // own refusal (nothing ran) from an edge 503 (the run may be in flight).
    expect(res.body).toEqual({ error: "Instagram control is not configured" });
    expect(runSpy).not.toHaveBeenCalled();
    expect(setFlagSpy).not.toHaveBeenCalled();
  });

  it("control key equal to the sync key → 503 (no shared-key fallback)", async () => {
    process.env.NOUR_OS_IG_CONTROL_KEY = SYNC;
    const res = await post({ "x-ig-control-key": SYNC });
    expect(res.statusCode).toBe(503);
    expect(runSpy).not.toHaveBeenCalled();
  });

  it("sync key presented as the control key → 401", async () => {
    const res = await post({ "x-ig-control-key": SYNC, "x-sync-key": SYNC });
    expect(res.statusCode).toBe(401);
    expect(runSpy).not.toHaveBeenCalled();
    expect(setFlagSpy).not.toHaveBeenCalled();
  });

  it("missing header → 401", async () => {
    const res = await post({});
    expect(res.statusCode).toBe(401);
    expect(runSpy).not.toHaveBeenCalled();
  });

  it("unknown or prototype action → 400", async () => {
    for (const action of ["toString", "__proto__", "nope", 42]) {
      const res = await post({ "x-ig-control-key": CONTROL }, { action });
      expect(res.statusCode).toBe(400);
    }
    expect(runSpy).not.toHaveBeenCalled();
  });
});

describe("/api/nour-os/ig-control behaviour (moved verbatim)", () => {
  async function run(body: unknown) {
    const handler = await mount("./nour-os-ig-control");
    const res = fakeRes();
    await handler({ headers: { "x-ig-control-key": CONTROL }, body }, res);
    return res;
  }

  it("dry run by default: runs dry, never touches the live flag", async () => {
    const res = await run({ action: "autopost_run" });
    expect(res.statusCode).toBe(200);
    expect(runSpy).toHaveBeenCalledWith({ dryRun: true, forceArchetype: undefined, source: "admin" });
    expect(setFlagSpy).not.toHaveBeenCalled();
  });

  it("live run on a disarmed lane arms the flag for the run and restores it", async () => {
    const res = await run({ action: "autopost_run", filters: { dryRun: false, forceArchetype: "tips" } });
    expect(res.statusCode).toBe(200);
    expect(runSpy).toHaveBeenCalledWith({ dryRun: false, forceArchetype: "tips", source: "admin" });
    expect(setFlagSpy.mock.calls).toEqual([["legacy_autopost_live", true], ["legacy_autopost_live", false]]);
  });

  it("live run that throws still restores the flag, and answers 500", async () => {
    runSpy.mockRejectedValueOnce(new Error("boom"));
    const res = await run({ action: "autopost_run", filters: { dryRun: false } });
    expect(res.statusCode).toBe(500);
    expect(setFlagSpy.mock.calls.at(-1)).toEqual(["legacy_autopost_live", false]);
  });

  it("set_config sets the live flag", async () => {
    const res = await run({ action: "autopost_set_config", filters: { enabled: true } });
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual({ success: true, livePostingEnabled: true });
    expect(setFlagSpy).toHaveBeenCalledWith("legacy_autopost_live", true);
  });

  it("filters that are not an object → 400", async () => {
    const res = await run({ action: "autopost_run", filters: "x" });
    expect(res.statusCode).toBe(400);
    expect(runSpy).not.toHaveBeenCalled();
  });
});

// Bug hunt 2026-10-27: this route flipped legacy_autopost_live with no audit row, while the Settings switches card reads
// "changed <when> by <who>" from the newest flag.toggled row (services/featureFlags.ts flag-change reader). Every writer of a
// flag leaves that row (PR 3332 did it for /api/admin/flags/toggle).
describe("/api/nour-os/ig-control leaves the flag.toggled audit row the Settings card reads", () => {
  async function run(body: unknown) {
    const handler = await mount("./nour-os-ig-control");
    const res = fakeRes();
    await handler({ headers: { "x-ig-control-key": CONTROL }, body }, res);
    return res;
  }
  const row = (value: boolean) => ({
    action: "flag.toggled",
    entityType: "feature_flag",
    entityId: "legacy_autopost_live",
    newValue: String(value),
    actor: "nour-os-ig-control",
  });

  it("set_config writes one row for the new value", async () => {
    const res = await run({ action: "autopost_set_config", filters: { enabled: true } });
    expect(setFlagSpy).toHaveBeenCalledWith("legacy_autopost_live", true); // positive control: the flip ran
    expect(res.statusCode).toBe(200);
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject(row(true));
  });

  it("set_config off writes a false row", async () => {
    await run({ action: "autopost_set_config", filters: { enabled: false } });
    expect(auditRows.map((r) => r.newValue)).toEqual(["false"]);
  });

  // audit_log.created_at has one-second precision and audit_log.id is a random UUID, so two rows for one flag written in the
  // same second cannot be ordered: the reader (getLastFlagChanges, MAX(created_at) join) may pick the arm row and read the
  // restored "off" as unknown. A live run arms and restores inside one request (often under a second when it fails), so only
  // the final state is audited: the lane is back where it started and the newest row says who ran it and when.
  it("a live run on a disarmed lane writes ONE row: the restored final state, never the arm", async () => {
    await run({ action: "autopost_run", filters: { dryRun: false } });
    expect(setFlagSpy.mock.calls).toEqual([["legacy_autopost_live", true], ["legacy_autopost_live", false]]);
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject(row(false));
  });

  it("a live run that throws still audits the restore, and only that", async () => {
    runSpy.mockRejectedValueOnce(new Error("boom"));
    const res = await run({ action: "autopost_run", filters: { dryRun: false } });
    expect(res.statusCode).toBe(500);
    expect(auditRows.map((r) => r.newValue)).toEqual(["false"]);
  });

  it("a dry run flips nothing, so it audits nothing", async () => {
    await run({ action: "autopost_run" });
    expect(setFlagSpy).not.toHaveBeenCalled();
    expect(auditRows).toEqual([]);
  });

  it("an audit miss never blocks the flip or the answer", async () => {
    auditFails = true;
    const res = await run({ action: "autopost_set_config", filters: { enabled: true } });
    expect(setFlagSpy).toHaveBeenCalledWith("legacy_autopost_live", true);
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual({ success: true, livePostingEnabled: true });
  });
});
