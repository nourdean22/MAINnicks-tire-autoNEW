/**
 * The nickstire cross-system client must not report success while doing nothing.
 *
 * callNickstire RESOLVES (never rejects) to a truthy `{ error }` object on every
 * failure path, so `!!res` is true for a total failure. That mistake made nine
 * shop handlers report `success: true` over an error payload, and wrote SUCCESS
 * action receipts for SMS that was never sent (#1330).
 *
 * Those nine handlers were DELETED — five named procedures that do not exist in
 * nickstire at all, four behind an adminProcedure a Bearer token can never
 * satisfy. What survives is the client itself, still imported directly by the
 * Telegram webhook and the audit-todays-leads job, so these pins moved onto the
 * client rather than being deleted along with the handlers.
 *
 * These are about the FAILURE CONTRACT, not about the bridge working. nickstire's
 * tRPC authenticates from the `app_session_id` cookie only, so these calls still
 * cannot succeed in production — the tests assert we say so honestly rather than
 * assert a 200.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

const ENV_KEYS = ["BRIDGE_API_KEY", "STATENOUR_SYNC_KEY", "NICKSTIRE_URL", "NICKS_ADMIN_URL"] as const;
const ORIGINAL: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) ORIGINAL[k] = process.env[k];

/**
 * NICKSTIRE_API and BRIDGE_KEY are module-scope consts evaluated at import, so env
 * has to be set BEFORE the module loads — hence resetModules + dynamic import per
 * case rather than a top-level static import.
 */
async function loadModule(env: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>) {
  vi.resetModules();
  for (const k of ENV_KEYS) {
    const v = env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return import("@/lib/ai/agent-actions/shop-actions");
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = ORIGINAL[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("isBridgeError", () => {
  it("classifies the { error } object the client actually returns as a failure", async () => {
    const { isBridgeError } = await loadModule({ BRIDGE_API_KEY: "test-key" });
    expect(isBridgeError({ error: "403 Forbidden" })).toBe(true);
    expect(isBridgeError({ error: "BRIDGE_API_KEY (or STATENOUR_SYNC_KEY) not configured" })).toBe(true);
    expect(isBridgeError(null)).toBe(true);
    expect(isBridgeError(undefined)).toBe(true);
  });

  it("classifies a real tRPC payload as success", async () => {
    const { isBridgeError } = await loadModule({ BRIDGE_API_KEY: "test-key" });
    expect(isBridgeError({ result: { data: { json: [] } } })).toBe(false);
  });
});

describe("callNickstire fails honestly", () => {
  it("returns an error when the bridge answers with the SPA HTML page", async () => {
    // The exact live defect #1330 fixed: an unrouted path hits nickstire's SPA
    // catch-all, which replies 200 text/html. res.ok is TRUE, so only the json()
    // parse failure reveals it.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<!doctype html><html><body>app</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      })),
    );
    const { callNickstire, isBridgeError } = await loadModule({ BRIDGE_API_KEY: "test-key" });
    expect(isBridgeError(await callNickstire("lead.list", {}))).toBe(true);
  });

  it("returns an error on the 403 an unauthenticated adminProcedure gives", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Forbidden", { status: 403 })));
    const { callNickstire, isBridgeError } = await loadModule({ BRIDGE_API_KEY: "test-key" });
    const res = await callNickstire("lead.list", {});
    expect(isBridgeError(res)).toBe(true);
    expect(String((res as { error: unknown }).error)).toContain("403");
  });

  it("returns an error naming the missing env var when no bridge key is configured", async () => {
    const { callNickstire, isBridgeError } = await loadModule({
      BRIDGE_API_KEY: undefined,
      STATENOUR_SYNC_KEY: undefined,
    });
    const res = await callNickstire("lead.list", {});
    expect(isBridgeError(res)).toBe(true);
    expect(String((res as { error: unknown }).error)).toContain("BRIDGE_API_KEY");
  });

  it("passes a real payload straight through", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ result: { data: { json: [] } } })));
    const { callNickstire, isBridgeError } = await loadModule({ BRIDGE_API_KEY: "test-key" });
    expect(isBridgeError(await callNickstire("lead.list", {}))).toBe(false);
  });
});

describe("bridge URL construction", () => {
  it("targets /api/trpc, not /trpc", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ result: { data: { json: [] } } }));
    vi.stubGlobal("fetch", fetchMock);
    const { callNickstire } = await loadModule({
      BRIDGE_API_KEY: "test-key",
      NICKSTIRE_URL: "https://nickstire.org",
    });
    await callNickstire("lead.list", {});
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/trpc/lead.list");
  });

  it("strips a trailing /admin so the path is not /admin/api/trpc", async () => {
    // statenour's own accessor defaults NICKS_ADMIN_URL to the /admin url
    // (lib/env.ts), which silently produced a 404-into-SPA before #1330.
    const fetchMock = vi.fn(async () => jsonResponse({ result: { data: { json: [] } } }));
    vi.stubGlobal("fetch", fetchMock);
    const { callNickstire } = await loadModule({
      BRIDGE_API_KEY: "test-key",
      NICKSTIRE_URL: undefined,
      NICKS_ADMIN_URL: "https://nickstire.org/admin",
    });
    await callNickstire("lead.list", {});
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("https://nickstire.org/api/trpc/lead.list");
    expect(url).not.toContain("/admin");
  });
});

describe("the deleted handlers stay deleted", () => {
  it("exports only the client and its predicate", async () => {
    // A regression guard with a real job: re-adding a handleShop* export means a
    // dead lane was resurrected without re-checking that the procedure exists
    // and that a token can reach it. Neither is true today, and tsc does not
    // cover tests/ here, so this is the only place that would notice.
    const mod = await loadModule({ BRIDGE_API_KEY: "test-key" });
    expect(Object.keys(mod).sort()).toEqual(["callNickstire", "isBridgeError"]);
  });
});
