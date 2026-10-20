/**
 * Admin reads that call an outside service must answer in bounded time.
 *
 * tRPC batches wait for their slowest member. Railway logs (7 days to
 * 2026-10-19) showed Today's first load stalling 15.0-15.1 s, the exact cap of
 * services/vapi.ts vapiFetch (vapi.recentCalls), and the Voice page up to
 * 19.5 s, because vapi.getTransferDestination read Vapi with no timeout at all.
 *
 * Each case below hangs the outside service (a fetch that only settles when
 * its AbortSignal fires) and asserts the read comes back on its own, reading
 * "could not ask" honestly: never a made-up healthy value. A 5 s sentinel turns
 * an unbounded read into an assertion failure instead of a test timeout.
 *
 * `fetch` is stubbed in every case: no request leaves the test.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetGatewayHealthCache } from "./lib/gatewayHealthProbe";
import { resetVapiAdminReadCaches } from "./routers/vapi";

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

async function caller() {
  const { appRouter } = await import("./routers");
  return appRouter.createCaller(adminContext());
}

/** A request that never answers, but does honour its abort signal. */
function hangingFetch() {
  return vi.fn((_url: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return; // no signal: hangs forever, which is the bug
      if (signal.aborted) return reject(signal.reason);
      signal.addEventListener("abort", () => reject(signal.reason));
    }),
  );
}

const HUNG = Symbol("hung");
async function within<T>(p: Promise<T>, ms = 5_000): Promise<{ value: T | typeof HUNG; elapsed: number }> {
  const start = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const value = await Promise.race([
    p,
    new Promise<typeof HUNG>((r) => {
      timer = setTimeout(() => r(HUNG), ms);
    }),
  ]);
  clearTimeout(timer);
  return { value, elapsed: Date.now() - start };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const ASSISTANTS = [
  { id: "rec-1", name: "Nick's Tire & Auto Receptionist" },
  { id: "fu-1", name: "Nick's Tire Follow-Up Caller" },
];
const assistantWith = (id: string, number: string) => ({
  id,
  name: id,
  model: { tools: [{ type: "transferCall", destinations: [{ type: "number", number, message: "Transferring" }] }] },
});

// The cold router import takes seconds; pay it here so no timing below includes it.
beforeAll(async () => {
  await import("./routers");
}, 60_000);

beforeEach(() => {
  resetGatewayHealthCache();
  resetVapiAdminReadCaches();
  vi.stubEnv("SHOP_SMS_GATEWAY_USERNAME", "canary-user");
  vi.stubEnv("SHOP_SMS_GATEWAY_PASSWORD", "canary-pass");
  vi.stubEnv("SHOP_SMS_GATEWAY_URL", "https://gateway.invalid/3rdparty/v1");
  vi.stubEnv("SHOP_SMS_GATEWAY_DEVICE_ID", "");
  vi.stubEnv("VAPI_API_KEY", "canary-vapi-key");
  vi.stubEnv("VAPI_RECEPTIONIST_ASSISTANT_ID", "rec-1");
  vi.stubEnv("VAPI_FOLLOWUP_ASSISTANT_ID", "fu-1");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetGatewayHealthCache();
  resetVapiAdminReadCaches();
});

describe("Today batch · reads bounded when the outside service hangs", () => {
  it("sms.gatewayHealth answers within 4 s and reads unknown (readable: false), not offline-or-online", { timeout: 15_000 }, async () => {
    vi.stubGlobal("fetch", hangingFetch());
    const c = await caller();
    const { value, elapsed } = await within(c.sms.gatewayHealth());
    expect(value, "gatewayHealth still waiting on the vendor after 5 s").not.toBe(HUNG);
    expect(elapsed).toBeLessThan(4_000);
    const r = value as Awaited<ReturnType<typeof c.sms.gatewayHealth>>;
    expect(r.readable).toBe(false);
    expect(r.lastSeen).toBeNull();
  });

  it("sms.gatewayHealth answers a second read within a minute from the last probe, with the age recomputed", async () => {
    const seen = new Date(Date.now() - 2 * 60_000).toISOString();
    const fetchMock = vi.fn(async () => json([{ id: "d1", name: "F25e", lastSeen: seen }]));
    vi.stubGlobal("fetch", fetchMock);
    const c = await caller();
    const first = await c.sms.gatewayHealth();
    const { value, elapsed } = await within(c.sms.gatewayHealth());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(elapsed).toBeLessThan(1_000);
    const second = value as typeof first;
    expect(second.readable).toBe(true);
    expect(second.online).toBe(true);
    expect(second.lastSeen).toBe(seen);
    expect("ageMinutes" in second && second.ageMinutes).toBe(2);
  });

  it("a cached probe never keeps a dead phone online: age is measured at read time", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const seen = new Date(Date.now() - 29 * 60_000).toISOString();
      vi.stubGlobal("fetch", vi.fn(async () => json([{ id: "d1", name: "F25e", lastSeen: seen }])));
      const c = await caller();
      expect((await c.sms.gatewayHealth()).online).toBe(true);
      vi.setSystemTime(Date.now() + 50_000); // still inside the cache window, now past 30 min of silence
      const later = await c.sms.gatewayHealth();
      expect(later.online).toBe(false);
      expect("ageMinutes" in later && later.ageMinutes).toBe(30);
    } finally {
      vi.useRealTimers();
    }
  });

  it("vapi.recentCalls answers within 4 s and says it failed (success: false), not an empty success", { timeout: 15_000 }, async () => {
    vi.stubGlobal("fetch", hangingFetch());
    const c = await caller();
    const { value, elapsed } = await within(c.vapi.recentCalls({ limit: 30 }));
    expect(value, "recentCalls still waiting on Vapi after 5 s").not.toBe(HUNG);
    expect(elapsed).toBeLessThan(4_000);
    const r = value as Awaited<ReturnType<typeof c.vapi.recentCalls>>;
    expect(r.success).toBe(false);
    expect(r.error).toBeTruthy();
  });
});

describe("Voice batch · transfer destination reads bounded and cached", () => {
  it("vapi.getTransferDestination answers within 4 s with ok: false when Vapi hangs", { timeout: 15_000 }, async () => {
    vi.stubGlobal("fetch", hangingFetch());
    const c = await caller();
    const { value, elapsed } = await within(c.vapi.getTransferDestination());
    expect(value, "getTransferDestination still waiting on Vapi after 5 s").not.toBe(HUNG);
    expect(elapsed).toBeLessThan(4_000);
    expect((value as { ok: boolean }).ok).toBe(false);
  });

  it("vapi.getFollowUpTransferDestination answers within 4 s with ok: false when Vapi hangs", { timeout: 15_000 }, async () => {
    vi.stubGlobal("fetch", hangingFetch());
    const c = await caller();
    const { value, elapsed } = await within(c.vapi.getFollowUpTransferDestination());
    expect(value, "getFollowUpTransferDestination still waiting on Vapi after 5 s").not.toBe(HUNG);
    expect(elapsed).toBeLessThan(4_000);
    const r = value as { ok: boolean; reason?: string };
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("error");
  });

  function vapiRoutes(numbers: Record<string, string>) {
    return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (init?.method === "PATCH") return json({ ok: true });
      if (u.endsWith("/assistant?limit=10")) return json(ASSISTANTS);
      const id = u.split("/assistant/")[1];
      if (id && numbers[id]) return json(assistantWith(id, numbers[id]));
      return json({ error: "unexpected " + u }, 404);
    });
  }

  it("the two destination cards share one assistant list read, and a reload within a minute costs no Vapi call", async () => {
    const fetchMock = vapiRoutes({ "rec-1": "+12165550101", "fu-1": "+12168620005" });
    vi.stubGlobal("fetch", fetchMock);
    const c = await caller();
    const [rec, fu] = await Promise.all([c.vapi.getTransferDestination(), c.vapi.getFollowUpTransferDestination()]);
    expect(rec).toMatchObject({ ok: true, currentNumber: "+12165550101" });
    expect(fu).toMatchObject({ ok: true, currentNumber: "+12168620005" });
    expect(fetchMock).toHaveBeenCalledTimes(3); // one list + two assistants
    await c.vapi.getTransferDestination();
    await c.vapi.getFollowUpTransferDestination();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("setTransferDestination clears the cached read, so the card shows the new number at once", async () => {
    const numbers: Record<string, string> = { "rec-1": "+12165550101", "fu-1": "+12168620005" };
    vi.stubGlobal("fetch", vapiRoutes(numbers));
    const c = await caller();
    expect(await c.vapi.getTransferDestination()).toMatchObject({ currentNumber: "+12165550101" });
    numbers["rec-1"] = "+12165550199"; // what Vapi holds after the PATCH
    await c.vapi.setTransferDestination({ phoneNumber: "+12165550199" });
    expect(await c.vapi.getTransferDestination()).toMatchObject({ ok: true, currentNumber: "+12165550199" });
  });
});
