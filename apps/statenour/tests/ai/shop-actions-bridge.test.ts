/**
 * The cross-app shop bridge must not report success while doing nothing.
 *
 * callNickstire RESOLVES (never rejects) to a truthy `{ error }` object on
 * every failure path. Nine handlers tested it with `!!res`, which is true for
 * that object — so a bridge that could not authenticate, and was pointed at a
 * path that does not exist, reported `success: true` on every call. The same
 * mistake in the Telegram approve branch wrote SUCCESS action receipts for SMS
 * that was never sent.
 *
 * These pins are about the SUCCESS CONTRACT, not about the bridge working.
 * nickstire's tRPC authenticates from the `app_session_id` cookie only, so
 * these admin procedures still cannot be reached with a Bearer token — that is
 * a deliberate open item, and the tests below assert we say so honestly rather
 * than assert a 200.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

const ENV_KEYS = ["BRIDGE_API_KEY", "STATENOUR_SYNC_KEY", "NICKSTIRE_URL", "NICKS_ADMIN_URL"] as const;
const ORIGINAL: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) ORIGINAL[k] = process.env[k];

/**
 * NICKSTIRE_API and BRIDGE_KEY are module-scope consts evaluated at import, so
 * env has to be set BEFORE the module is loaded — hence resetModules + dynamic
 * import per case rather than a top-level static import.
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
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
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
    // Every real failure path in callNickstire produces one of these.
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

describe("shop handlers report failure honestly", () => {
  it("returns success:false when the bridge answers with the SPA HTML page", async () => {
    // The exact live defect: an unrouted path hits nickstire's SPA catch-all,
    // which replies 200 text/html. res.ok is TRUE, so only the json() parse
    // failure reveals it.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<!doctype html><html><body>app</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      })),
    );
    const { handleShopGetLeads } = await loadModule({ BRIDGE_API_KEY: "test-key" });
    const out = await handleShopGetLeads({}, "shop_get_leads");
    expect(out.success).toBe(false);
  });

  it("returns success:false on the 403 an unauthenticated admin procedure gives", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Forbidden", { status: 403 })));
    const { handleShopGetLeads } = await loadModule({ BRIDGE_API_KEY: "test-key" });
    const out = await handleShopGetLeads({}, "shop_get_leads");
    expect(out.success).toBe(false);
  });

  it("returns success:false when no bridge key is configured", async () => {
    const { handleShopGetLeads } = await loadModule({
      BRIDGE_API_KEY: undefined,
      STATENOUR_SYNC_KEY: undefined,
    });
    const out = await handleShopGetLeads({}, "shop_get_leads");
    expect(out.success).toBe(false);
  });

  it("returns success:true only for a real payload", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ result: { data: { json: [] } } })));
    const { handleShopGetLeads } = await loadModule({ BRIDGE_API_KEY: "test-key" });
    const out = await handleShopGetLeads({}, "shop_get_leads");
    expect(out.success).toBe(true);
  });
});

describe("the failure REASON reaches ActionResult.error", () => {
  // guardian.ts, action-receipt.ts, action-result-verifier.ts and nick-agent.ts
  // all read ActionResult.error to tell the operator why something failed. Those
  // branches were dead while success was hardcoded-true; now that they are live,
  // handing them nothing would turn a missing env var, a 403 and a timeout into
  // one indistinguishable "unknown error".
  it("carries the bridge error text, not a generic string", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Forbidden", { status: 403 })));
    const { handleShopGetLeads } = await loadModule({ BRIDGE_API_KEY: "test-key" });
    const out = await handleShopGetLeads({}, "shop_get_leads");
    expect(out.success).toBe(false);
    expect(out.error).toContain("403");
  });

  it("names the missing env var when no bridge key is configured", async () => {
    const { handleShopGetLeads } = await loadModule({
      BRIDGE_API_KEY: undefined,
      STATENOUR_SYNC_KEY: undefined,
    });
    const out = await handleShopGetLeads({}, "shop_get_leads");
    expect(out.error).toContain("BRIDGE_API_KEY");
  });

  it("falls back to a real sentence rather than the string 'undefined' on a null body", async () => {
    // isBridgeError(null) is true, but null?.error is undefined — without the
    // ?? fallback this is where "unknown error" would come back.
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(null)));
    const { handleShopGetLeads } = await loadModule({ BRIDGE_API_KEY: "test-key" });
    const out = await handleShopGetLeads({}, "shop_get_leads");
    expect(out.success).toBe(false);
    expect(out.error).toBe("nickstire bridge unavailable");
  });

  it("leaves error unset on success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ result: { data: { json: [] } } })));
    const { handleShopGetLeads } = await loadModule({ BRIDGE_API_KEY: "test-key" });
    const out = await handleShopGetLeads({}, "shop_get_leads");
    expect(out.success).toBe(true);
    expect(out.error).toBeUndefined();
  });
});

describe("bridge URL construction", () => {
  it("targets /api/trpc, not /trpc", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ result: { data: { json: [] } } }));
    vi.stubGlobal("fetch", fetchMock);
    const { handleShopGetLeads } = await loadModule({
      BRIDGE_API_KEY: "test-key",
      NICKSTIRE_URL: "https://nickstire.org",
    });
    await handleShopGetLeads({}, "shop_get_leads");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/trpc/lead.list");
  });

  it("strips a trailing /admin so the path is not /admin/api/trpc", async () => {
    // statenour's own accessor defaults NICKS_ADMIN_URL to the /admin url
    // (lib/env.ts), which silently produced a 404-into-SPA before this.
    const fetchMock = vi.fn(async () => jsonResponse({ result: { data: { json: [] } } }));
    vi.stubGlobal("fetch", fetchMock);
    const { handleShopGetLeads } = await loadModule({
      BRIDGE_API_KEY: "test-key",
      NICKSTIRE_URL: undefined,
      NICKS_ADMIN_URL: "https://nickstire.org/admin",
    });
    await handleShopGetLeads({}, "shop_get_leads");
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("https://nickstire.org/api/trpc/lead.list");
    expect(url).not.toContain("/admin");
  });
});
