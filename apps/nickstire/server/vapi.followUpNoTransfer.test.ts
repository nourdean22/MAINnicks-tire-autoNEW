/**
 * The Follow-Up Caller has no transferCall tool BY DESIGN (services/vapi.ts followUpToolSet:
 * a trust call we placed is never forwarded mid-call; callbacks go through escalate).
 * The Voice card used to read that as "Off shop number" and offer "Reset to shop", which
 * then failed with "re-run vapi-update-assistant.ts" (2026-10-28: running that script would
 * rewrite the RECEPTIONIST, not this caller). Now the read says there is no transfer step,
 * and a write names the design instead of the script.
 *
 * `fetch` is stubbed in every case: no request leaves the test.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

function stubVapi(followUpTools: Array<Record<string, unknown>>) {
  const patches: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (init?.method === "PATCH") {
        patches.push(u);
        return json({});
      }
      if (u.includes("/assistant?")) return json(ASSISTANTS);
      const id = u.split("/assistant/")[1];
      return json({ id, name: id, model: { tools: id === "fu-1" ? followUpTools : [] } });
    }),
  );
  return patches;
}

beforeAll(async () => {
  await import("./routers");
}, 60_000);

beforeEach(() => {
  resetVapiAdminReadCaches();
  vi.stubEnv("VAPI_API_KEY", "canary-vapi-key");
  vi.stubEnv("VAPI_RECEPTIONIST_ASSISTANT_ID", "rec-1");
  vi.stubEnv("VAPI_FOLLOWUP_ASSISTANT_ID", "fu-1");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetVapiAdminReadCaches();
});

describe("Follow-Up Caller with no transfer step (by design)", () => {
  it("the card read says there is no transfer step, not an off-shop number", async () => {
    stubVapi([{ type: "function", function: { name: "escalate" } }]);
    const c = await caller();
    const fu = await c.vapi.getFollowUpTransferDestination();
    expect(fu).toMatchObject({ ok: true, hasTransferTool: false, currentNumber: null });
  });

  it("CONTROL: a caller that does have a transfer step still reports its number", async () => {
    stubVapi([{ type: "transferCall", destinations: [{ type: "number", number: "+12168620005" }] }]);
    const c = await caller();
    const fu = await c.vapi.getFollowUpTransferDestination();
    expect(fu).toMatchObject({ ok: true, hasTransferTool: true, currentNumber: "+12168620005", isShopLandline: true });
  });

  it("a write names the design, never the receptionist script, and sends no PATCH", async () => {
    const patches = stubVapi([{ type: "function", function: { name: "escalate" } }]);
    const c = await caller();
    const err = await c.vapi
      .setTransferDestination({ phoneNumber: "+12168620005", target: "followUp" })
      .then(() => null, (e: unknown) => e as { code?: string; message?: string });
    expect(err?.code).toBe("PRECONDITION_FAILED");
    expect(err?.message).toMatch(/no transfer step/i);
    expect(err?.message).not.toMatch(/vapi-update-assistant/);
    expect(patches).toEqual([]);
  });
});
