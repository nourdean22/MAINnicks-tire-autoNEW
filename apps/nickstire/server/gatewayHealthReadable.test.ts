/**
 * Q-23 phase 9 · `sms.gatewayHealth` says when it could not ask.
 *
 * The resolver returned `online: false` both when the gateway phone had stopped
 * checking in and when the Capevace API itself failed (non-OK status, timeout,
 * bad JSON). Every admin badge then read "Gateway offline" for an outage on the
 * vendor's side, and nothing on the payload could tell the two apart.
 *
 * `readable: false` now marks the two branches where the vendor was not
 * answered. Every other branch is a real answer and carries `readable: true`,
 * including "no devices registered", which is a finding, not a failed read.
 *
 * `fetch` is stubbed in every case: no request leaves the test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function adminContext() {
  return {
    user: {
      id: 1,
      openId: "admin-user",
      email: "admin@nickstire.com",
      name: "Admin User",
      loginMethod: "manus",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} },
    res: { clearCookie: () => {} },
  } as never;
}

const health = async () => {
  const { appRouter } = await import("./routers");
  return appRouter.createCaller(adminContext()).sms.gatewayHealth();
};

const respond = (status: number, body: unknown) =>
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify(body), { status }));

describe("sms.gatewayHealth · readable separates 'could not ask' from 'offline'", () => {
  beforeEach(() => {
    vi.stubEnv("SHOP_SMS_GATEWAY_USERNAME", "canary-user");
    vi.stubEnv("SHOP_SMS_GATEWAY_PASSWORD", "canary-pass");
    vi.stubEnv("SHOP_SMS_GATEWAY_URL", "https://gateway.invalid/3rdparty/v1");
    vi.stubEnv("SHOP_SMS_GATEWAY_DEVICE_ID", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("a non-OK vendor response is readable: false", async () => {
    respond(503, { error: "down" });
    const r = await health();
    expect(r.readable).toBe(false);
    expect(r.online).toBe(false);
    expect(r.error).toContain("503");
  });

  it("an unreachable vendor is readable: false", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("canary network failure");
    });
    const r = await health();
    expect(r.readable).toBe(false);
    expect(r.error).toContain("canary network failure");
  });

  it("a phone that stopped checking in is readable: true and offline", async () => {
    respond(200, [{ id: "d1", name: "F25e", lastSeen: new Date(Date.now() - 3 * 3_600_000).toISOString() }]);
    const r = await health();
    expect(r.readable).toBe(true);
    expect(r.online).toBe(false);
    expect(r.lastSeen).not.toBeNull();
  });

  it("a phone seen a minute ago is readable: true and online", async () => {
    respond(200, [{ id: "d1", name: "F25e", lastSeen: new Date(Date.now() - 60_000).toISOString() }]);
    const r = await health();
    expect(r.readable).toBe(true);
    expect(r.online).toBe(true);
  });

  it("an empty device list is a finding, readable: true", async () => {
    respond(200, []);
    const r = await health();
    expect(r.readable).toBe(true);
    expect(r.error).toBe("No devices registered");
  });

  it("missing credentials are readable: true and not configured", async () => {
    vi.stubEnv("SHOP_SMS_GATEWAY_USERNAME", "");
    vi.stubGlobal("fetch", async () => {
      throw new Error("fetch must not be reached without credentials");
    });
    const r = await health();
    expect(r.configured).toBe(false);
    expect(r.readable).toBe(true);
  });
});
