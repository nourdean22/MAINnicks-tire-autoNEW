/**
 * Follow-ups to adminReadLatencyBound.test.ts (Codex review of the bounded admin reads).
 *
 *  1. A transfer-destination PATCH with an UNKNOWN outcome (no answer, so it may
 *     have landed) must drop the 60 s card memo, or "reload the card" shows the
 *     pre-edit number from the memo.
 *  2. A 200 from the SMS gateway that is not a device list (null, an error
 *     object) is "could not ask": readable:false, never kept, never a throw.
 *  3. The 3 s Vapi bound is the admin router's choice. A caller that passes
 *     nothing (scripts/backfills/backfill-vapi-duration.ts asks for 200 calls)
 *     keeps the service's own cap.
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
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetGatewayHealthCache();
  resetVapiAdminReadCaches();
});

describe("finding 1 · an unconfirmed PATCH drops the card memo", () => {
  it("after a PATCH that gets no answer, the next card read asks Vapi instead of the memo", async () => {
    const numbers: Record<string, string> = { "rec-1": "+12165550101", "fu-1": "+12168620005" };
    let cardReads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const u = String(url);
        if (init?.method === "PATCH") {
          numbers["rec-1"] = "+12165550199"; // it landed, but the reply never came back
          throw new Error("The operation was aborted due to timeout");
        }
        if (u.endsWith("/assistant?limit=10")) return json(ASSISTANTS);
        const id = u.split("/assistant/")[1];
        if (id === "rec-1") cardReads += 1;
        return json(assistantWith(id, numbers[id]));
      }),
    );
    const c = await caller();
    expect(await c.vapi.getTransferDestination()).toMatchObject({ currentNumber: "+12165550101" });
    const readsBefore = cardReads;

    await expect(c.vapi.setTransferDestination({ phoneNumber: "+12165550199" })).rejects.toMatchObject({ code: "BAD_GATEWAY" });
    const afterPatch = cardReads - readsBefore; // setTransferDestination reads the assistant once itself

    expect(await c.vapi.getTransferDestination()).toMatchObject({ ok: true, currentNumber: "+12165550199" });
    expect(cardReads - readsBefore).toBe(afterPatch + 1);
  });
});

describe("finding 2 · a 200 that is not a device list is 'could not ask'", () => {
  const bad: Array<[string, unknown]> = [
    ["null", null],
    ["an error object", { error: "x" }],
    ["devices with no id", [{ name: "F25e" }]],
  ];
  for (const [label, body] of bad) {
    it(`${label} reads readable:false, is not kept, and does not mask the next good reply`, async () => {
      const seen = new Date(Date.now() - 60_000).toISOString();
      let reply: unknown = body;
      const fetchMock = vi.fn(async () => json(reply));
      vi.stubGlobal("fetch", fetchMock);
      const c = await caller();

      const first = await c.sms.gatewayHealth();
      expect(first.readable).toBe(false);
      expect(first.online).toBe(false);
      expect(first.error).toBeTruthy();

      reply = [{ id: "d1", name: "F25e", lastSeen: seen }];
      const second = await c.sms.gatewayHealth();
      expect(fetchMock).toHaveBeenCalledTimes(2); // the bad answer was not kept
      expect(second.readable).toBe(true);
      expect(second.online).toBe(true);
    });
  }
});

describe("finding 3 · the 3 s Vapi bound belongs to the admin router, not getRecentCalls", () => {
  const callsFetch = () => vi.fn(async () => json([]));

  it("a caller that passes no option keeps the service's own cap (no 3 s signal)", async () => {
    vi.stubGlobal("fetch", callsFetch());
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    const { getRecentCalls } = await import("./services/vapi");
    const r = await getRecentCalls(200); // what scripts/backfills/backfill-vapi-duration.ts does
    expect(r.success).toBe(true);
    const asked = timeoutSpy.mock.calls.map((a) => a[0]);
    expect(asked).not.toContain(3_000);
    expect(asked).toContain(15_000);
  });

  it("the admin router passes the 3 s bound", async () => {
    vi.stubGlobal("fetch", callsFetch());
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    const c = await caller();
    const r = await c.vapi.recentCalls({ limit: 30 });
    expect(r.success).toBe(true);
    expect(timeoutSpy.mock.calls.map((a) => a[0])).toContain(3_000);
  });
});

describe("finding 4 · a malformed assistant list is not kept", () => {
  const bad: Array<[string, unknown]> = [
    ["null", null],
    ["an error object", { error: "x" }],
    ["items with no id", [{ name: "Receptionist" }]],
  ];
  for (const [label, body] of bad) {
    it(`${label} makes both cards ok:false, and a good list within a minute is seen`, async () => {
      let list: unknown = body;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string | URL | Request) => {
          const u = String(url);
          if (u.endsWith("/assistant?limit=10")) return json(list);
          const id = u.split("/assistant/")[1];
          return json(assistantWith(id, id === "rec-1" ? "+12165550101" : "+12168620005"));
        }),
      );
      const c = await caller();
      const [rec, fu] = await Promise.all([c.vapi.getTransferDestination(), c.vapi.getFollowUpTransferDestination()]);
      expect(rec.ok).toBe(false);
      expect(fu.ok).toBe(false);

      list = ASSISTANTS;
      expect(await c.vapi.getTransferDestination()).toMatchObject({ ok: true, currentNumber: "+12165550101" });
      expect(await c.vapi.getFollowUpTransferDestination()).toMatchObject({ ok: true, currentNumber: "+12168620005" });
    });
  }
});
