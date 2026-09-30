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
